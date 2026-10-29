import { storeScope } from '@ideas-hub/core';
import { AD_PAGE_SIZE, getAd, listAds, listKeywords, savedRefs } from '@ideas-hub/db/queries';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Pager } from '@/components/pager';
import { Button } from '@/components/ui/button';
import { db } from '@/lib/db';
import { loadSettings, statusOptions } from '@/lib/settings';
import { saveTargets } from '@/lib/store';
import { requireUser } from '@/lib/session';
import { t } from '@/lib/strings.vi';
import { thumbUrl } from '@/lib/thumb-url';
import { AdsLayout } from './ads-layout';
import { toCard } from './cards';
import { DetailPane } from './detail-pane';
import { FilterRail } from './filter-rail';
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
  const saved = await savedRefs(db, storeScope(user), 'ad', [...cards.map((c) => c.adArchiveId), ...(selected ? [selected.adArchiveId] : [])]);
  const pane = selected ? <DetailPane ad={selected} thumbSrc={selected.thumbnailKey ? thumbUrl(selected.thumbnailKey) : null} saveStores={stores} saved={saved.includes(selected.adArchiveId)} /> : null;
  return (
    <>
      <PageHeader title={t.ads.title}>
        <span className="text-fg-2 text-sm">{t.ads.count(ads.length, total)}</span>
        <Button asChild size="sm" variant="outline">
          <a href={`/ads/csv${adQuery({ ...f, page: 1 })}`} download>
            {t.common.csv}
          </a>
        </Button>
      </PageHeader>
      <p id="ads-key-help" className="sr-only">
        {t.ads.keyHelp}
      </p>
      <AdsLayout
        rail={<FilterRail f={f} keywords={keywords.map((k) => ({ id: k.id, text: k.text }))} countries={settings.countries} />}
        notice={
          // Page 1 only: later pages of a descending sort end in zeros even when there is data.
          f.sort === 'trending' && (f.page ?? 1) === 1 && ads.length > 0 && ads.every((a) => a.momentum === 0) ? (
            <p className="border-line text-fg-2 rounded-card mb-3 border border-dashed p-3 text-sm">{t.ads.trendingNoData}</p>
          ) : null
        }
        pager={<Pager page={f.page ?? 1} pageCount={Math.ceil(total / AD_PAGE_SIZE)} href={(page) => `/ads${adQuery({ ...f, page })}`} />}
        cards={cards}
        saveStores={stores}
        saved={saved}
        initialId={selected ? selectedId : null}
        initialPane={pane}
        closeHref={`/ads${qs}`}
      />
    </>
  );
}
