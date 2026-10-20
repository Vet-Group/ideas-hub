import { describe, expect, it } from 'vitest';
import {
  crawlJobExpirySeconds,
  manualDeadline,
  morningRunTime,
  nextSlotAfter,
  plannedSearches,
  rotate,
  scheduledDeadline,
  slotsBetween,
  vietnamDate,
  vietnamInstant,
} from './schedule';
import { DEFAULT_SETTINGS, type Settings } from './settings';
import { validateSettings } from './validate-settings';

const S = DEFAULT_SETTINGS as unknown as Settings;
const with_ = (over: Partial<Settings>): Settings => ({ ...S, ...over });

describe('slots', () => {
  it('lists the 01:00 and 13:00 slots in Asia/Ho_Chi_Minh', () => {
    const slots = slotsBetween(S.runTimes, new Date('2026-10-20T00:00:00Z'), new Date('2026-10-21T00:00:00Z'));
    expect(slots.map((d) => d.toISOString())).toEqual(['2026-10-20T06:00:00.000Z', '2026-10-20T18:00:00.000Z']);
  });

  it('keeps 14 days of slots', () => {
    const from = new Date('2026-10-20T10:00:00Z');
    expect(slotsBetween(S.runTimes, from, new Date(from.getTime() + 14 * 86_400_000))).toHaveLength(28);
  });

  it('finds the next slot and the Vietnam date', () => {
    expect(nextSlotAfter(S.runTimes, new Date('2026-10-20T06:00:00Z'))?.toISOString()).toBe('2026-10-20T18:00:00.000Z');
    expect(vietnamDate(new Date('2026-10-20T18:00:00Z'))).toBe('2026-10-21');
    expect(vietnamInstant('2026-10-21', '01:00').toISOString()).toBe('2026-10-20T18:00:00.000Z');
  });
});

describe('deadlines', () => {
  it('a 13:00 slot runs 4 h 30 min; the 01:00 morning run too (05:30 < 06:05)', () => {
    expect(scheduledDeadline(vietnamInstant('2026-10-21', '13:00'), S).toISOString()).toBe(vietnamInstant('2026-10-21', '17:30').toISOString());
    expect(scheduledDeadline(vietnamInstant('2026-10-21', '01:00'), S).toISOString()).toBe(vietnamInstant('2026-10-21', '05:30').toISOString());
  });

  it('a 02:00 morning slot hard-stops at 06:05, and at 06:00 after the hard stop changes', () => {
    const s = with_({ runTimes: ['02:00', '13:00'] });
    expect(morningRunTime(s)).toBe('02:00');
    expect(scheduledDeadline(vietnamInstant('2026-10-21', '02:00'), s)).toEqual(vietnamInstant('2026-10-21', '06:05'));
    expect(scheduledDeadline(vietnamInstant('2026-10-21', '02:00'), { ...s, morningHardStop: '06:00' })).toEqual(vietnamInstant('2026-10-21', '06:00'));
  });

  it('a manual run ends at the earlier of the run deadline and 25 min before the next slot', () => {
    expect(manualDeadline(vietnamInstant('2026-10-21', '09:00'), S)).toEqual(vietnamInstant('2026-10-21', '12:35'));
    expect(manualDeadline(vietnamInstant('2026-10-21', '05:00'), S)).toEqual(vietnamInstant('2026-10-21', '09:30'));
  });

  it('crawl.run expiry is 17400 s with the defaults', () => {
    expect(crawlJobExpirySeconds(S)).toBe(17400);
  });

  it('plans min(budget, active pairs)', () => {
    expect(plannedSearches(160, 164)).toBe(160);
    expect(plannedSearches(160, 4)).toBe(4);
  });
});

describe('rotate', () => {
  it('takes the budget from the cursor and rotates the rest into the next run', () => {
    const pairs = ['a', 'b', 'c', 'd', 'e'];
    const first = rotate(pairs, 3, 0);
    expect(first).toEqual({ pairs: ['a', 'b', 'c'], nextCursor: 3 });
    expect(rotate(pairs, 3, first.nextCursor)).toEqual({ pairs: ['d', 'e', 'a'], nextCursor: 1 });
    expect(rotate(pairs, 10, 2)).toEqual({ pairs: ['c', 'd', 'e', 'a', 'b'], nextCursor: 2 });
    expect(rotate([], 3, 7)).toEqual({ pairs: [], nextCursor: 0 });
  });
});

describe('validateSettings', () => {
  it('accepts the defaults', () => {
    expect(validateSettings(S)).toEqual([]);
  });

  it('rejects a margin of 20 min with a 15 min grace and accepts 25 min', () => {
    expect(validateSettings(with_({ manualRunMarginMinutes: 20 }))).toContain('margin_not_after_grace');
    expect(validateSettings(with_({ manualRunMarginMinutes: 25 }))).toEqual([]);
  });

  it('rejects a 06:10 hard stop with a 15 min grace and a 06:30 build time', () => {
    expect(validateSettings(with_({ morningHardStop: '06:10' }))).toContain('hard_stop_too_late');
  });

  it('rejects a 06:05 morning slot with a 06:05 hard stop and accepts 02:00', () => {
    expect(validateSettings(with_({ runTimes: ['06:05', '13:00'] }))).toContain('morning_slot_after_hard_stop');
    expect(validateSettings(with_({ runTimes: ['02:00', '13:00'] }))).toEqual([]);
  });

  it('rejects slots 01:00 and 05:00 and accepts 01:00 and 13:00', () => {
    expect(validateSettings(with_({ runTimes: ['01:00', '05:00'] }))).toContain('slots_too_close');
    expect(validateSettings(with_({ runTimes: ['01:00', '13:00'] }))).toEqual([]);
  });

  it('rejects a crawl expiry over 24 h', () => {
    expect(validateSettings(with_({ runDeadlineMinutes: 1430, runTimes: ['01:00'] }))).toContain('crawl_expiry_over_24h');
  });

  it('rejects a wait limit that reaches the heartbeat threshold', () => {
    expect(validateSettings(with_({ waitLimitsSeconds: { ...S.waitLimitsSeconds, pageLoad: 1800 } }))).toContain('wait_limit_reaches_heartbeat');
  });

  it('rejects an LLM timeout whose two attempts exceed the briefing job expiry, accepts 120 s', () => {
    expect(validateSettings(with_({ llmCallTimeoutSeconds: 451 }))).toContain('llm_timeout_over_job_expiry');
    expect(validateSettings(with_({ llmCallTimeoutSeconds: 120 }))).toEqual([]);
  });
});

describe('no run times', () => {
  it('slotsBetween and nextSlotAfter return nothing instead of looping, and a manual run keeps its deadline', () => {
    const t = new Date('2026-10-21T00:00:00Z');
    expect(slotsBetween([], t, new Date(t.getTime() + 86_400_000))).toEqual([]);
    expect(nextSlotAfter([], t)).toBeNull();
    const s = { ...(DEFAULT_SETTINGS as unknown as Settings), runTimes: [] };
    expect(manualDeadline(t, s)).toEqual(new Date(t.getTime() + s.runDeadlineMinutes * 60_000));
  });
});
