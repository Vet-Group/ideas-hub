import { describe, expect, it } from 'vitest';
import { lcpVerdict, median } from './lcp-briefing';

describe('lcp-briefing', () => {
  it('takes the middle of an odd count and the mean of the middle two of an even count, unsorted input', () => {
    expect(median([2600, 900, 1200, 3100, 1000])).toBe(1200);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow();
  });

  it('passes only under 2500 ms (AC 7 "under 2.5 s")', () => {
    expect(lcpVerdict([2499, 2499, 9000, 100, 2600])).toEqual({ median: 2499, pass: true });
    expect(lcpVerdict([2500, 2500, 2500, 100, 100])).toEqual({ median: 2500, pass: false });
    expect(lcpVerdict([3000, 2600, 2700, 100, 200]).pass).toBe(false);
  });
});
