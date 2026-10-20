// Run slots, deadlines and job expiry (spec §1 "Schedule and limits", "Run now"). Run times are
// Asia/Ho_Chi_Minh, which is UTC+7 all year (no DST), so slots are plain offsets from UTC.
import { type Settings } from './settings';

const VN_OFFSET_MS = 7 * 3_600_000;
const MINUTE = 60_000;
const DAY = 86_400_000;
/** The watchdog runs every 5 min (spec §1 "Missed run"). */
export const WATCHDOG_PERIOD_MINUTES = 5;

export type ScheduleSettings = Pick<
  Settings,
  'runTimes' | 'runDeadlineMinutes' | 'morningHardStop' | 'manualRunMarginMinutes' | 'watchdogGraceMinutes' | 'briefingBuildTime'
>;

/** `HH:mm` → minutes after midnight. */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
}

/** The Asia/Ho_Chi_Minh date (`YYYY-MM-DD`) of an instant. */
export function vietnamDate(instant: Date): string {
  return new Date(instant.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant of `HH:mm` on an Asia/Ho_Chi_Minh date. */
export function vietnamInstant(date: string, hhmm: string): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) - VN_OFFSET_MS + minutesOf(hhmm) * MINUTE);
}

/** The morning run: the last slot before the briefing build time, or null when no slot is before it. */
export function morningRunTime(s: Pick<ScheduleSettings, 'runTimes' | 'briefingBuildTime'>): string | null {
  const build = minutesOf(s.briefingBuildTime);
  const before = s.runTimes.filter((t) => minutesOf(t) < build).sort((a, b) => minutesOf(a) - minutesOf(b));
  return before.at(-1) ?? null;
}

/** Every slot in [from, to), in time order. */
export function slotsBetween(runTimes: readonly string[], from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let day = vietnamDate(new Date(from.getTime() - DAY)); ; ) {
    for (const t of [...runTimes].sort((a, b) => minutesOf(a) - minutesOf(b))) {
      const slot = vietnamInstant(day, t);
      if (slot >= to) return out;
      if (slot >= from) out.push(slot);
    }
    day = vietnamDate(new Date(Date.parse(`${day}T12:00:00Z`) + DAY));
  }
}

/** The first slot strictly after `t`. */
export function nextSlotAfter(runTimes: readonly string[], t: Date): Date {
  return slotsBetween(runTimes, new Date(t.getTime() + 1), new Date(t.getTime() + 2 * DAY))[0]!;
}

/** Earlier of slot + run deadline and, for the morning run, the hard stop of that day. */
export function scheduledDeadline(slot: Date, s: ScheduleSettings): Date {
  const byDeadline = slot.getTime() + s.runDeadlineMinutes * MINUTE;
  const time = new Date(slot.getTime() + VN_OFFSET_MS).toISOString().slice(11, 16);
  if (time !== morningRunTime(s)) return new Date(byDeadline);
  const hardStop = vietnamInstant(vietnamDate(slot), s.morningHardStop).getTime();
  return new Date(Math.min(byDeadline, hardStop));
}

/** A Run now or `cli` row: earlier of the run deadline after the request and the margin before the next slot. */
export function manualDeadline(requestedAt: Date, s: ScheduleSettings): Date {
  const next = nextSlotAfter(s.runTimes, requestedAt).getTime() - s.manualRunMarginMinutes * MINUTE;
  return new Date(Math.min(requestedAt.getTime() + s.runDeadlineMinutes * MINUTE, next));
}

/** `crawl.run` expiry: run deadline + grace + the watchdog period (17400 s by default). */
export function crawlJobExpirySeconds(s: Pick<ScheduleSettings, 'runDeadlineMinutes' | 'watchdogGraceMinutes'>): number {
  return (s.runDeadlineMinutes + s.watchdogGraceMinutes + WATCHDOG_PERIOD_MINUTES) * 60;
}

/** `min(budget, active pairs)` (spec §2 CrawlRun `planned_searches`). */
export function plannedSearches(budget: number, activePairs: number): number {
  return Math.min(budget, activePairs);
}

export interface Pair {
  keywordId: string;
  country: string;
}

/**
 * Budget rotation: `budget` pairs from the cursor on, wrapping around, so the rest rotate into the next
 * run. Returns the pairs and the cursor for the next run.
 */
export function rotate<P>(pairs: readonly P[], budget: number, cursor: number): { pairs: P[]; nextCursor: number } {
  const n = pairs.length;
  if (n === 0) return { pairs: [], nextCursor: 0 };
  const take = Math.min(budget, n);
  const start = ((cursor % n) + n) % n;
  return { pairs: Array.from({ length: take }, (_, i) => pairs[(start + i) % n]!), nextCursor: (start + take) % n };
}
