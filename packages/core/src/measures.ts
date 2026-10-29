// Ad measures (spec §1 "Measures", §3). Dates are ISO `YYYY-MM-DD` strings in America/Los_Angeles.

export const PACIFIC = 'America/Los_Angeles';
export const VIETNAM = 'Asia/Ho_Chi_Minh';

const DAY_MS = 86_400_000;

/** `ad_sightings` older than this many crawl days are deleted; the counts on `ads` stay (ADR 0002, 0007). */
export const SIGHTINGS_RETENTION_DAYS = 180;
/** An ad not seen for this many crawl days loses its thumbnail, unless a saved idea shows it (ADR 0007). */
export const THUMBNAIL_RETENTION_DAYS = 90;

const pacificFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: PACIFIC,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const vietnamTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: VIETNAM,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function pacificDate(instant: Date): string {
  return pacificFormat.format(instant);
}

/** A payload `start_date` / `end_date` (Unix seconds, midnight Pacific) as a Pacific date. */
export function pacificDateFromUnix(seconds: number): string {
  return pacificDate(new Date(seconds * 1000));
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!) / DAY_MS;
}

export function addDays(date: string, days: number): string {
  return new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** Calendar days between two dates; never raw seconds / 86 400, which breaks across DST. */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** Run-length convention: calendar days from start to end counting both ends. */
export function daysActive(startDate: string, endDate: string): number {
  return daysBetween(startDate, endDate) + 1;
}

/** The Pacific date on which a run started; all its sightings belong to it. */
export function crawlDay(runStartedAt: Date): string {
  return pacificDate(runStartedAt);
}

export interface TrendInput {
  daysActive: number;
  seenDays: number;
  landingDomain: string | null;
}

/** `days_active × seen_days`, only for ads active 5+ days with a landing domain. */
export function trendScore(ad: TrendInput): number | null {
  if (ad.daysActive < 5 || !ad.landingDomain) return null;
  return ad.daysActive * ad.seenDays;
}

/** Days back the momentum score compares against. */
export const MOMENTUM_WINDOW_DAYS = 3;

/** "Before" is the earliest value within the window on a crawl day earlier than "now"'s; null when there is none. */
export interface MomentumInput {
  variantsNow: number | null;
  variantsBefore: number | null;
  pageLikesNow: number | null;
  pageLikesBefore: number | null;
  daysActive: number | null;
}

/**
 * The "Trending" sort: 10 × variants gained (collation_count) + page like growth in % (0–100) + days running
 * (max 30). 0 while neither series has two crawl days in the window, so a fresh install ranks nothing.
 * momentumSql (packages/db queries/research.ts) is the same formula in SQL.
 */
export function momentumScore(m: MomentumInput): number {
  const variants = m.variantsNow !== null && m.variantsBefore !== null ? Math.max(0, m.variantsNow - m.variantsBefore) : null;
  const likes =
    m.pageLikesNow !== null && m.pageLikesBefore
      ? Math.min(100, Math.max(0, Math.round(((m.pageLikesNow - m.pageLikesBefore) * 100) / m.pageLikesBefore)))
      : null;
  if (variants === null && likes === null) return 0;
  return 10 * (variants ?? 0) + (likes ?? 0) + Math.min(30, m.daysActive ?? 0);
}

/** An ad the advertiser has scaled (6+ variants), or kept running 30+ days in 3+ countries. */
export const PROVEN = { variants: 6, days: 30, countries: 3 } as const;

export interface ProvenInput {
  /** collation_count; null when the Ad Library gave none. */
  variants: number | null;
  daysActive: number | null;
  countries: number;
}

/** provenSql (packages/db queries/research.ts) is the same rule in SQL. */
export function isProven(ad: ProvenInput): boolean {
  return (ad.variants ?? 0) >= PROVEN.variants || ((ad.daysActive ?? 0) >= PROVEN.days && ad.countries >= PROVEN.countries);
}

/** Days back that count as "new ads" in the market read, and the share of new or proven ads that names its stage. */
export const MARKET = { newDays: 7, risingShare: 0.15, provenShare: 0.35 } as const;

export type MarketStage = 'rising' | 'proven' | 'steady';

/** One keyword's running ads, read as a market (spec §6 "Market read"). */
export interface MarketRead {
  ads: number;
  /** Landing domains outside `nonShopDomains`. */
  shops: number;
  /** Share of the ads run by the 3 biggest of those shops; null without a shop. */
  top3Share: number | null;
  /** Started in the last MARKET.newDays days, and in the days before those. */
  newAds: number;
  newAdsBefore: number;
  proven: number;
  video: number;
}

/**
 * "rising" when ≥ 15% of the running ads started in the last 7 days (new demand: try it early), else
 * "proven" when ≥ 35% are proven (known winners to learn from), else "steady". Thresholds from the
 * production spread of 41 keywords on 2026-10-25: 7 rising, 18 proven.
 */
export function marketStage(m: Pick<MarketRead, 'ads' | 'newAds' | 'proven'>): MarketStage {
  if (m.ads === 0) return 'steady';
  if (m.newAds / m.ads >= MARKET.risingShare) return 'rising';
  return m.proven / m.ads >= MARKET.provenShare ? 'proven' : 'steady';
}

/** Words that never make a title phrase on their own side ("gift for", "shop now"). */
export const TITLE_STOPWORDS = [
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'as', 'is', 'are', 'be',
  'it', 'its', 'this', 'that', 'your', 'you', 'our', 'my', 'me', 'we', 'us', 'her', 'his', 'him', 'she', 'he', 'they',
  'them', 'their', 'get', 'now', 'off', 'up', 'out', 'all', 'just', 'more', 'best', 'shop', 'buy', 'order', 'free',
  'only', 'so', 'if', 'not', 'no', 'will', 'can', 'what', 'who', 'how', 'when', 'new',
] as const;

/**
 * Title phrases (titlePhrases, packages/db): a phrase needs ads >= max(minAds, ceil(minShare * running ads
 * with a title)); a 2-word phrase is dropped when one 3-word phrase containing it covers >= fragmentCover of its ads.
 */
export const TITLE_PHRASE = { minAds: 3, minShare: 0.02, fragmentCover: 0.8 } as const;

/** A title as lower-case words split by single spaces; titlePhrases (packages/db) splits the same way in SQL. */
export function titleWords(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}]+/gu, ' ').trim();
}

