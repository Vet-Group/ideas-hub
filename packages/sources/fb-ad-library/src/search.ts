// One keyword × country search: up to 3 attempts, the embedded page, then scroll pages until the end of
// results, the 100-ad cap or the 2-page rule (spec §1). The browser sits behind `SearchPage` and
// `BrowserSession`, so the rules are tested without one; `playwright.ts` drives the real browser.
import { type Settings, type Signal } from '@ideas-hub/core';
import { type RawAd, ParseError } from './connection';
import { type BlockReason, classifyEmbedded } from './detect';
import { embeddedHasNext, parseEmbedded } from './parse-embedded';
import { parseGraphql } from './parse-graphql';

export type WaitKind = Extract<keyof Settings['waitLimitsSeconds'], string>;
/** Per-wait limit hits, counted on the run (spec §1 "Bounded waits"). */
export type WaitLimitHits = Partial<Record<WaitKind, number>>;

/** A wait that ran out, a destroyed page context, `net::err_`, a closed browser: ends the attempt. */
export class TransientError extends Error {
  override name = 'TransientError';
  constructor(
    public kind: WaitKind | 'other',
    message: string,
  ) {
    super(message);
  }
}

const TRANSIENT = /TimeoutError|Timeout \d+ms exceeded|net::ERR_|has been closed|Execution context was destroyed|Target crashed|browser has disconnected/i;

export function isTransient(e: unknown): boolean {
  if (e instanceof TransientError) return true;
  if (e instanceof ParseError) return false;
  return TRANSIENT.test(e instanceof Error ? `${e.name} ${e.message}` : String(e));
}

export interface SearchPage {
  /** Opens the search; a load over `timeoutMs` throws a TransientError('pageLoad'). */
  open(url: string, timeoutMs: number): Promise<void>;
  /** The embedded-data script text, or null when it did not arrive within `timeoutMs`. */
  embeddedData(timeoutMs: number): Promise<string | null>;
  loginWall(): Promise<boolean>;
  /** Scrolls to the bottom; the pagination bodies that arrived, none when `timeoutMs` ran out. */
  scroll(timeoutMs: number): Promise<string[] | null>;
}

export interface BrowserSession {
  /** The open page; starts the browser when there is none. */
  page(): Promise<SearchPage>;
  /** Closes (killing it past the close limit) and starts again; a slow start throws TransientError('browserStart'). */
  restart(): Promise<void>;
}

export type SearchSettings = Pick<
  Settings,
  'adsPerSearchCap' | 'noNewAdsPagesToStop' | 'blockEmptyPayloadsInRow' | 'waitLimitsSeconds' | 'attemptsPerSearch' | 'retryDelaysSeconds'
>;

export interface SearchDeps {
  settings: SearchSettings;
  session: BrowserSession;
  pageDelayMs: () => number;
  scrollDelayMs: () => number;
  /** Waits; the worker writes the heartbeat at least once a minute while waiting. */
  sleep: (ms: number) => Promise<void>;
  /** Heartbeat at every step (attempt, page load, scroll). */
  beat: () => Promise<void> | void;
  /** True once the run's deadline has passed. */
  deadlinePassed: () => boolean;
}

export type SearchStatus = 'ok' | 'no_results' | 'blocked' | 'network_error' | 'parse_error' | 'interrupted';

export interface SearchResult {
  status: SearchStatus;
  signal: Signal;
  reason: string | null;
  embeddedCount: number | null;
  embeddedHasNext: boolean | null;
  totalCount: number | null;
  pagesRead: number;
  lastHasNext: boolean | null;
  stopReason: 'end_of_results' | 'cap' | 'no_new_ads' | null;
  /** Unique ads in the order read; position = index + 1. Kept for blocked and interrupted searches. */
  ads: RawAd[];
  attempts: number;
  retries: number;
  browserRestarts: number;
  waitLimitHits: WaitLimitHits;
}

export function searchUrl(query: string, country: string): string {
  return (
    `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}` +
    `&is_targeted_country=false&media_type=all&q=${encodeURIComponent(query)}&search_type=keyword_unordered`
  );
}

/** The run deadline came mid-search: the search is `interrupted` and keeps the ads it read. */
class Interrupted extends Error {
  constructor(public ads: RawAd[]) {
    super('run deadline');
  }
}

/** A heartbeat write that failed: a database error, not a search error, so runSearch rethrows it. */
class BeatFailed extends Error {
  constructor(override cause: unknown) {
    super('heartbeat write failed');
  }
}

function isEmptyPayload(body: string): boolean {
  const text = body.replace(/^for \(;;\);/, '').trim();
  if (text === '') return true;
  try {
    const o = JSON.parse(text) as Record<string, unknown> | null;
    return !!o && typeof o === 'object' && 'errors' in o && !('data' in o && o.data);
  } catch {
    return false;
  }
}

type Attempt = Omit<SearchResult, 'attempts' | 'retries' | 'browserRestarts' | 'waitLimitHits'>;

