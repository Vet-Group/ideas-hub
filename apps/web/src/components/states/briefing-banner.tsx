import Link from 'next/link';
import { ddmm } from '@/lib/format';
import { t } from '@/lib/strings.vi';

/**
 * "Before the ready time" (a note) and "Briefing late" (an amber banner with "Xem lại"), both above the
 * latest ready briefing, which is shown (spec §6 "Special states").
 */
export function BriefingBanner({ state, shownDate, readyTime }: { state: 'before_ready' | 'late'; shownDate: string; readyTime: string }) {
  if (state === 'before_ready') {
    return (
      <p role="status" className="bg-neutral-bg text-fg-2 rounded-card p-3 text-sm">
        {t.briefing.beforeReady(ddmm(shownDate), readyTime)}
      </p>
    );
  }
  return (
    <div role="status" className="bg-warn-bg text-warn border-warn-line rounded-card flex border flex-wrap items-center justify-between gap-2 p-3 text-sm">
      <span>{t.briefing.late(ddmm(shownDate))}</span>
      <Link href="/briefing" className="font-medium underline underline-offset-2">
        {t.briefing.retry}
      </Link>
    </div>
  );
}
