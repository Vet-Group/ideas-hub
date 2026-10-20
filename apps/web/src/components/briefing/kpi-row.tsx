import { type BriefingKpi } from '@ideas-hub/core';
import { DeltaLabel } from '@/components/states/delta-label';
import { t } from '@/lib/strings.vi';

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
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
        <span className="text-base">
          <DeltaLabel delta={kpi.delta} />
        </span>
      </Tile>
      <Tile label={t.briefing.kpi.okRate}>{kpi.okRate === null ? t.common.none : `${Math.round(kpi.okRate * 1000) / 10}%`}</Tile>
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
