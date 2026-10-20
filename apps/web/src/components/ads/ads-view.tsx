import { getAd, listAds, listKeywords } from '@ideas-hub/db/queries';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { db } from '@/lib/db';
import { loadSettings, statusOptions } from '@/lib/settings';
import { saveTargets } from '@/lib/store';
import { requireUser } from '@/lib/session';
import { t } from '@/lib/strings.vi';
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
  const [ads, keywords, stores, selected] = await Promise.all([
    listAds(db, o, f),
    listKeywords(db, 'text'),
    saveTargets(user),
    selectedId ? getAd(db, o, selectedId) : Promise.resolve(null),
  ]);
  if (selectedId && !selected) notFound();
  const filterKeyword = f.keywordId ? keywords.find((k) => k.id === f.keywordId)?.text : undefined;
  const cards = ads.map((a) => toCard(a, `/ads/${encodeURIComponent(a.adArchiveId)}${qs}`, filterKeyword));
  const pane = selected ? <DetailPane ad={selected} saveStores={stores} /> : <p className="text-fg-2 text-sm">{t.ads.pickOne}</p>;
  return (
    <>
      <PageHeader title={t.ads.title}>
        <span className="text-fg-2 text-sm">{t.ads.count(ads.length)}</span>
      </PageHeader>
      <p id="ads-key-help" className="sr-only">
        {t.ads.keyHelp}
      </p>
      <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,1fr)_360px]">
        <FilterRail f={f} keywords={keywords.map((k) => ({ id: k.id, text: k.text }))} countries={settings.countries} />
        <AdGrid ads={cards} selectedId={selectedId} saveStores={stores} />
        <aside className="hidden xl:block">
          <div className="bg-surface border-line rounded-card sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto border p-3">{pane}</div>
        </aside>
      </div>
      {selected ? <PaneSheet closeHref={`/ads${qs}`}>{pane}</PaneSheet> : null}
    </>
  );
}
