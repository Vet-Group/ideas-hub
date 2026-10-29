import { type MarketRead } from '@ideas-hub/core';
import { type KeywordRow } from '@ideas-hub/db/queries';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./db', () => ({ db: {} }));
const { keywordMarket, parseKeywordParams } = await import('./keyword-list');

const kw = (id: string, runningAds: number | null): KeywordRow => ({ id, text: id, origin: 'seed', active: true, runningAds, trackedBy: [] });
const read = (r: Partial<MarketRead>): MarketRead => ({ ads: 10, shops: 3, top3Share: 0.5, newAds: 0, newAdsBefore: 0, proven: 0, video: 0, ...r });

describe('parseKeywordParams', () => {
  it('reads the sort and the stage, ignoring unknown values', () => {
    expect(parseKeywordParams({})).toEqual({ sort: 'running_ads', stage: null });
    expect(parseKeywordParams({ sort: 'proven', stage: 'rising' })).toEqual({ sort: 'proven', stage: 'rising' });
    expect(parseKeywordParams({ sort: 'text' }).sort).toBe('text');
    expect(parseKeywordParams({ sort: 'nope', stage: 'nope' })).toEqual({ sort: 'running_ads', stage: null });
  });
});

describe('keywordMarket', () => {
  // SQL order (running ads) is a, b, c, d; d has no running ads and so no market read.
  const keywords = [kw('a', 50), kw('b', 40), kw('c', 30), kw('d', null)];
  const reads = new Map([
    ['a', read({ newAds: 1, proven: 5, shops: 9 })], // proven (50%)
    ['b', read({ newAds: 4, proven: 0, shops: 2 })], // rising (40%)
    ['c', read({ newAds: 0, proven: 0, shops: 4 })], // steady
  ]);
  const ids = (rows: KeywordRow[]) => rows.map((k) => k.id);

  it('keeps the SQL order on an SQL sort and counts the stages', () => {
    const m = keywordMarket(keywords, reads, 'running_ads', null);
    expect(ids(m.rows)).toEqual(['a', 'b', 'c', 'd']);
    expect(m.counts).toEqual({ rising: 1, proven: 1, steady: 1 });
    expect(m.stageOf(keywords[3]!)).toBeNull();
  });

  it('filters by stage; a keyword without a read is in no stage', () => {
    expect(ids(keywordMarket(keywords, reads, 'running_ads', 'rising').rows)).toEqual(['b']);
    expect(ids(keywordMarket(keywords, reads, 'running_ads', 'steady').rows)).toEqual(['c']);
  });

  it('sorts on the market read, high first, keywords without a read last', () => {
    expect(ids(keywordMarket(keywords, reads, 'new_ads', null).rows)).toEqual(['b', 'a', 'c', 'd']);
    expect(ids(keywordMarket(keywords, reads, 'proven', null).rows)).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(keywordMarket(keywords, reads, 'shops', null).rows)).toEqual(['a', 'c', 'b', 'd']);
  });
});
