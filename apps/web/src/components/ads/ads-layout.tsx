'use client';

import { usePathname } from 'next/navigation';
import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { type AdCardData, AdGrid } from './ad-grid';
import { useAdPane } from './ad-pane';
import { PaneSheet } from './pane-sheet';
import { type SaveTarget } from '@/components/save/save-button';

const idFromPath = (path: string) => (path.startsWith('/ads/') ? decodeURIComponent(path.slice('/ads/'.length)) : null);

/**
 * The ads grid and its detail pane. A card click only pushes `/ads/<id>` and loads that one pane
 * (useAdPane), so the grid and its scroll stay; Back and Forward open and close the pane the same way.
 * A direct link gets its pane from the server.
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
  const { pane, body } = useAdPane(idFromPath(usePathname()), initialId ? { id: initialId, node: initialPane } : null);

  return (
    <>
      {/* The 360 px pane only takes a column while an ad is open, so the grid keeps 3+ columns at 1440 px. */}
      <div className={cn('grid gap-4 xl:grid-cols-[200px_minmax(0,1fr)]', pane && 'xl:grid-cols-[200px_minmax(0,1fr)_360px]')}>
        {rail}
        <div>
          {notice}
          <AdGrid ads={cards} selectedId={pane?.id ?? null} saveStores={saveStores} saved={saved} onOpen={(a) => window.history.pushState(null, '', a.href)} />
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
        <PaneSheet onClose={() => window.history.pushState(null, '', closeHref)}>
          {body}
        </PaneSheet>
      ) : null}
    </>
  );
}