async function attempt(page: SearchPage, query: string, country: string, deps: SearchDeps): Promise<Attempt> {
  const { settings: s } = deps;
  const w = s.waitLimitsSeconds;
  const r: Attempt = {
    status: 'ok',
    signal: 'ok',
    reason: null,
    embeddedCount: null,
    embeddedHasNext: null,
    totalCount: null,
    pagesRead: 0,
    lastHasNext: null,
    stopReason: null,
    ads: [],
  };
  const blocked = (reason: BlockReason, signal: Signal) => Object.assign(r, { status: 'blocked' as const, signal, reason });
  const beat = async () => {
    try {
      await deps.beat();
    } catch (e) {
      throw new BeatFailed(e);
    }
  };

  await beat();
  await page.open(searchUrl(query, country), w.pageLoad * 1000);
  await beat();
  const embedded = await page.embeddedData(w.embeddedData * 1000);
  if (await page.loginWall()) return blocked('login_wall', 'captcha');
  if (embedded === null) throw new TransientError('embeddedData', 'embedded data did not arrive');

  const conn = parseEmbedded(embedded);
  const verdict = classifyEmbedded(conn);
  r.totalCount = conn.count ?? null;
  r.embeddedCount = conn.ads.length;
  if (verdict.kind === 'blocked') return blocked(verdict.reason, verdict.signal);
  if (verdict.kind === 'no_results') return Object.assign(r, { status: 'no_results' as const, signal: 'neutral' as const, embeddedHasNext: false, lastHasNext: false });

  const seen = new Set<string>();
  const add = (ads: RawAd[]) => {
    let fresh = 0;
    for (const ad of ads) {
      if (seen.size >= s.adsPerSearchCap) break;
      if (seen.has(ad.ad_archive_id)) continue;
      seen.add(ad.ad_archive_id);
      r.ads.push(ad);
      fresh += 1;
    }
    return fresh;
  };
  add(conn.ads);
  let hasNext = embeddedHasNext(conn, seen.size);
  r.embeddedHasNext = hasNext;
  await deps.sleep(deps.pageDelayMs());

  let emptyInRow = 0;
  let noNewInRow = 0;
  for (;;) {
    if (!hasNext) {
      r.stopReason = 'end_of_results';
      break;
    }
    if (seen.size >= s.adsPerSearchCap) {
      r.stopReason = 'cap';
      break;
    }
    if (deps.deadlinePassed()) throw new Interrupted(r.ads);
    await deps.sleep(deps.scrollDelayMs());
    await beat();
    const bodies = await page.scroll(w.scrollResponse * 1000);
    if (bodies === null) throw new TransientError('scrollResponse', 'no pagination response');
    for (const body of bodies) {
      r.pagesRead += 1;
      let ads: RawAd[] = [];
      let pageHasNext: boolean | undefined;
      // An empty body or a payload of only `errors` is an empty payload (block detection); anything
      // else unreadable throws ParseError, which makes the search a parse_error.
      if (!isEmptyPayload(body)) {
        const pc = parseGraphql(body);
        if (pc.captcha) return blocked('captcha', 'captcha');
        ads = pc.ads;
        pageHasNext = pc.hasNext;
      }
      if (seen.size >= s.adsPerSearchCap) break;
      if (ads.length === 0) {
        // Empty payloads go to block detection only, never to the 2-page rule.
        emptyInRow += 1;
        if (emptyInRow >= s.blockEmptyPayloadsInRow) {
          r.lastHasNext = hasNext;
          return blocked('empty_payloads', 'blocked');
        }
        continue;
      }
      emptyInRow = 0;
      if (pageHasNext !== undefined) hasNext = pageHasNext;
      noNewInRow = add(ads) === 0 ? noNewInRow + 1 : 0;
    }
    if (seen.size < s.adsPerSearchCap && noNewInRow >= s.noNewAdsPagesToStop) {
      r.stopReason = 'no_new_ads';
      break;
    }
  }
  r.lastHasNext = hasNext;
  // Neutral until measurements say a 2-page stop is resistance (spec §1 "Backoff"; Step 1 kept it).
  if (r.stopReason === 'no_new_ads' && hasNext) r.signal = 'neutral';
  return r;
}

/** Runs one search with its retries; never throws for a search error. */
export async function runSearch(query: string, country: string, deps: SearchDeps): Promise<SearchResult> {
  const { settings: s } = deps;
  const waitLimitHits: WaitLimitHits = {};
  let retries = 0;
  let browserRestarts = 0;
  let lastError = '';
  for (let a = 1; a <= s.attemptsPerSearch; a++) {
    const counters = { attempts: a, retries, browserRestarts, waitLimitHits };
    try {
      if (a > 1) {
        await deps.sleep(s.retryDelaysSeconds[a - 2]! * 1000);
        retries += 1;
        browserRestarts += 1;
        counters.retries = retries;
        counters.browserRestarts = browserRestarts;
        await deps.session.restart();
      }
      const res = await attempt(await deps.session.page(), query, country, deps);
      return { ...res, ...counters };
    } catch (e) {
      if (e instanceof BeatFailed) throw e.cause;
      if (e instanceof Interrupted) {
        return { ...emptyResult('interrupted', 'neutral', 'run deadline'), ads: e.ads, ...counters };
      }
      if (!isTransient(e)) {
        return { ...emptyResult('parse_error', 'neutral', String(e).slice(0, 500)), ...counters };
      }
      const kind = e instanceof TransientError ? e.kind : 'other';
      if (kind !== 'other') waitLimitHits[kind] = (waitLimitHits[kind] ?? 0) + 1;
      lastError = `${kind}: ${String(e instanceof Error ? e.message : e).slice(0, 300)}`;
      if (deps.deadlinePassed()) return { ...emptyResult('interrupted', 'neutral', lastError), ...counters };
    }
  }
  return {
    ...emptyResult('network_error', 'network', lastError),
    attempts: s.attemptsPerSearch,
    retries,
    browserRestarts,
    waitLimitHits,
  };
}

function emptyResult(status: SearchStatus, signal: Signal, reason: string): Attempt {
  return {
    status,
    signal,
    reason,
    embeddedCount: null,
    embeddedHasNext: null,
    totalCount: null,
    pagesRead: 0,
    lastHasNext: null,
    stopReason: null,
    ads: [],
  };
}
