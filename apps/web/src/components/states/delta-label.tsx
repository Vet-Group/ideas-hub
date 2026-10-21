import { type Delta } from '@ideas-hub/core';
import { t } from '@/lib/strings.vi';
import { cn } from '@/lib/utils';

const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/**
 * A change with its baseline label (spec §6 "Charts", §3): a rise in the success color with ▲, a fall in
 * secondary text with ▼, never red; "từ 15/10 (chưa đủ 7 ngày dữ liệu)" when the baseline is short
 * ("Less than 7 days"), "—" with fewer than 2 snapshots.
 */
export function DeltaLabel({ delta }: { delta: Delta | null }) {
  if (!delta) return <span className="text-fg-2">{t.common.none}</span>;
  const n = delta.change;
  const text = n > 0 ? `+${n} ▲` : n < 0 ? `−${Math.abs(n)} ▼` : '0';
  return (
    <span>
      <span className={cn('font-mono whitespace-nowrap', n > 0 ? 'text-success' : 'text-fg-2')}>{text}</span>{' '}
      <span className="text-fg-muted text-xs">{delta.partial ? t.states.sinceShort(ddmm(delta.baselineDay)) : t.states.vsDate(ddmm(delta.baselineDay))}</span>
    </span>
  );
}
