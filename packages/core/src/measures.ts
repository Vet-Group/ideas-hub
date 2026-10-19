// Ad measures (spec §1 "Measures", §3). Dates are ISO `YYYY-MM-DD` strings in America/Los_Angeles.

export const PACIFIC = 'America/Los_Angeles';
export const VIETNAM = 'Asia/Ho_Chi_Minh';

const DAY_MS = 86_400_000;

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
