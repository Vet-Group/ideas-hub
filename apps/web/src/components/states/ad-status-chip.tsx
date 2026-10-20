import { type AdStatus } from '@ideas-hub/core';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '@/lib/strings.vi';
import { cn } from '@/lib/utils';

const TONE: Record<AdStatus, string> = {
  running: 'bg-chip-running-bg text-chip-running',
  out_of_top: 'bg-chip-out-of-top-bg text-chip-out-of-top',
  stopped_or_unknown: 'bg-chip-stopped-bg text-chip-stopped',
};

/** The ad status chip with a tooltip that explains the rule (spec §6 "Special states"). */
export function AdStatusChip({ status }: { status: AdStatus }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className={cn('rounded-pill relative z-10 min-h-6 px-2 text-xs font-medium', TONE[status])}>
          {t.states.adStatus[status]}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{t.states.adStatusHelp[status]}</TooltipContent>
    </Tooltip>
  );
}
