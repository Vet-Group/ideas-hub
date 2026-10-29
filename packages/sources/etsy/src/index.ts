// Etsy market data (AC-S2): the official Open API v3 active-listings search for one keyword, summarized as
// price bands per currency, top tags and median favorers. Read-only and public data only (docs/ops/etsy-app.md).
// Etsy API Terms: item data shown is at most 6 hours older than on Etsy, so a result is cached at most 6 h.

export const API_URL = 'https://openapi.etsy.com/v3/application/listings/active';
export const PAGE_LIMIT = 100;
/** One request a second, under the app's 5 QPS quota. */
export const SPACING_MS = 1000;
export const CACHE_MS = 6 * 60 * 60 * 1000;
/** A failed lookup is remembered this long per keyword, so repeated report views do not hammer a failing Etsy. */
export const FAILURE_CACHE_MS = 60_000;
export const CACHE_MAX_ENTRIES = 500;
/** With more requests than this already queued behind the pacing gate, a new one is "unavailable" at once. */
export const MAX_WAITING = 5;
const LISTING_URL_PREFIX = 'https://www.etsy.com/';
/** A longer Retry-After than this (e.g. the daily quota) means "unavailable" instead of a wait. */
const MAX_RETRY_AFTER_S = 10;
const TIMEOUT_MS = 10_000;
const TOP_TAGS = 10;
const TOP_LISTINGS = 10;

export interface PriceBand {
  currency: string;
  listings: number;
  p25: number;
  p75: number;
}

export interface EtsyListingLink {
  title: string;
  url: string;
  price: number;
  currency: string;
  favorers: number;
}

export interface EtsySummary {
  /** Etsy's count of matching active listings. */
  total: number;
  /** Listings the summary is computed from (the first page). */
  sampled: number;
  /** One band per currency, most listings first; prices are never compared across currencies. */
  priceBands: PriceBand[];
  topTags: { tag: string; listings: number }[];
  medianFavorers: number | null;
  /** The most favored listings, each linking back to Etsy. */
  listings: EtsyListingLink[];
}

export interface EtsyResult extends EtsySummary {
  fetchedAt: Date;
}

/** Etsy did not answer usefully (HTTP error, 429 twice, quota). The message never holds the key. */
export class EtsyUnavailable extends Error {}

interface Listing {
  title: string;
  url: string;
  tags: string[];
  favorers: number;
  price: number;
  currency: string;
}

/** Keeps listings with an Etsy listing url and a usable price; the rest of the API's fields are not read. */
function toListing(r: unknown): Listing | null {
  const x = r as { title?: unknown; url?: unknown; tags?: unknown; num_favorers?: unknown; price?: { amount?: unknown; divisor?: unknown; currency_code?: unknown } } | null;
  const p = x?.price;
  if (!x || typeof x.url !== 'string' || !x.url.startsWith(LISTING_URL_PREFIX) || typeof p?.amount !== 'number' || typeof p.divisor !== 'number' || p.divisor <= 0 || typeof p.currency_code !== 'string') return null;
  return {
    title: typeof x.title === 'string' ? x.title : '',
    url: x.url,
    tags: Array.isArray(x.tags) ? x.tags.filter((t): t is string => typeof t === 'string') : [],
    favorers: typeof x.num_favorers === 'number' ? x.num_favorers : 0,
    price: p.amount / p.divisor,
    currency: p.currency_code,
  };
}

