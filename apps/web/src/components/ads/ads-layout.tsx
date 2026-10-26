'use client';

import { usePathname } from 'next/navigation';
import { type ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { adPane } from '@/app/(app)/ads/actions';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/lib/strings.vi';
import { cn } from '@/lib/utils';
import { type AdCardData, AdGrid } from './ad-grid';
import { PaneSheet } from './pane-sheet';
import { type SaveTarget } from '@/components/save/save-button';

const idFromPath = (path: string) => (path.startsWith('/ads/') ? decodeURIComponent(path.slice('/ads/'.length)) : null);

/**
 * The ads grid and its detail pane. A card click only changes the URL (history.pushState, which Next keeps
 * in step with usePathname) and fetches the one pane, so the grid and its scroll stay; Back and Forward
 * open and close the pane the same way. A direct link gets its pane from the server.
 */
export function AdsLayout({
  rail,
  notice,
  pager,
  cards,
  saveStores,
  saved,
  initialId,
  initialPane,
  closeHref,
}: {
  rail: ReactNode;
  notice: ReactNode;
  pager: ReactNode;
  cards: AdCardData[];
  saveStores: SaveTarget[];
  saved: string[];
  initialId: string | null;
  initialPane: ReactNode;
  closeHref: string;
}) {
  const urlId = idFromPath(usePathname());
  const [pane, setPane] = useState<{ id: string; node: ReactNode } | null>(initialId ? { id: initialId, node: initialPane } : null);
  const shown = useRef(pane?.id ?? null);

  useEffect(() => {
    if (urlId === shown.current) return;
    shown.current = urlId;
    if (!urlId) return setPane(null);
    let live = true;
    setPane({ id: urlId, node: null });
    adPane(urlId).then(
      (node) => live && setPane({ id: urlId, node: node ?? <p className="text-fg-2 text-sm">{t.common.notFoundBody}</p> }),
      // The pane could not load: open the ad's page the old way.
      () => live && window.location.assign(window.location.href),
    );
    return () => {
      live = false;
    };
  }, [urlId]);

  const loading = (
    <div role="status" aria-busy="true" aria-label={t.common.loading} className="grid gap-3">
      <Skeleton className="aspect-[4/3] w-full" />
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
  // Its own boundary: the pane's client components may still be loading, and suspending to the page's
  // boundary would swap the whole grid for the page skeleton.
  const body = pane?.node ? <Suspense fallback={loading}>{pane.node}</Suspense> : loading;
  return (
    <>
      {/* The 360 px pane only takes a column while an ad is open, so the grid keeps 3+ columns at 1440 px. */}
      <div className={cn('grid gap-4 xl:grid-cols-[200px_minmax(0,1fr)]', pane && 'xl:grid-cols-[200px_minmax(0,1fr)_360px]')}>
        {rail}
        <div>
          {notice}
          <AdGrid ads={cards} selectedId={pane?.id ?? null} saveStores={saveStores} saved={saved} onOpen={(href) => window.history.pushState(null, '', href)} />
          {pager}
        </div>
        {pane ? (
          <aside className="hidden xl:block">
            {/* Below the sticky header (layout.tsx), never under it. */}
            <div className="bg-surface border-line rounded-card sticky top-[calc(var(--vet-header-h)+1rem)] max-h-[calc(100vh-var(--vet-header-h)-2rem)] overflow-y-auto border p-3">
              {body}
            </div>
          </aside>
        ) : null}
      </div>
      {pane ? (
        <PaneSheet closeHref={closeHref} onClose={() => window.history.pushState(null, '', closeHref)}>
          {body}
        </PaneSheet>
      ) : null}
    </>
  );
}
