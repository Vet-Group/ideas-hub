import { type Delta } from '@ideas-hub/core';
import { baselineText } from '@/lib/delta';
import { t } from '@/lib/strings.vi';
import { cn } from '@/lib/utils';

/**
 * A change with its baseline label (spec §6 "Charts", §3): a rise in the success color with ▲, a fall in
 * secondary text with ▼, never red; "từ 15/10 (chưa đủ 7 ngày dữ liệu)" when the baseline is short
 * ("Less than 7 days"), "—" with fewer than 2 snapshots. `bare` drops the label when the table states it.
 */
export function DeltaLabel({ delta, bare = false }: { delta: Delta | null; bare?: boolean }) {
  if (!delta) return <span className="text-fg-2">{t.common.none}</span>;
  const n = delta.change;
  const text = n > 0 ? `+${n} ▲` : n < 0 ? `−${Math.abs(n)} ▼` : '0';
  return (
    <span>
      <span className={cn('font-mono whitespace-nowrap', n > 0 ? 'text-success' : 'text-fg-2')}>{text}</span>
      {bare ? null : (
        <>
          {' '}
          <span className="text-fg-muted text-xs">{baselineText(delta)}</span>
        </>
      )}
    </span>
  );
}
