import { describe, expect, it } from 'vitest';
import { buildChartRows, endLabelsFit, rangeStart } from './series';

describe('buildChartRows', () => {
  it('makes one row per day with one column per slot, and a gap (null) for a missing snapshot', () => {
    const { slots, rows } = buildChartRows([
      { date: '2026-10-18', slotTime: '13:00', runningAds: 4 },
      { date: '2026-10-18', slotTime: '01:00', runningAds: 3 },
      { date: '2026-10-20', slotTime: '01:00', runningAds: 6 },
    ]);
    expect(slots).toEqual(['01:00', '13:00']);
    expect(rows).toEqual([
      { date: '2026-10-18', s0100: 3, s1300: 4 },
      { date: '2026-10-19', s0100: null, s1300: null },
      { date: '2026-10-20', s0100: 6, s1300: null },
    ]);
  });

  it('keeps a zero as a value, not a gap', () => {
    expect(buildChartRows([{ date: '2026-10-18', slotTime: '01:00', runningAds: 0 }]).rows[0]).toEqual({ date: '2026-10-18', s0100: 0 });
  });

  it('starts a range N days back from the last day', () => {
    const { rows } = buildChartRows([
      { date: '2026-09-01', slotTime: '01:00', runningAds: 1 },
      { date: '2026-10-20', slotTime: '01:00', runningAds: 2 },
    ]);
    expect(rangeStart(rows, 14)).toBe('2026-10-07');
    expect(rangeStart(rows, 8)).toBe('2026-10-13');
    expect(rangeStart([], 14)).toBeNull();
  });
});

describe('endLabelsFit', () => {
  const slots = ['01:00', '13:00'];
  it('labels lines whose last values sit apart, and drops labels that would overlap', () => {
    expect(endLabelsFit([{ date: '2026-10-24', s0100: 300, s1300: 380 }, { date: '2026-10-25', s0100: 300, s1300: 404 }], slots)).toBe(true);
    expect(endLabelsFit([{ date: '2026-10-24', s0100: 300, s1300: 380 }, { date: '2026-10-25', s0100: 394, s1300: 404 }], slots)).toBe(false);
  });
  it('a line with no last value and a single line always fit', () => {
    expect(endLabelsFit([{ date: '2026-10-25', s0100: 404, s1300: null }], slots)).toBe(true);
    expect(endLabelsFit([], slots)).toBe(true);
  });
});
