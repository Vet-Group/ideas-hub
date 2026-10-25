import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '@/lib/strings.vi';

/** Marks a proven ad (isProven), with a tooltip that states the rule (spec §6 "Market read"). */
export function ProvenChip() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="bg-warn-bg text-warn rounded-pill relative z-10 min-h-6 px-2 text-xs font-medium whitespace-nowrap">
          {t.keywords.market.proven}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{t.keywords.market.provenHelp}</TooltipContent>
    </Tooltip>
  );
}
