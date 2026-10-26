'use client';

import { useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { adPane } from '@/app/(app)/ads/actions';
import { type SaveTarget } from '@/components/save/save-button';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/lib/strings.vi';
import { type AdCardData, AdGrid } from './ad-grid';
import { DetailPane } from './detail-pane';
import { PaneSheet } from './pane-sheet';

/**
 * The detail pane of the ad `id` names (null: none). It loads through the `adPane` action, so opening one
 * changes only the URL (history.pushState, which Next keeps in step with usePathname/useSearchParams) and
 * this pane, never the page around it.
 */
export function useAdPane(id: string | null, initial: { id: string; node: ReactNode } | null = null) {
  const [pane, setPane] = useState(initial);
  const shown = useRef(initial?.id ?? null);

  useEffect(() => {
    if (id === shown.current) return;
    shown.current = id;
    if (!id) return setPane(null);
    let live = true;
    setPane({ id, node: null });
    adPane(id).then(
      (p) => live && setPane({ id, node: p ? <DetailPane {...p} /> : <p className="text-fg-2 text-sm">{t.common.notFoundBody}</p> }),
      // The pane could not load: load the page the old way.
      () => live && window.location.assign(window.location.href),
    );
    return () => {
      live = false;
    };
  }, [id]);

  const loading = (
    <div role="status" aria-busy="true" aria-label={t.common.loading} className="grid gap-3">
      <Skeleton className="aspect-[4/3] w-full" />
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
  const body = pane?.node ?? loading;
  return { pane, body };
}

/** `?ad=<id>` on the current URL, or without it. */
function withAd(id: string | null) {
  const u = new URL(window.location.href);
  if (id) u.searchParams.set('ad', id);
  else u.searchParams.delete('ad');
  return `${u.pathname}${u.search}`;
}

/**
 * A card grid outside /ads (a shop, a keyword report): a card opens its pane in a sheet over the page,
 * under `?ad=<id>` so Back closes it, and the page keeps its scroll. A modified click opens /ads/<id>.
 * A page with several grids gives the sheet to one of them (`sheet`), so one ad opens one sheet.
 */
export function AdGridWithPane({
  ads,
  saveStores,
  saved,
  sheet = true,
}: {
  ads: AdCardData[];
  saveStores: SaveTarget[];
  saved: string[];
  sheet?: boolean;
}) {
  const id = useSearchParams().get('ad');
  return (
    <>
      <AdGrid ads={ads} selectedId={id} saveStores={saveStores} saved={saved} onOpen={(a) => window.history.pushState(null, '', withAd(a.adArchiveId))} />
      {sheet ? <AdSheet id={id} /> : null}
    </>
  );
}

function AdSheet({ id }: { id: string | null }) {
  const { pane, body } = useAdPane(id);
  return pane ? (
    <PaneSheet always onClose={() => window.history.pushState(null, '', withAd(null))}>
      {body}
    </PaneSheet>
  ) : null;
}
