import { describe, expect, it } from 'vitest';
import { sharedBaseline } from './delta';

const d = (baselineDay: string, partial: boolean) => ({ change: 3, baselineDay, partial });

describe('sharedBaseline', () => {
  it('states a short baseline once when every row has it, ignoring rows without a change', () => {
    expect(sharedBaseline([d('2026-10-22', true), null, d('2026-10-22', true)])).toBe('từ 22/10 (chưa đủ 7 ngày dữ liệu)');
    expect(sharedBaseline([d('2026-10-17', false), d('2026-10-17', false)])).toBe('so với 17/10');
  });

  it('keeps the label per row when the baselines differ or there is none', () => {
    expect(sharedBaseline([d('2026-10-22', true), d('2026-10-23', true)])).toBeNull();
    expect(sharedBaseline([d('2026-10-17', true), d('2026-10-17', false)])).toBeNull();
    expect(sharedBaseline([null, null])).toBeNull();
    expect(sharedBaseline([])).toBeNull();
  });
});
