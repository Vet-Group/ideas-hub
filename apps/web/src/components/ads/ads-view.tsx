import { AD_PAGE_SIZE, getAd, listAds, listKeywords } from '@ideas-hub/db/queries';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Pager } from '@/components/pager';
import { db } from '@/lib/db';
import { loadSettings, statusOptions } from '@/lib/settings';
import { saveTargets } from '@/lib/store';
import { requireUser } from '@/lib/session';
import { t } from '@/lib/strings.vi';
import { cn } from '@/lib/utils';
import { AdGrid } from './ad-grid';
import { toCard } from './cards';
import { DetailPane } from './detail-pane';
import { FilterRail } from './filter-rail';
import { PaneSheet } from './pane-sheet';
import { type SearchParams, adQuery, parseAdFilters } from './params';

/** `/ads` and `/ads/[id]`: filter rail, card grid and the detail pane, which a direct link opens. */
export async function AdsView({ params, selectedId }: { params: SearchParams; selectedId: string | null }) {
  const user = await requireUser();
  const settings = await loadSettings();
  const o = await statusOptions(settings);
  const f = parseAdFilters(params);
  const qs = adQuery(f);
  const [{ items: ads, total }, keywords, stores, selected] = await Promise.all([
    listAds(db, o, f),
    listKeywords(db, 'text'),
    saveTargets(user),
    selectedId ? getAd(db, o, selectedId) : Promise.resolve(null),
  ]);
  if (selectedId && !selected) notFound();
  const filterKeyword = f.keywordId ? keywords.find((k) => k.id === f.keywordId)?.text : undefined;
  const cards = ads.map((a) => toCard(a, `/ads/${encodeURIComponent(a.adArchiveId)}${qs}`, filterKeyword));
  const pane = selected ? <DetailPane ad={selected} saveStores={stores} /> : null;
  return (
    <>
      <PageHeader title={t.ads.title}>
        <span className="text-fg-2 text-sm">{t.ads.count(ads.length, total)}</span>
      </PageHeader>
      <p id="ads-key-help" className="sr-only">
        {t.ads.keyHelp}
      </p>
      {/* The 360 px pane only takes a column while an ad is open, so the grid keeps 3+ columns at 1440 px. */}
      <div className={cn('grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)]', selected && 'xl:grid-cols-[200px_minmax(0,1fr)_360px]')}>
        <FilterRail f={f} keywords={keywords.map((k) => ({ id: k.id, text: k.text }))} countries={settings.countries} />
        <div>
          {f.sort === 'trending' && ads.length > 0 && ads.every((a) => a.momentum === 0) ? (
            <p className="border-line text-fg-2 rounded-card mb-3 border border-dashed p-3 text-sm">{t.ads.trendingNoData}</p>
          ) : null}
          <AdGrid ads={cards} selectedId={selectedId} saveStores={stores} />
          <Pager page={f.page ?? 1} pageCount={Math.ceil(total / AD_PAGE_SIZE)} href={(page) => `/ads${adQuery({ ...f, page })}`} />
        </div>
        {selected ? (
          <aside className="hidden xl:block">
            {/* Below the sticky header (layout.tsx), never under it. */}
            <div className="bg-surface border-line rounded-card sticky top-[calc(var(--vet-header-h)+1rem)] max-h-[calc(100vh-var(--vet-header-h)-2rem)] overflow-y-auto border p-3">
              {pane}
            </div>
          </aside>
        ) : null}
      </div>
      {selected ? <PaneSheet closeHref={`/ads${qs}`}>{pane}</PaneSheet> : null}
    </>
  );
}
