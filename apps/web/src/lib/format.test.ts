import { describe, expect, it } from 'vitest';
import { formatDayMonth } from './format';

describe('formatDayMonth', () => {
  it('is the Asia/Ho_Chi_Minh day: 00:00–06:59 ICT is not the previous UTC day', () => {
    expect(formatDayMonth(new Date('2026-10-20T16:59:59Z'))).toBe('20/10');
    expect(formatDayMonth(new Date('2026-10-20T17:00:00Z'))).toBe('21/10');
    expect(formatDayMonth(new Date('2026-10-21T06:59:00Z'))).toBe('21/10');
  });

  it('crosses a month and a year', () => {
    expect(formatDayMonth(new Date('2026-10-31T18:00:00Z'))).toBe('01/11');
    expect(formatDayMonth(new Date('2026-12-31T20:00:00Z'))).toBe('01/01');
  });
});