/** Linear-interpolated quantile of sorted values. */
function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function summarize(rows: readonly unknown[], total: number): EtsySummary {
  const listings = rows.map(toListing).filter((l): l is Listing => l !== null);
  const byCurrency = new Map<string, Listing[]>();
  for (const l of listings) byCurrency.set(l.currency, [...(byCurrency.get(l.currency) ?? []), l]);
  const priceBands = [...byCurrency]
    .map(([currency, ls]) => {
      const prices = ls.map((l) => l.price).sort((a, b) => a - b);
      return { currency, listings: ls.length, p25: cents(quantile(prices, 0.25)), p75: cents(quantile(prices, 0.75)) };
    })
    .sort((a, b) => b.listings - a.listings || a.currency.localeCompare(b.currency));
  const tagCounts = new Map<string, number>();
  for (const l of listings) for (const tag of new Set(l.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  const topTags = [...tagCounts]
    .map(([tag, n]) => ({ tag, listings: n }))
    .sort((a, b) => b.listings - a.listings || a.tag.localeCompare(b.tag))
    .slice(0, TOP_TAGS);
  const favorers = listings.map((l) => l.favorers).sort((a, b) => a - b);
  return {
    total,
    sampled: listings.length,
    priceBands,
    topTags,
    medianFavorers: favorers.length ? quantile(favorers, 0.5) : null,
    listings: [...listings]
      .sort((a, b) => b.favorers - a.favorers)
      .slice(0, TOP_LISTINGS)
      .map(({ title, url, price, currency, favorers: f }) => ({ title, url, price: cents(price), currency, favorers: f })),
  };
}

export interface ClientOptions {
  apiKey: string;
  sharedSecret: string;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** One client per process: it holds the 1 req/s pacing and the cache. */
export function createEtsyClient(o: ClientOptions) {
  const fetchFn = o.fetch ?? fetch;
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const cache = new Map<string, { at: number; ttl: number; result: Promise<EtsyResult> }>();
  let waiting = 0;
  let gate: Promise<unknown> = Promise.resolve();
  let lastAt = -Infinity;

  /** Runs `fn` after every earlier request, at least SPACING_MS after the last one started. */
  const paced = <T>(fn: () => Promise<T>): Promise<T> => {
    if (waiting > MAX_WAITING) return Promise.reject(new EtsyUnavailable('Etsy request queue is full'));
    waiting++;
    const run = gate.then(async () => {
      waiting--;
      const wait = lastAt + SPACING_MS - now();
      if (wait > 0) await sleep(wait);
      lastAt = now();
      return fn();
    });
    gate = run.catch(() => undefined);
    return run;
  };

  const get = (keywords: string) => {
    const url = new URL(API_URL);
    url.search = new URLSearchParams({ keywords, limit: String(PAGE_LIMIT), offset: '0', sort_on: 'score' }).toString();
    return fetchFn(url, { headers: { 'x-api-key': `${o.apiKey}:${o.sharedSecret}`, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
  };

  const request = (keywords: string) =>
    paced(async () => {
      let res = await get(keywords);
      if (res.status === 429) {
        const s = Number(res.headers.get('retry-after'));
        const waitS = Number.isFinite(s) && s >= 0 ? s : 1;
        if (waitS <= MAX_RETRY_AFTER_S) {
          // Inside the gate, so every other request waits too.
          await sleep(Math.max(waitS * 1000, SPACING_MS));
          lastAt = now();
          res = await get(keywords);
        }
      }
      if (!res.ok) throw new EtsyUnavailable(`Etsy returned HTTP ${res.status}`);
      const data = (await res.json()) as { count?: unknown; results?: unknown };
      const rows = Array.isArray(data.results) ? data.results : [];
      return { ...summarize(rows, typeof data.count === 'number' ? data.count : rows.length), fetchedAt: new Date(now()) };
    });

  return {
    /** The summary for a keyword, from the cache when it is younger than CACHE_MS (a failure: FAILURE_CACHE_MS). */
    search(keyword: string): Promise<EtsyResult> {
      const key = keyword.trim().toLowerCase();
      const t = now();
      for (const [k, v] of cache) if (t - v.at >= v.ttl) cache.delete(k);
      const hit = cache.get(key);
      if (hit) return hit.result;
      const result = request(key);
      const entry = { at: t, ttl: CACHE_MS, result };
      cache.set(key, entry);
      if (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
      // A failure stays cached only briefly, counted from when it failed.
      result.catch(() => {
        entry.at = now();
        entry.ttl = FAILURE_CACHE_MS;
      });
      return result;
    },
  };
}
