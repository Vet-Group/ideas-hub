import { describe, expect, it } from 'vitest';
import { addDays, isRealDate } from './day';

describe('isRealDate', () => {
  it('accepts real calendar dates, leap days included', () => {
    expect(isRealDate('2026-10-21')).toBe(true);
    expect(isRealDate('2028-02-29')).toBe(true);
  });
  it('rejects impossible dates and other shapes', () => {
    for (const d of ['2026-13-45', '2026-02-29', '2026-00-10', '2026-04-31', '0000-01-01', '2026-1-1', 'abcd-ef-gh', '2026-10-21x', '']) expect(isRealDate(d), d).toBe(false);
  });
});

describe('addDays', () => {
  it('crosses month, year and leap boundaries', () => {
    expect(addDays('2026-10-21', -1)).toBe('2026-10-20');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });
});
