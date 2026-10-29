import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { t } from '@/lib/strings.vi';

export const STATUSES = ['new', 'picked', 'done', 'dropped'] as const;
export type Status = (typeof STATUSES)[number];

const NEXT_STEP: Partial<Record<Status, Status>> = { new: 'picked', picked: 'done' };

/** One-click buttons beside the menu: the next step (New, Picked, Done) and Drop for an open idea. */
export function StatusButtons({ title, status, onChange }: { title: string; status: Status; onChange: (s: Status) => void }) {
  const next = NEXT_STEP[status];
  if (!next) return null;
  const step = t.ideaViews.nextStep[status]!;
  return (
    <>
      <Button type="button" size="sm" variant="outline" aria-label={t.ideaViews.nextStepOf(step, title)} onClick={() => onChange(next)}>
        {step}
      </Button>
      <Button type="button" size="sm" variant="ghost" aria-label={t.ideaViews.dropOf(title)} onClick={() => onChange('dropped')}>
        {t.ideaViews.drop}
      </Button>
    </>
  );
}

/** The status menu (2 actions: open it, pick a status); any status to any other, backwards included. */
export function StatusMenu({ title, status, onChange }: { title: string; status: Status; onChange: (s: Status) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="outline" aria-label={t.ideaViews.statusMenu(title)}>
          {t.ideaViews.statuses[status]}
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={status} onValueChange={(v) => v !== status && onChange(v as Status)}>
          {STATUSES.map((s) => (
            <DropdownMenuRadioItem key={s} value={s}>
              {t.ideaViews.statuses[s]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
