import { storeScope } from '@ideas-hub/core';
import { type BriefingRow, briefingSuggestions, getAd, savedRefs } from '@ideas-hub/db/queries';
import { DetailPane } from '@/components/ads/detail-pane';
import { PaneSheet } from '@/components/ads/pane-sheet';
import { vnDay } from '@/lib/briefing';
import { db } from '@/lib/db';
import { ddmm, formatTime } from '@/lib/format';
import { requireUser } from '@/lib/session';
import { statusOptions } from '@/lib/settings';
import { saveTargets } from '@/lib/store';
import { t } from '@/lib/strings.vi';
import { AdRows } from './ad-rows';
import { NewsPanel, SuggestionsPanel } from './ai-panels';
import { CountTable } from './count-table';
import { KpiRow } from './kpi-row';

function Panel({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="bg-surface border-line rounded-card grid content-start gap-2 border p-3">
      <h2 id={id} className="font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * A briefing (spec §6): the KPI row and the source run's label, then top trending ads, rising new ads
 * and AI suggestions on the left; hot keywords, rising shops, and news and holidays on the right. A row
 * opens the ad sheet through `?ad=` on the same page (`basePath`).
 */
export async function BriefingView({ briefing, basePath, adId }: { briefing: BriefingRow; basePath: string; adId: string | null }) {
  const user = await requireUser();
  const s = briefing.sections;
  const scope = storeScope(user);
  const adIds = [...new Set([...(s.topAds ?? []), ...(s.risingAds ?? [])].map((a) => a.adArchiveId).concat(adId ?? []))];
  const [stores, rows, ad, savedAds] = await Promise.all([
    saveTargets(user),
    briefingSuggestions(db, briefing.id),
    adId ? getAd(db, await statusOptions(), adId) : Promise.resolve(null),
    savedRefs(db, scope, 'ad', adIds),
  ]);
  const savedSuggestions = await savedRefs(db, scope, 'suggestion', rows.map((r) => r.id));
  const adHref = (id: string) => `${basePath}?ad=${encodeURIComponent(id)}`;
  const run = s.sourceRun ? new Date(s.sourceRun.scheduledFor) : null;
  return (
    <div className="grid gap-4">
      {run ? <p className="text-fg-2 text-sm">{t.keywords.sourceRun(formatTime(run), ddmm(vnDay(run)))}</p> : null}
      <KpiRow kpi={s.kpi} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid content-start gap-4">
          <Panel id="b-top" title={t.briefing.top}>
            <AdRows ads={s.topAds ?? []} adHref={adHref} stores={stores} saved={savedAds} />
          </Panel>
          <Panel id="b-rising" title={t.briefing.rising}>
            <AdRows ads={s.risingAds ?? []} adHref={adHref} stores={stores} saved={savedAds} />
          </Panel>
          <Panel id="b-ai" title={t.briefing.suggestions}>
            <SuggestionsPanel section={s.suggestions} rows={rows} news={s.news} adHref={adHref} stores={stores} saved={savedSuggestions} />
          </Panel>
        </div>
        <div className="grid content-start gap-4">
          <Panel id="b-keywords" title={t.briefing.hotKeywords}>
            <CountTable rows={s.hotKeywords ?? []} head={t.keywords.keyword} href={(k) => `/keywords/${encodeURIComponent(k)}`} />
          </Panel>
          <Panel id="b-shops" title={t.briefing.risingShops}>
            <CountTable rows={s.risingShops ?? []} head={t.shops.domain} href={(k) => `/shops/${encodeURIComponent(k)}`} />
          </Panel>
          <Panel id="b-news" title={t.briefing.news}>
            <NewsPanel news={s.news} />
          </Panel>
        </div>
      </div>
      {ad ? (
        <PaneSheet closeHref={basePath} always>
          <DetailPane ad={ad} saveStores={stores} saved={savedAds.includes(ad.adArchiveId)} via="briefing" />
        </PaneSheet>
      ) : null}
    </div>
  );
}
