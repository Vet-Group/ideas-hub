// Chart rows for trend-chart.tsx, pure so they are unit-tested: one row per calendar day from the first
// snapshot to the last, one column per slot time; a day without a snapshot is null, a gap in the line.

export interface SeriesInput {
  date: string;
  slotTime: string;
  runningAds: number;
}

export type ChartRow = { date: string } & Record<string, number | null | string>;

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** The column of a slot time: "01:00" → "s0100", a valid CSS variable suffix for the chart colors. */
export const slotKey = (slotTime: string) => `s${slotTime.replace(':', '')}`;

export function buildChartRows(points: readonly SeriesInput[]): { slots: string[]; rows: ChartRow[] } {
  const slots = [...new Set(points.map((p) => p.slotTime))].sort();
  if (points.length === 0) return { slots, rows: [] };
  const dates = points.map((p) => p.date).sort();
  const rows: ChartRow[] = [];
  for (let d = dates[0]!; d <= dates[dates.length - 1]!; d = addDays(d, 1)) {
    rows.push({ date: d, ...Object.fromEntries(slots.map((s) => [slotKey(s), null])) });
  }
  const byDate = new Map(rows.map((r) => [r.date, r]));
  for (const p of points) byDate.get(p.date)![slotKey(p.slotTime)] = p.runningAds;
  return { slots, rows };
}

/** The first date of the last `days` days of the rows (the last row's date counts as one). */
export function rangeStart(rows: readonly ChartRow[], days: number): string | null {
  const last = rows[rows.length - 1]?.date;
  return last ? addDays(last, -(days - 1)) : null;
}

/**
 * Whether each line's end label has room: the last values sit at least `gap` of the highest shown value
 * apart. Closer lines would print one label over the other; the legend names them anyway.
 */
export function endLabelsFit(rows: readonly ChartRow[], slots: readonly string[], gap = 0.08): boolean {
  const values = (r: ChartRow | undefined) => slots.map((s) => r?.[slotKey(s)]).filter((v): v is number => typeof v === 'number');
  const peak = Math.max(1, ...rows.flatMap(values));
  const last = values(rows.at(-1)).sort((a, b) => a - b);
  return last.every((v, i) => i === 0 || (v - last[i - 1]!) / peak >= gap);
}
