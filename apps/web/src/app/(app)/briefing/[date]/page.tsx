import { globalBriefing } from '@ideas-hub/db/queries';
import { notFound } from 'next/navigation';
import { BriefingView } from '@/components/briefing/briefing-view';
import { DayNav } from '@/components/briefing/day-nav';
import { PageHeader } from '@/components/page-header';
import { vnDay } from '@/lib/briefing';
import { db } from '@/lib/db';
import { isRealDate } from '@/lib/day';
import { ddmm } from '@/lib/format';
import { now } from '@/lib/now';
import { t } from '@/lib/strings.vi';

/** The global briefing of a past date (spec §6 "history by day"); Lark links name this page. */
export default async function BriefingOnPage({ params, searchParams }: { params: Promise<{ date: string }>; searchParams: Promise<{ ad?: string }> }) {
  const [{ date }, { ad }] = await Promise.all([params, searchParams]);
  if (!isRealDate(date)) notFound();
  const briefing = await globalBriefing(db, date);
  return (
    <>
      <PageHeader title={t.briefing.titleOn(ddmm(date))} />
      <DayNav date={date} latest={vnDay(now())} />
      {briefing?.readyAt ? (
        <BriefingView briefing={briefing} basePath={`/briefing/${date}`} adId={ad ?? null} />
      ) : (
        <p className="border-line text-fg-2 rounded-card border border-dashed p-4">{t.briefing.noneOn(ddmm(date))}</p>
      )}
    </>
  );
}
