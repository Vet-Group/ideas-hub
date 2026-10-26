'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { t } from '@/lib/strings.vi';
import { cn } from '@/lib/utils';

/**
 * Below 1280 px the detail pane is a right sheet, on a phone (≤ 820 px) a bottom sheet (spec §6).
 * Closing it goes back to the grid with the same filters. At 1280 px and up the page shows the sticky
 * pane instead and this renders nothing, unless `always` (the briefing has no pane column).
 */
export function PaneSheet({
  children,
  closeHref,
  always,
  onClose,
}: {
  children: ReactNode;
  closeHref?: string;
  always?: boolean;
  /** Closes without a navigation (the ads grid); else closing goes to `closeHref`. */
  onClose?: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'none' | 'right' | 'bottom'>('none');
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1280px)');
    const phone = window.matchMedia('(max-width: 820px)');
    const update = () => setMode(wide.matches && !always ? 'none' : phone.matches ? 'bottom' : 'right');
    update();
    wide.addEventListener('change', update);
    phone.addEventListener('change', update);
    return () => {
      wide.removeEventListener('change', update);
      phone.removeEventListener('change', update);
    };
  }, [always]);
  if (mode === 'none') return null;
  return (
    <Sheet open onOpenChange={(o) => (o ? null : onClose ? onClose() : closeHref && router.push(closeHref, { scroll: false }))}>
      <SheetContent
        side={mode}
        data-pane={mode}
        // Focus the sheet itself: Radix would focus its first control, the status chip, and open its tooltip.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
        }}
        className={cn('group overflow-y-auto p-4 pt-12', mode === 'bottom' ? 'max-h-[85vh]' : 'w-[360px] sm:max-w-[360px]')}
      >
        <SheetTitle className="sr-only">{t.ads.detail}</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
