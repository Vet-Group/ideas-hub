'use client';

import { useMemo, useState } from 'react';
import { CartesianGrid, LabelList, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { t } from '@/lib/strings.vi';
import { buildChartRows, endLabelsFit, rangeStart, slotKey } from './series';

export interface Point {
  date: string;
  slotTime: string;
  runningAds: number;
}

const RANGES = ['14', '30', '90', 'all'] as const;
/** Fixed by slot order, never cycled (spec §6 "Charts"). */
const SERIES_COLORS = ['var(--ih-series-1)', 'var(--ih-series-2)', 'var(--ih-series-3)'];
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/**
 * Running ads per day, one line per slot: x is the slot's date in Asia/Ho_Chi_Minh, a missing snapshot
 * is a gap (`connectNulls` off), "7 ngày trước" a dashed rule, range 14 / 30 / 90 / all (30 by default)
 * and a "Bảng" toggle with the same data. Fewer than 2 snapshots: "Cần thêm dữ liệu".
 */
export function TrendChart({ points }: { points: Point[] }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>('30');
  const [asTable, setAsTable] = useState(false);
  const { slots, rows } = useMemo(() => buildChartRows(points), [points]);
  const shown = useMemo(() => {
    const from = range === 'all' ? null : rangeStart(rows, Number(range));
    return from ? rows.filter((r) => r.date >= from) : rows;
  }, [rows, range]);
  const endLabels = endLabelsFit(shown, slots);
  const weekAgo = rows.length ? rangeStart(rows, 8) : null;
  const config: ChartConfig = Object.fromEntries(slots.map((s, i) => [slotKey(s), { label: t.charts.slot(s), color: SERIES_COLORS[Math.min(i, 2)] }]));

  return (
    <section className="bg-surface border-line rounded-card grid gap-3 border p-3" aria-label={t.charts.title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{t.charts.title}</h2>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t.charts.range}>
          {RANGES.map((r) => (
            <Button key={r} type="button" size="sm" variant={range === r ? 'default' : 'ghost'} aria-pressed={range === r} onClick={() => setRange(r)}>
              {t.charts.ranges[r]}
            </Button>
          ))}
          <Button type="button" size="sm" variant="outline" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
            {asTable ? t.charts.chart : t.charts.table}
          </Button>
        </div>
      </div>
      {points.length < 2 ? (
        <p className="text-fg-2 text-sm">{t.states.needMoreData}</p>
      ) : asTable ? (
        <div className="max-h-80 overflow-y-auto" tabIndex={0}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.charts.date}</TableHead>
                {slots.map((s) => (
                  <TableHead key={s} className="text-right">
                    {t.charts.slot(s)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...shown].reverse().map((r) => (
                <TableRow key={r.date}>
                  <TableCell>{ddmm(r.date)}</TableCell>
                  {slots.map((s) => (
                    <TableCell key={s} className="text-right font-mono">
                      {r[slotKey(s)] ?? t.common.none}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <ChartContainer config={config} className="aspect-auto h-64 w-full [&_.recharts-surface:focus]:outline-2 [&_.recharts-surface:focus]:outline-solid [&_.recharts-surface:focus]:outline-ring">
          <LineChart data={shown} margin={{ top: 8, right: endLabels ? 64 : 16, bottom: 0, left: 0 }} accessibilityLayer>
            <CartesianGrid vertical={false} strokeOpacity={0.4} />
            <XAxis dataKey="date" tickFormatter={ddmm} tickLine={false} axisLine={false} tick={{ fill: 'var(--vet-ink)' }} minTickGap={16} />
            <YAxis domain={[0, 'auto']} allowDecimals={false} tickLine={false} axisLine={false} width={40} tick={{ fill: 'var(--vet-ink)' }} />
            {weekAgo && shown.some((r) => r.date === weekAgo) ? (
              <ReferenceLine x={weekAgo} stroke="var(--vet-text-secondary)" strokeDasharray="4 4" label={{ value: t.charts.weekAgo, position: 'insideTopRight', fill: 'var(--vet-ink)', fontSize: 12 }} />
            ) : null}
            <ChartTooltip cursor content={<ChartTooltipContent labelFormatter={(v) => ddmm(String(v))} />} />
            <ChartLegend content={<ChartLegendContent />} />
            {slots.map((s) => (
              <Line key={s} dataKey={slotKey(s)} name={slotKey(s)} type="linear" stroke={`var(--color-${slotKey(s)})`} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false}>
                {endLabels ? (
                  <LabelList dataKey={slotKey(s)} content={({ x, y, index, value }) => (index === shown.length - 1 && value != null ? <text x={Number(x) + 6} y={Number(y) + 4} fontSize={12} fill="var(--vet-ink)">{t.charts.slot(s)}</text> : null)} />
                ) : null}
              </Line>
            ))}
          </LineChart>
        </ChartContainer>
      )}
    </section>
  );
}
