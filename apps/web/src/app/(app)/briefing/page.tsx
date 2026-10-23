import { BriefingView } from '@/components/briefing/briefing-view';
import { DayNav } from '@/components/briefing/day-nav';
import { PageHeader } from '@/components/page-header';
import { BriefingBanner } from '@/components/states/briefing-banner';
import { todayBriefing, vnDay } from '@/lib/briefing';
import { now } from '@/lib/now';
import { loadSettings } from '@/lib/settings';
import { t } from '@/lib/strings.vi';

/** Today's global briefing, the page sign-in lands on (spec §6); or the latest ready one with its state. */
export default async function BriefingPage({ searchParams }: { searchParams: Promise<{ ad?: string }> }) {
  const [{ ad }, s] = await Promise.all([searchParams, loadSettings()]);
  const { state, briefing } = await todayBriefing(now(), s.briefingReadyTime);
  const shown = briefing?.date ?? vnDay(now());
  return (
    <>
      <PageHeader title={t.briefing.title} />
      {/* This page is the newest day, so it has no next link. */}
      <DayNav date={shown} latest={shown} />
      {state === 'before_ready' || state === 'late' ? <BriefingBanner state={state} shownDate={briefing!.date} readyTime={s.briefingReadyTime} /> : null}
      {briefing ? (
        <div className="mt-3">
          <BriefingView briefing={briefing} basePath="/briefing" adId={ad ?? null} />
        </div>
      ) : (
        <p className="border-line text-fg-2 rounded-card border border-dashed p-4">{t.briefing.none}</p>
      )}
    </>
  );
}
