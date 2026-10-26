import { type BriefingKpi } from '@ideas-hub/core';
import { DeltaLabel } from '@/components/states/delta-label';
import { baselineText } from '@/lib/delta';
import { t } from '@/lib/strings.vi';

export function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border-line rounded-card grid gap-1 border p-3">
      <dt className="text-fg-2 text-xs">{label}</dt>
      <dd className="font-mono text-[22px] leading-tight tabular-nums md:text-[28px]">{children}</dd>
    </div>
  );
}

/** The KPI row from the briefing's source run (spec §6): 4 tiles, 2 × 2 on a phone. */
export function KpiRow({ kpi }: { kpi: BriefingKpi | undefined }) {
  if (!kpi) return null;
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label={t.briefing.kpi.runningAds}>{kpi.runningAds}</Tile>
      <Tile label={t.briefing.kpi.change}>
        {/* The number at tile size, its baseline under it like the holiday tile's line; inline, the
            baseline wrapped the tile to three lines on a phone. */}
        <DeltaLabel delta={kpi.delta} bare />
        {kpi.delta ? (
          <>
            {' '}
            <span className="text-fg-2 block font-sans text-xs">{baselineText(kpi.delta)}</span>
          </>
        ) : null}
      </Tile>
      <Tile label={t.briefing.kpi.okRate}>
        {kpi.okRate === null ? t.common.none : `${Math.round(kpi.okRate * 1000) / 10}%`}
        {/* A blocked run reads as "0%" alone; say what the rest of the page is built on. 0.9 is AC 1's bar. */}
        {kpi.okRate !== null && kpi.okRate < 0.9 ? (
          <span className="text-fg-2 block font-sans text-xs">{t.briefing.kpi.okRateLow}</span>
        ) : null}
      </Tile>
      <Tile label={t.briefing.kpi.holiday}>
        {kpi.nextHoliday ? (
          <>
            {kpi.nextHoliday.days}
            <span className="text-fg-2 block font-sans text-xs">{t.briefing.kpi.holidayIn(kpi.nextHoliday.days, kpi.nextHoliday.name)}</span>
          </>
        ) : (
          t.common.none
        )}
      </Tile>
    </dl>
  );
}
