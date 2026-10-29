import { durationTier } from '@ideas-hub/core';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '@/lib/strings.vi';

/** The duration tier of an ad by days active (durationTier), with a tooltip that states the thresholds. */
export function DurationTierChip({ daysActive }: { daysActive: number }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="bg-neutral-bg text-neutral rounded-pill relative z-10 min-h-6 px-2 text-xs font-medium whitespace-nowrap">
          {t.ads.tiers[durationTier(daysActive)]}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{t.ads.tiersHelp}</TooltipContent>
    </Tooltip>
  );
}
