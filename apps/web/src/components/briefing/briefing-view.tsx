import { storeScope } from '@ideas-hub/core';
import { type BriefingRow, briefingSuggestions, getAd, savedRefs, savedSuggestions } from '@ideas-hub/db/queries';
import { Suspense } from 'react';
import { DetailPane } from '@/components/ads/detail-pane';
import { PaneSheet } from '@/components/ads/pane-sheet';
import { Button } from '@/components/ui/button';
import { vnDay } from '@/lib/briefing';
import { db } from '@/lib/db';
import { ddmm, formatTime } from '@/lib/format';
import { requireUser } from '@/lib/session';
import { statusOptions } from '@/lib/settings';
import { saveTargets } from '@/lib/store';
import { t } from '@/lib/strings.vi';
import { thumbUrl } from '@/lib/thumb-url';
import { AdRows } from './ad-rows';
import { NewsPanel, SuggestionsPanel } from './ai-panels';
import { CountTable } from './count-table';
import { FollowedShopsBox } from './followed-shops-box';
import { KpiRow } from './kpi-row';

/** Panel heading ids in reading order (the desktop columns stacked), for the phone's section links. */
const SECTIONS = [
  ['b-ai', 'suggestions'],
  ['b-top', 'top'],
  ['b-rising', 'rising'],
  ['b-keywords', 'hotKeywords'],
  ['b-shops', 'risingShops'],
  ['b-news', 'news'],
] as const;

function Panel({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="bg-surface border-line rounded-card grid content-start gap-2 border p-3">
      <h2 id={id} className="scroll-mt-4 font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * A briefing (spec §6): the KPI row and the source run's label, then AI suggestions, top trending ads and
 * rising new ads on the left; hot keywords, rising shops, and news and holidays on the right. A row opens
 * the ad sheet through `?ad=` on the same page (`basePath`).
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
  const savedSuggestionIds = await savedSuggestions(db, scope, rows);
  const adHref = (id: string) => `${basePath}?ad=${encodeURIComponent(id)}`;
  const run = s.sourceRun ? new Date(s.sourceRun.scheduledFor) : null;
  return (
    <div className="grid gap-4">
      {run ? <p className="text-fg-2 text-sm">{t.keywords.sourceRun(formatTime(run), ddmm(vnDay(run)))}</p> : null}
      <KpiRow kpi={s.kpi} />
      {/* Stacked panels make a phone briefing about 8 screens long; these links reach each panel. */}
      <nav aria-label={t.briefing.sectionNav} className="flex flex-wrap gap-2 lg:hidden">
        {SECTIONS.map(([id, title]) => (
          <Button key={id} asChild size="sm" variant="outline">
            <a href={`#${id}`}>{t.briefing[title]}</a>
          </Button>
        ))}
      </nav>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid content-start gap-4">
          <Panel id="b-ai" title={t.briefing.suggestions}>
            <SuggestionsPanel section={s.suggestions} rows={rows} news={s.news} ads={[...(s.topAds ?? []), ...(s.risingAds ?? [])]} adHref={adHref} stores={stores} saved={savedSuggestionIds} />
          </Panel>
          <Panel id="b-top" title={t.briefing.top}>
            <AdRows ads={s.topAds ?? []} adHref={adHref} stores={stores} saved={savedAds} />
          </Panel>
          <Panel id="b-rising" title={t.briefing.rising}>
            <AdRows ads={s.risingAds ?? []} adHref={adHref} stores={stores} saved={savedAds} />
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
          {/* Its own query, streamed after the page: it never delays or breaks the briefing (it hides on error). Today's briefing only: it reads the last 7 days from now. */}
          {basePath === '/briefing' ? (
            <Suspense fallback={null}>
              <FollowedShopsBox user={user} />
            </Suspense>
          ) : null}
        </div>
      </div>
      {ad ? (
        <PaneSheet closeHref={basePath} always>
          <DetailPane ad={ad} thumbSrc={ad.thumbnailKey ? thumbUrl(ad.thumbnailKey) : null} saveStores={stores} saved={savedAds.includes(ad.adArchiveId)} via="briefing" />
        </PaneSheet>
      ) : null}
    </div>
  );
}