/**
 * A `nonShopDomains` entry as a regex over a landing domain: the domain itself or any subdomain, `*`
 * standing for the rest of the name (`amazon.*` is amazon.com and amazon.co.uk). Valid in JS and in
 * Postgres `~`; migration 0005 builds the same pattern in SQL.
 */
export function nonShopPattern(entry: string): string {
  return `^(.+\\.)?${entry.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.+')}$`;
}

export function isNonShopDomain(domain: string, entries: readonly string[]): boolean {
  return entries.some((e) => new RegExp(nonShopPattern(e)).test(domain));
}

export const SEARCH_STATUSES = [
  'pending',
  'running',
  'ok',
  'no_results',
  'blocked',
  'network_error',
  'parse_error',
  'interrupted',
  'skipped',
] as const;
export type SearchStatus = (typeof SEARCH_STATUSES)[number];

export interface PairSearch {
  crawlDay: string;
  status: SearchStatus;
  lastHasNext: boolean | null;
}

/** One (keyword, country) pair the ad was seen under, with the searches run on it. */
export interface AdPair {
  active: boolean;
  searches: readonly PairSearch[];
}

export type AdStatus = 'running' | 'out_of_top' | 'stopped_or_unknown';

/**
 * Ad status is computed, never stored. Only a search that read to the end of results proves an ad is
 * gone; one stopped with a next page left saw only the top of the list.
 */
export function adStatus(
  ad: { lastSeenDate: string; pairs: readonly AdPair[] },
  today: string,
  staleAfterDays: number,
): AdStatus {
  if (daysBetween(ad.lastSeenDate, today) <= staleAfterDays) return 'running';
  // No known pair (sightings purged) proves nothing either way, so it reads as unknown.
  if (ad.pairs.every((p) => !p.active)) return 'stopped_or_unknown';
  const since = ad.pairs.flatMap((p) => p.searches).filter((s) => s.crawlDay > ad.lastSeenDate);
  const endOfResults = (s: PairSearch) =>
    s.status === 'no_results' || (s.status === 'ok' && s.lastHasNext === false);
  if (since.some(endOfResults)) return 'stopped_or_unknown';
  if (since.some((s) => s.status === 'ok' && s.lastHasNext === true)) return 'out_of_top';
  return 'running';
}

/** `first_seen_date` and `start_date` both within the last 3 crawl days, so an old ad is never new. */
export function isRisingNew(
  ad: { firstSeenDate: string; startDate: string },
  latestCrawlDay: string,
  windowDays = 3,
): boolean {
  const from = addDays(latestCrawlDay, -(windowDays - 1));
  return ad.firstSeenDate >= from && ad.startDate >= from;
}

/** A slot is the Asia/Ho_Chi_Minh time of day of a run's `scheduled_for`. */
export function slotKey(scheduledFor: Date): string {
  return vietnamTime.format(scheduledFor);
}

export interface Snapshot {
  crawlDay: string;
  slot: Date;
  value: number;
}

export interface Delta {
  change: number;
  baselineDay: string;
  /** True when the history is shorter than the cutoff: shown as "since <date>". */
  partial: boolean;
}

/**
 * Change of `latest` against the same slot `cutoffDays` crawl days earlier: the last snapshot on or
 * before the cutoff, else the earliest one (partial); none with fewer than 2 snapshots of the slot.
 */
export function deltaAt(snapshots: readonly Snapshot[], latest: Snapshot, cutoffDays = 7): Delta | null {
  const slot = slotKey(latest.slot);
  const earlier = snapshots
    .filter((s) => slotKey(s.slot) === slot && s.crawlDay < latest.crawlDay)
    .sort((a, b) => (a.crawlDay < b.crawlDay ? -1 : 1));
  if (earlier.length === 0) return null;
  const cutoff = addDays(latest.crawlDay, -cutoffDays);
  const onOrBefore = earlier.filter((s) => s.crawlDay <= cutoff).at(-1);
  const baseline = onOrBefore ?? earlier[0]!;
  return { change: latest.value - baseline.value, baselineDay: baseline.crawlDay, partial: !onOrBefore };
}
