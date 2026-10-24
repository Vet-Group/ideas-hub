import { type Delta } from '@ideas-hub/core';
import { t } from '@/lib/strings.vi';

const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** "từ 15/10 (chưa đủ 7 ngày dữ liệu)" when the baseline is short ("Less than 7 days"), else "so với 15/10". */
export const baselineText = (d: Delta) => (d.partial ? t.states.sinceShort(ddmm(d.baselineDay)) : t.states.vsDate(ddmm(d.baselineDay)));

/** The baseline label every change in a table shares, so the table can state it once; null when they differ. */
export function sharedBaseline(deltas: readonly (Delta | null)[]): string | null {
  const labels = new Set(deltas.filter((d) => d !== null).map(baselineText));
  return labels.size === 1 ? [...labels][0]! : null;
}
