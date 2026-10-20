'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { t } from '@/lib/strings.vi';

/**
 * Below 1280 px the detail pane is a right sheet, on a phone (≤ 820 px) a bottom sheet (spec §6).
 * Closing it goes back to the grid with the same filters. At 1280 px and up the page shows the sticky
 * pane instead and this renders nothing.
 */
export function PaneSheet({ children, closeHref }: { children: ReactNode; closeHref: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<'none' | 'right' | 'bottom'>('none');
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1280px)');
    const phone = window.matchMedia('(max-width: 820px)');
    const update = () => setMode(wide.matches ? 'none' : phone.matches ? 'bottom' : 'right');
    update();
    wide.addEventListener('change', update);
    phone.addEventListener('change', update);
    return () => {
      wide.removeEventListener('change', update);
      phone.removeEventListener('change', update);
    };
  }, []);
  if (mode === 'none') return null;
  return (
    <Sheet open onOpenChange={(o) => (o ? null : router.push(closeHref, { scroll: false }))}>
      <SheetContent side={mode} className={mode === 'bottom' ? 'max-h-[85vh] overflow-y-auto p-4' : 'w-[360px] overflow-y-auto p-4 sm:max-w-[360px]'}>
        <SheetTitle className="sr-only">{t.ads.detail}</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
