import { type Viewer } from '@ideas-hub/core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, createDb, createPool } from '../client';
import { SEED_FEEDS, SEED_HOLIDAYS, seedFeeds, seedHolidays } from '../seed-data';
import { createTestDatabase, testDatabaseAvailable } from '../testing';
import { briefingSuggestions, globalBriefing, keywordBriefingFor, latestReadyBriefing, suggestionForViewer } from './briefing-view';

const view = (storeId: string) => ({ storeId, view: true, save: false, keywords: false });
const admin: Viewer = { userId: 'user_admin', role: 'admin', memberships: [] };
const memberA: Viewer = { userId: 'user_a', role: 'member', memberships: [view('store_A')] };
const memberB: Viewer = { userId: 'user_b', role: 'member', memberships: [view('store_B')] };
const nobody: Viewer = { userId: 'user_n', role: 'member', memberships: [] };

const SECTIONS = {
  topAds: [],
  news: { state: 'ok', summary: 'AI summary', items: [], holidays: [] },
  suggestions: { state: 'ok', count: 2 },
};

describe.skipIf(!testDatabaseAvailable())('briefing reads', () => {
  let drop: () => Promise<void>;
  let pool: ReturnType<typeof createPool>;
  let db: Db;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    pool = createPool(t.url, 3);
    db = createDb(pool);
    const json = JSON.stringify(SECTIONS);
    // One multi-statement text (no parameters), the sections JSON inlined.
    await pool.query(`
      insert into stores (id, name) values ('store_A', 'A'), ('store_B', 'B');
      insert into keywords (id, text, origin) values ('kw_a', 'only a', 'store'), ('kw_b', 'only b', 'store'), ('kw_seed', 'seed one', 'seed');
      insert into store_keywords (store_id, keyword_id) values ('store_A', 'kw_a'), ('store_B', 'kw_b');
      insert into briefings (id, date, scope, keyword_id, sections, ready_at) values
        ('brf_g19', '2026-10-19', 'global', null, '{}', '2026-10-18T23:50:00Z'),
        ('brf_g20', '2026-10-20', 'global', null, '{}', '2026-10-19T23:50:00Z'),
        ('brf_g21', '2026-10-21', 'global', null, '{}', null),
        ('brf_ka', '2026-10-21', 'keyword', 'kw_a', '${json}', '2026-10-20T23:55:00Z'),
        ('brf_kb', '2026-10-21', 'keyword', 'kw_b', '${json}', '2026-10-20T23:55:00Z'),
        ('brf_ks', '2026-10-21', 'keyword', 'kw_seed', '${json}', '2026-10-20T23:55:00Z');
      insert into suggestions (id, briefing_id, kind, text, reason, evidence, created_at) values
        ('sug_2', 'brf_kb', 'keyword', 'second', 'r', '{"ads":["a1"],"news":[]}', '2026-10-21T00:00:01Z'),
        ('sug_1', 'brf_kb', 'idea', 'first', 'r', '{"ads":["a1"],"news":[]}', '2026-10-21T00:00:00Z'),
        ('sug_a', 'brf_ka', 'idea', 'for a', 'r', '{"ads":[],"news":["news_1"]}', '2026-10-21T00:00:00Z'),
        ('sug_g', 'brf_g21', 'idea', 'global one', 'r', '{"ads":[],"news":[]}', '2026-10-21T00:00:00Z')`);
  }, 60_000);
  afterAll(async () => {
    await pool?.end();
    await drop?.();
  });

  it('a member of store A cannot read the AI sections of a keyword briefing only store B tracks; B and an admin can', async () => {
    const asA = await keywordBriefingFor(db, memberA, 'kw_b', '2026-10-21');
    expect(asA).toMatchObject({ aiVisible: false, suggestions: [], sections: { topAds: [] } });
    expect(asA!.sections).not.toHaveProperty('news');
    expect(asA!.sections).not.toHaveProperty('suggestions');
    expect(asA!.briefing.sections).not.toHaveProperty('news');
    expect(await keywordBriefingFor(db, nobody, 'kw_b', '2026-10-21')).toMatchObject({ aiVisible: false, suggestions: [] });
    for (const v of [memberB, admin]) {
      const r = await keywordBriefingFor(db, v, 'kw_b', '2026-10-21');
      expect(r).toMatchObject({ aiVisible: true, sections: { news: { summary: 'AI summary' } } });
      expect(r!.suggestions.map((s) => s.id)).toEqual(['sug_1', 'sug_2']);
    }
    expect((await keywordBriefingFor(db, memberA, 'kw_a', '2026-10-21'))!.suggestions.map((s) => s.text)).toEqual(['for a']);
  });

  it('a seed keyword’s AI sections are visible to everyone; a missing briefing is null', async () => {
    expect(await keywordBriefingFor(db, nobody, 'kw_seed', '2026-10-21')).toMatchObject({ aiVisible: true });
    expect(await keywordBriefingFor(db, admin, 'kw_a', '2026-10-20')).toBeNull();
  });

  it('suggestionForViewer refuses a keyword briefing’s suggestion the viewer may not see (AC 4)', async () => {
    expect(await suggestionForViewer(db, memberA, 'sug_1')).toBeNull();
    expect(await suggestionForViewer(db, nobody, 'sug_1')).toBeNull();
    for (const v of [memberB, admin]) {
      expect(await suggestionForViewer(db, v, 'sug_1')).toEqual({
        id: 'sug_1', kind: 'idea', text: 'first', reason: 'r', evidence: { ads: ['a1'], news: [] }, scope: 'keyword', keyword: 'only b',
      });
    }
    expect(await suggestionForViewer(db, memberA, 'sug_a')).toMatchObject({ id: 'sug_a', keyword: 'only a' });
    expect(await suggestionForViewer(db, nobody, 'sug_g')).toMatchObject({ id: 'sug_g', scope: 'global', keyword: null });
    expect(await suggestionForViewer(db, admin, 'sug_missing')).toBeNull();
  });

  it('globalBriefing, latestReadyBriefing and briefingSuggestions', async () => {
    expect(await globalBriefing(db, '2026-10-21')).toMatchObject({ id: 'brf_g21', readyAt: null, scope: 'global' });
    expect(await globalBriefing(db, '2026-10-22')).toBeNull();
    expect(await latestReadyBriefing(db, '2026-10-21')).toMatchObject({ id: 'brf_g20', date: '2026-10-20' });
    expect(await latestReadyBriefing(db, '2026-10-19')).toMatchObject({ id: 'brf_g19' });
    expect(await latestReadyBriefing(db, '2026-10-18')).toBeNull();
    expect(await briefingSuggestions(db, 'brf_kb')).toEqual([
      { id: 'sug_1', kind: 'idea', text: 'first', reason: 'r', evidence: { ads: ['a1'], news: [] } },
      { id: 'sug_2', kind: 'keyword', text: 'second', reason: 'r', evidence: { ads: ['a1'], news: [] } },
    ]);
  });

  it('the seed loads the US holidays and the default feeds once', async () => {
    expect(await seedHolidays(db)).toBe(SEED_HOLIDAYS.length);
    expect(await seedHolidays(db)).toBe(0);
    expect(await seedFeeds(db)).toBe(SEED_FEEDS.length);
    expect(await seedFeeds(db)).toBe(0);
    expect(SEED_FEEDS.length).toBeGreaterThanOrEqual(5);
    expect(SEED_FEEDS.length).toBeLessThanOrEqual(10);
    const { rows } = await db.execute<{ n: number; years: string[] }>(sql`select count(*)::int n, array_agg(distinct extract(year from date)::text) years from holidays`);
    expect(rows[0]).toEqual({ n: SEED_HOLIDAYS.length, years: ['2026', '2027'] });
    // Thanksgiving is the fourth Thursday of November.
    expect(SEED_HOLIDAYS.filter((h) => h.name === 'Thanksgiving').map((h) => [h.date, new Date(`${h.date}T00:00:00Z`).getUTCDay()])).toEqual([
      ['2026-11-26', 4],
      ['2027-11-25', 4],
    ]);
  });
});
