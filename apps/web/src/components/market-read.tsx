import { type MarketRead, type MarketStage, marketStage } from '@ideas-hub/core';
import { Tile } from '@/components/briefing/kpi-row';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '@/lib/strings.vi';
import { cn } from '@/lib/utils';

const m = t.keywords.market;

const TONE: Record<MarketStage, string> = {
  rising: 'bg-success-bg text-success',
  proven: 'bg-warn-bg text-warn',
  steady: 'bg-neutral-bg text-neutral',
};

export const pct = (part: number, whole: number) => (whole ? `${Math.round((part * 100) / whole)}%` : t.common.none);

/** In a table cell: the share leads (it compares rows); the count follows, muted. */
export const Share = ({ part, whole }: { part: number; whole: number }) => (
  <>
    {pct(part, whole)} <span className="text-fg-muted">({part})</span>
  </>
);

/** The market stage chip with a tooltip that states its rule (spec §6 "Market read"). */
export function MarketStageChip({ stage }: { stage: MarketStage }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className={cn('rounded-pill min-h-6 px-2 text-xs font-medium whitespace-nowrap', TONE[stage])}>
          {m.stages[stage]}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{m.stageHelp[stage]}</TooltipContent>
    </Tooltip>
  );
}

// The space keeps the number and its line apart in the accessible text; the line is a block, so it never shows.
export const Sub = ({ children }: { children: React.ReactNode }) => (
  <>
    {' '}
    <span className="text-fg-2 block font-sans text-xs">{children}</span>
  </>
);

/** The keyword report's market read: its stage and 4 tiles (2 × 2 on a phone). */
export function MarketReadPanel({ read }: { read: MarketRead | undefined }) {
  if (!read || read.ads === 0) return <p className="text-fg-2 text-sm">{m.none}</p>;
  const stage = marketStage(read);
  return (
    <div className="grid gap-3">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-fg-2">{m.stage}:</span>
        <MarketStageChip stage={stage} />
        <span className="text-fg-2">{m.stageHelp[stage]}</span>
      </p>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label={m.newAds}>
          {read.newAds}
          <Sub>{m.newBefore(read.newAdsBefore)}</Sub>
        </Tile>
        <Tile label={m.proven}>
          {read.proven}
          <Sub>{m.ofAds(pct(read.proven, read.ads))}</Sub>
        </Tile>
        <Tile label={m.shops}>
          {read.shops}
          {read.top3Share === null ? null : <Sub>{m.top3Of(`${Math.round(read.top3Share * 100)}%`)}</Sub>}
        </Tile>
        <Tile label={m.video}>
          {pct(read.video, read.ads)}
          <Sub>{m.outOf(read.video, read.ads)}</Sub>
        </Tile>
      </dl>
      <p className="text-fg-muted text-xs">
        {m.intro} {m.proven}: {m.provenHelp}.
      </p>
    </div>
  );
}
