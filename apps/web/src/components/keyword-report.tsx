import { VIETNAM, angleMix, canSeeKeywordAi, nextSlotAfter, storeScope } from '@ideas-hub/core';
import { type AdRow, type SourceRun, adAngles, daySeries, keywordBriefingFor, getKeyword, hotKeywords, listAds, marketReads, risingNewAds, risingShops, savedRefs, savedSuggestions, sourceRun, titlePhrases, topTrendingAds } from '@ideas-hub/db/queries';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RunNowButton } from '@/app/(app)/keywords/run-now-button';
import { AdGridWithPane } from '@/components/ads/ad-pane';
import { NewsPanel, SuggestionsPanel } from '@/components/briefing/ai-panels';
import { CountTable } from '@/components/briefing/count-table';
import { toCard } from '@/components/ads/cards';
import { adQuery } from '@/components/ads/params';
import { TrendChart } from '@/components/charts/trend-chart';
import { EtsyMarketSection } from '@/components/etsy-market';
import { MarketReadPanel } from '@/components/market-read';
import { PageHeader } from '@/components/page-header';
import { DeltaLabel } from '@/components/states/delta-label';
import { NoData } from '@/components/states/no-data';
import { vnDay } from '@/lib/briefing';
import { db } from '@/lib/db';
import { isRealDate } from '@/lib/day';
import { etsyContactEmail } from '@/lib/etsy';
import { formatTime } from '@/lib/format';
import { now } from '@/lib/now';
import { mayRunNow, runNowBlocker } from '@/lib/run-now';
import { requireUser } from '@/lib/session';
import { loadSettings } from '@/lib/settings';
import { saveTargets } from '@/lib/store';
import { t } from '@/lib/strings.vi';

const vnDate = new Intl.DateTimeFormat('en-CA', { timeZone: VIETNAM, year: 'numeric', month: '2-digit', day: '2-digit' });
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** The end of a date in Asia/Ho_Chi_Minh: a past report uses the last run on or before it. */
const endOfVnDate = (date: string) => new Date(`${date}T23:59:59+07:00`);

/**
 * The keyword report (spec §3, §6): sections 1–4 from shared data with "running" ads only, the chart from
 * KeywordDay, Run now for those allowed, and the AI sections as §4 allows (built in Step 7).
 */
