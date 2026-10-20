import { t } from '@/lib/strings.vi';

/** An empty panel with one sentence and the next run time (spec §6 "No data yet"). */
export function NoData({ nextRun }: { nextRun: string | null }) {
  return <p className="border-line text-fg-2 rounded-card border border-dashed p-4">{t.states.noData(nextRun)}</p>;
}
