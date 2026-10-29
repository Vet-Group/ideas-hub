import { type MarketStage } from '@ideas-hub/core';
import { type KeywordRow } from '@ideas-hub/db/queries';
import Link from 'next/link';
import { MarketStageChip, Share, pct } from '@/components/market-read';
import { PageHeader } from '@/components/page-header';
import { SortHead } from '@/components/sort-head';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { STAGES, loadKeywordMarket, parseKeywordParams } from '@/lib/keyword-list';
import { requireUser } from '@/lib/session';
import { t } from '@/lib/strings.vi';

const m = t.keywords.market;
const Stage = ({ stage }: { stage: MarketStage | null }) => (stage ? <MarketStageChip stage={stage} /> : <span className="text-fg-muted">{t.common.none}</span>);

function KeywordName({ k }: { k: KeywordRow }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Link href={`/keywords/${k.id}`} className="font-medium underline-offset-2 hover:underline">
        {k.text}
      </Link>
      {k.origin === 'store' ? <span className="bg-neutral-bg text-fg-2 rounded-pill px-2 text-xs">{t.keywords.origins.store}</span> : null}
      {k.active ? null : <span className="bg-neutral-bg text-fg-2 rounded-pill px-2 text-xs">{t.keywords.paused}</span>}
    </span>
  );
}

/** The keywords as markets (spec §6 "Market read"): stage, new and proven ads, shops; a list of cards on phones. */
export default async function KeywordsPage({ searchParams }: { searchParams: Promise<{ sort?: string; stage?: string }> }) {
  await requireUser();
  const p = await searchParams;
  const { sort, stage: stageFilter } = parseKeywordParams(p);
  const { keywords, reads, rows, counts, stageOf } = await loadKeywordMarket(sort, stageFilter);
  const base = `/keywords${stageFilter ? `?stage=${stageFilter}` : ''}`;
  const stageHref = (st: MarketStage | null) => `/keywords?${new URLSearchParams({ ...(sort === 'running_ads' ? {} : { sort }), ...(st ? { stage: st } : {}) })}`;

  return (
    <>
      <PageHeader title={t.keywords.title}>
        <Button asChild size="sm" variant="outline">
          <a href={`/keywords/csv?${new URLSearchParams({ sort, ...(stageFilter ? { stage: stageFilter } : {}) })}`} download>
            {t.common.csv}
          </a>
        </Button>
      </PageHeader>
      {keywords.length === 0 ? (
        <p className="text-fg-2">{t.keywords.empty}</p>
      ) : (
        <div className="grid gap-4">
          <nav aria-label={t.keywords.stageFilter} className="flex flex-wrap gap-2">
            {[null, ...STAGES].map((st) => (
              <Button key={st ?? 'all'} asChild size="sm" variant={st === stageFilter ? 'default' : 'outline'}>
                <Link href={stageHref(st)} aria-current={st === stageFilter ? 'page' : undefined}>
                  {st ? `${m.stages[st]} · ${counts[st]}` : `${t.keywords.allStages} · ${keywords.length}`}
                </Link>
              </Button>
            ))}
          </nav>
          {stageFilter ? <p className="text-fg-2 -mt-2 text-sm">{m.stageHelp[stageFilter]}</p> : null}
          <ul className="divide-line bg-surface border-line rounded-card grid divide-y border md:hidden">
            {rows.map((k) => {
              const r = reads.get(k.id);
              return (
                <li key={k.id} className="grid gap-1 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <KeywordName k={k} />
                    <Stage stage={stageOf(k)} />
                  </div>
                  <p className="text-fg-2 text-xs">
                    {[
                      k.runningAds === null ? m.noRunning : `${k.runningAds} ${t.keywords.runningAds.toLowerCase()}`,
                      r ? `${m.newAds.toLowerCase()} ${pct(r.newAds, r.ads)}` : null,
                      r ? `${m.proven.toLowerCase()} ${pct(r.proven, r.ads)}` : null,
                      r ? `${r.shops} ${m.shops.toLowerCase()}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </li>
              );
            })}
          </ul>
          {/* min-w-0: as a grid item it would widen to the table and scroll the page instead of the table frame. */}
          <div className="hidden min-w-0 md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead label={t.keywords.keyword} sort="text" current={sort} base={base} />
                  <TableHead>{m.stage}</TableHead>
                  <SortHead label={t.keywords.runningAds} sort="running_ads" current={sort} base={base} className="text-right" />
                  <SortHead label={m.newAds} sort="new_ads" current={sort} base={base} className="text-right" />
                  <SortHead label={m.proven} sort="proven" current={sort} base={base} className="text-right" />
                  <SortHead label={m.shops} sort="shops" current={sort} base={base} className="text-right" />
                  <TableHead className="text-right">{m.top3}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((k) => {
                  const r = reads.get(k.id);
                  return (
                    <TableRow key={k.id}>
                      <TableCell>
                        <KeywordName k={k} />
                      </TableCell>
                      <TableCell>
                        <Stage stage={stageOf(k)} />
                      </TableCell>
                      <TableCell className="text-right font-mono">{k.runningAds ?? t.common.none}</TableCell>
                      <TableCell className="text-right font-mono">{r ? <Share part={r.newAds} whole={r.ads} /> : t.common.none}</TableCell>
                      <TableCell className="text-right font-mono">{r ? <Share part={r.proven} whole={r.ads} /> : t.common.none}</TableCell>
                      <TableCell className="text-right font-mono">{r?.shops ?? t.common.none}</TableCell>
                      <TableCell className="text-right font-mono">{r && r.top3Share !== null ? `${Math.round(r.top3Share * 100)}%` : t.common.none}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <p className="text-fg-muted text-xs">
            {m.proven}: {m.provenHelp}. {m.newAds}: {t.keywords.market.newDefinition}
          </p>
        </div>
      )}
    </>
  );
}