export async function KeywordReport({ id, date }: { id: string; date?: string }) {
  const user = await requireUser();
  const keyword = await getKeyword(db, id);
  if (!keyword || (date && !isRealDate(date))) notFound();
  const s = await loadSettings();
  const at = now();
  const canRun = mayRunNow(user, keyword) && !date;
  const run: SourceRun | null = await sourceRun(db, date ? endOfVnDate(date) : at);
  const o = { staleAfterDays: s.staleAfterDays, countries: s.countries, keywordId: id, limit: 12 };
  const status = run ? { today: run.crawlDay, staleAfterDays: s.staleAfterDays, countries: s.countries } : null;
  const [series, stores, top, rising, counts, shops, blocker, keywordAds, market, phrases] = await Promise.all([
    daySeries(db, 'keyword', id),
    saveTargets(user),
    run ? topTrendingAds(db, run, o) : [],
    run ? risingNewAds(db, run, o) : [],
    run ? hotKeywords(db, run, { keywordId: id }) : [],
    run ? risingShops(db, run, { limit: 1000, nonShopDomains: s.nonShopDomains }) : [],
    canRun ? runNowBlocker(s, at) : Promise.resolve(null),
    status ? listAds(db, status, { keywordId: id, limit: 10_000 }).then((r) => r.items) : [],
    status ? marketReads(db, status, { keywordId: id, nonShopDomains: s.nonShopDomains }).then((r) => r.get(id)) : undefined,
    status ? titlePhrases(db, status, { id, text: keyword.text }, s.nonShopDomains) : [],
  ]);
  // Section 4 for one keyword: the rising shops among the domains of its running ads.
  const domains = new Set(keywordAds.map((a) => a.landingDomain));
  const ownShops = shops.filter((r) => domains.has(r.key)).slice(0, 10);
  const provenIds = new Set(keywordAds.filter((a) => a.proven).map((a) => a.adArchiveId));
  const angles = angleMix([...(await adAngles(db, [...provenIds])).values()]);
  const next = nextSlotAfter(s.runTimes, at);
  const card = (a: AdRow) =>
    toCard(
      { ...a, title: null, link: null, mediaType: null, firstSeenDate: '', lastSeenDate: '', variants: null, proven: provenIds.has(a.adArchiveId), status: 'running', keywords: [{ id, text: keyword.text }], countries: [] },
      `/ads/${encodeURIComponent(a.adArchiveId)}`,
      keyword.text,
    );
  // AI sections: the keyword briefing of the report's date, only for those §4 allows (AC 4).
  const aiVisible = canSeeKeywordAi(user, { origin: keyword.origin, trackedBy: keyword.trackedBy });
  const kw = await keywordBriefingFor(db, user, id, date ?? vnDay(at));
  const kwBriefing = kw?.aiVisible && kw.briefing.readyAt ? kw : null;
  const scope = storeScope(user);
  const [savedAds, savedSuggestionIds] = await Promise.all([
    savedRefs(db, scope, 'ad', [...top, ...rising].map((a) => a.adArchiveId)),
    savedSuggestions(db, scope, kwBriefing?.suggestions ?? []),
  ]);
  const runLabel = run ? t.keywords.sourceRun(formatTime(run.scheduledFor), ddmm(vnDate.format(run.scheduledFor))) : null;
  // Etsy data is live, so only today's report shows it; hidden entirely without the Etsy env.
  const etsyContact = date ? null : etsyContactEmail();
  const field = 'border-input bg-surface h-9 rounded-md border px-2 text-sm outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/50';

  return (
    <>
      <PageHeader title={keyword.text}>{canRun ? <RunNowButton keywordId={id} blocker={blocker} /> : null}</PageHeader>
      <div className="grid gap-4">
        <div className="text-fg-2 flex flex-wrap items-center gap-3 text-sm">
          {runLabel ? <span>{runLabel}</span> : null}
          <form action={`/keywords/${id}`} method="get" className="flex items-center gap-2" aria-label={t.keywords.pastDate}>
            <label htmlFor="report-date">{t.keywords.pastDate}</label>
            <input id="report-date" name="date" type="date" defaultValue={date ?? vnDay(at)} className={field} />
            <button type="submit" className={field}>
              {t.ads.apply}
            </button>
          </form>
          {date ? (
            <Link href={`/keywords/${id}`} className="underline">
              {t.common.backToday}
            </Link>
          ) : null}
        </div>
        {!run ? <NoData nextRun={next ? formatTime(next) : null} /> : null}
        {run ? null : <TrendChart points={series} />}
        {run ? (
          <>
            <section className="grid gap-2" aria-labelledby="kw-s3">
              <h2 id="kw-s3" className="font-semibold">
                {t.keywords.section3}
              </h2>
              <p>
                <span className="font-mono text-lg">{counts[0]?.runningAds ?? t.common.none}</span> <DeltaLabel delta={counts[0]?.delta ?? null} />
              </p>
            </section>
            <section className="grid gap-2" aria-labelledby="kw-market">
              <h2 id="kw-market" className="font-semibold">
                {t.keywords.market.title}
              </h2>
              <MarketReadPanel read={market} />
              {phrases.length ? (
                <div className="grid gap-2">
                  <h3 className="text-sm font-medium">{t.keywords.market.phrases}</h3>
                  {/* Two lines per phrase in a grid: as one-line chips, 12 phrases stacked one per row on a phone. */}
                  <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {phrases.map((p) => (
                      <li key={p.phrase}>
                        <Link
                          href={`/ads${adQuery({ keywordId: id, title: p.phrase })}`}
                          className="border-line bg-surface hover:bg-muted focus-visible:ring-ring/50 grid h-full rounded-md border px-3 py-2 outline-none focus-visible:ring-[3px]"
                        >
                          <span className="text-sm font-medium">{p.phrase}</span>{' '}
                          <span className="text-fg-2 text-xs tabular-nums">{t.keywords.market.phraseCount(p.shops, p.ads)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <p className="text-fg-2 text-xs">{t.keywords.market.phrasesHelp}</p>
                </div>
              ) : null}
              {angles.rows.length ? (
                <div className="grid gap-2">
                  <h3 className="text-sm font-medium">{t.keywords.market.angles}</h3>
                  <ul className="flex flex-wrap gap-2">
                    {angles.rows.map((a) => (
                      <li key={a.angle} className="border-line bg-surface rounded-md border px-3 py-1 text-sm">
                        <span className="font-medium">{t.ads.angles[a.angle]}</span> <span className="text-fg-2 text-xs tabular-nums">{t.keywords.market.angleShare(a.pct, a.ads)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-fg-2 text-xs">{t.keywords.market.anglesHelp(angles.tagged)}</p>
                </div>
              ) : null}
            </section>
            {/* After the market read and phrases, which answer "what to make"; first, it pushed them 3 screens down on a phone. */}
            <TrendChart points={series} />
            <section className="grid gap-2" aria-labelledby="kw-s1">
              <h2 id="kw-s1" className="font-semibold">
                {t.keywords.section1}
              </h2>
              {top.length ? <AdGridWithPane ads={top.map(card)} saveStores={stores} saved={savedAds} /> : <p className="text-fg-2 text-sm">{t.keywords.sectionEmpty}</p>}
            </section>
            <section className="grid gap-2" aria-labelledby="kw-s2">
              <h2 id="kw-s2" className="font-semibold">
                {t.keywords.section2}
              </h2>
              {rising.length ? <AdGridWithPane ads={rising.map(card)} saveStores={stores} saved={savedAds} sheet={!top.length} /> : <p className="text-fg-2 text-sm">{t.keywords.sectionEmpty}</p>}
            </section>
            <section className="grid gap-2" aria-labelledby="kw-s4">
              <h2 id="kw-s4" className="font-semibold">
                {t.keywords.section4}
              </h2>
              {ownShops.length ? (
                <CountTable rows={ownShops} head={t.shops.domain} href={(k) => `/shops/${encodeURIComponent(k)}`} />
              ) : (
                <p className="text-fg-2 text-sm">{t.keywords.sectionEmpty}</p>
              )}
            </section>
          </>
        ) : null}
        {etsyContact ? <EtsyMarketSection keyword={keyword.text} contactEmail={etsyContact} /> : null}
        <section className="grid gap-2" aria-labelledby="kw-ai">
          <h2 id="kw-ai" className="font-semibold">
            {t.keywords.ai}
          </h2>
          {!aiVisible ? (
            <p className="text-fg-2 text-sm">{t.keywords.aiHidden}</p>
          ) : kwBriefing ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <SuggestionsPanel section={kwBriefing.sections.suggestions} rows={kwBriefing.suggestions} news={kwBriefing.sections.news} ads={[...(kwBriefing.sections.topAds ?? []), ...(kwBriefing.sections.risingAds ?? [])]} adHref={(a) => `/ads/${encodeURIComponent(a)}`} stores={stores} saved={savedSuggestionIds} />
              <NewsPanel news={kwBriefing.sections.news} />
            </div>
          ) : (
            <p className="text-fg-2 text-sm">{t.keywords.aiNone}</p>
          )}
        </section>
      </div>
    </>
  );
}
