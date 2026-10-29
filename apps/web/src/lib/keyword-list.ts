import 'server-only';
import { type MarketRead, type MarketStage, marketStage } from '@ideas-hub/core';
import { KEYWORD_SORTS, type KeywordRow, type KeywordSort, listKeywords, marketReads } from '@ideas-hub/db/queries';
import { db } from './db';
import { loadSettings, statusOptions } from './settings';

/** Sorts on the market read, done here on the 41-odd keywords; the others sort in SQL. */
export const MARKET_SORTS = ['new_ads', 'proven', 'shops'] as const;
export type KeywordViewSort = KeywordSort | (typeof MARKET_SORTS)[number];
const SORTS: readonly string[] = [...KEYWORD_SORTS, ...MARKET_SORTS];
export const STAGES: MarketStage[] = ['rising', 'proven', 'steady'];

const share = (r: MarketRead | undefined, part: (r: MarketRead) => number) => (r && r.ads ? part(r) / r.ads : -1);
const MARKET_ORDER: Record<(typeof MARKET_SORTS)[number], (r: MarketRead | undefined) => number> = {
  new_ads: (r) => share(r, (x) => x.newAds),
  proven: (r) => share(r, (x) => x.proven),
  shops: (r) => r?.shops ?? -1,
};

/** The `/keywords` query string; the page and its CSV export read it the same way. */
export function parseKeywordParams(p: { sort?: string; stage?: string }): { sort: KeywordViewSort; stage: MarketStage | null } {
  return {
    sort: SORTS.includes(p.sort ?? '') ? (p.sort as KeywordViewSort) : 'running_ads',
    stage: STAGES.includes(p.stage as MarketStage) ? (p.stage as MarketStage) : null,
  };
}

/** The stage filter and the market sorts on keywords already listed in SQL order. */
export function keywordMarket(keywords: KeywordRow[], reads: Map<string, MarketRead>, sort: KeywordViewSort, stage: MarketStage | null) {
  // No stage without running ads to read: such a keyword shows a dash and is in no stage filter.
  const stageOf = (k: KeywordRow) => {
    const r = reads.get(k.id);
    return r && r.ads ? marketStage(r) : null;
  };
  const counts = Object.fromEntries(STAGES.map((st) => [st, keywords.filter((k) => stageOf(k) === st).length]));
  const order = (MARKET_SORTS as readonly string[]).includes(sort) ? MARKET_ORDER[sort as (typeof MARKET_SORTS)[number]] : null;
  // Array.sort is stable: equal values keep the SQL order (running ads).
  const rows = keywords.filter((k) => !stage || stageOf(k) === stage).sort((a, b) => (order ? order(reads.get(b.id)) - order(reads.get(a.id)) : 0));
  return { rows, counts, stageOf };
}

export async function loadKeywordMarket(sort: KeywordViewSort, stage: MarketStage | null) {
  const settings = await loadSettings();
  const [keywords, reads] = await Promise.all([
    listKeywords(db, (KEYWORD_SORTS as readonly string[]).includes(sort) ? (sort as KeywordSort) : 'running_ads'),
    statusOptions(settings).then((o) => marketReads(db, o, { nonShopDomains: settings.nonShopDomains })),
  ]);
  return { keywords, reads, ...keywordMarket(keywords, reads, sort, stage) };
}
