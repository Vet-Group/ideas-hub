import { type AdPair, DEFAULT_SETTINGS, adStatus } from '@ideas-hub/core';
import { adStatusQuery } from '@ideas-hub/db/queries';
import { testDatabaseAvailable } from '@ideas-hub/db/testing';
import { normalizeAd } from '@ideas-hub/fb-ad-library';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertAds } from '../src/upsert';
import { type Harness, all, harness, insertRun, one, seedKeywords } from './helpers';

const raw = (id: string, end: number) => ({
  ad_archive_id: id,
  page_id: 'p1',
  start_date: 1785308400,
  end_date: end,
  snapshot: { body: { text: 'hi' }, link_url: 'https://www.shop.com/x' },
});

describe.skipIf(!testDatabaseAvailable())('upsert', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
    await seedKeywords(h, 2);
  }, 60_000);
  afterAll(() => h?.close());

  it('the same ad twice gives one ad with rollups updated and end_date moved; a retried search adds no sighting', async () => {
    const r1 = await insertRun(h, { deadline: h.clock.now(), scheduledFor: new Date('2026-10-20T06:00:00Z'), status: 'done' });
    const r2 = await insertRun(h, { deadline: h.clock.now(), scheduledFor: new Date('2026-10-20T18:00:00Z'), status: 'done' });
    const at = (runId: string, keywordId: string, crawlDay: string) => ({ runId, keywordId, country: 'US', crawlDay });
    await upsertAds(h.db, at(r1, 'kw_0', '2026-10-19'), [normalizeAd(raw('A', 1792393200))], DEFAULT_SETTINGS.nonShopDomains);
    // Same run, another keyword: one more sighting, the run and day counted once.
    await upsertAds(h.db, at(r1, 'kw_1', '2026-10-19'), [normalizeAd(raw('A', 1792393200))], DEFAULT_SETTINGS.nonShopDomains);
    // Retried search: no duplicate sighting.
    await upsertAds(h.db, at(r1, 'kw_1', '2026-10-19'), [normalizeAd(raw('A', 1792393200))], DEFAULT_SETTINGS.nonShopDomains);
    await upsertAds(h.db, at(r2, 'kw_0', '2026-10-20'), [normalizeAd(raw('A', 1792479600))], DEFAULT_SETTINGS.nonShopDomains);
    expect(await one(h, sql`select count(*)::int as n from ads`)).toEqual({ n: 1 });
    expect(await one(h, sql`select seen_runs, seen_days, end_date::text, first_seen_date::text, last_seen_date::text from ads`)).toEqual({
      seen_runs: 2,
      seen_days: 2,
      end_date: '2026-10-20',
      first_seen_date: '2026-10-19',
      last_seen_date: '2026-10-20',
    });
    expect(await one(h, sql`select count(*)::int as n from ad_sightings`)).toEqual({ n: 3 });
    expect(await one(h, sql`select page_ids, first_seen_date::text, last_seen_date::text from shops where landing_domain = 'shop.com'`)).toEqual({
      page_ids: ['p1'],
      first_seen_date: '2026-10-19',
      last_seen_date: '2026-10-20',
    });
  });

  it('keeps each sighting\'s collation_count, so a rising variant count shows over time', async () => {
    const r1 = await insertRun(h, { deadline: h.clock.now(), scheduledFor: new Date('2026-10-22T06:00:00Z'), status: 'done' });
    const r2 = await insertRun(h, { deadline: h.clock.now(), scheduledFor: new Date('2026-10-22T18:00:00Z'), status: 'done' });
    const ad = (count?: number) => normalizeAd({ ...raw('V', 1792393200), ...(count === undefined ? {} : { collation_count: count }) });
    await upsertAds(h.db, { runId: r1, keywordId: 'kw_0', country: 'US', crawlDay: '2026-10-21' }, [ad(3)], DEFAULT_SETTINGS.nonShopDomains);
    await upsertAds(h.db, { runId: r2, keywordId: 'kw_0', country: 'US', crawlDay: '2026-10-22' }, [ad(7)], DEFAULT_SETTINGS.nonShopDomains);
    await upsertAds(h.db, { runId: r2, keywordId: 'kw_1', country: 'US', crawlDay: '2026-10-22' }, [ad()], DEFAULT_SETTINGS.nonShopDomains);
    expect(await all(h, sql`select crawl_day::text, keyword_id, collation_count from ad_sightings where ad_archive_id = 'V' order by crawl_day, keyword_id`)).toEqual([
      { crawl_day: '2026-10-21', keyword_id: 'kw_0', collation_count: 3 },
      { crawl_day: '2026-10-22', keyword_id: 'kw_0', collation_count: 7 },
      { crawl_day: '2026-10-22', keyword_id: 'kw_1', collation_count: null },
    ]);
  });

  it('keeps a non-shop landing domain on the ad but never makes it a shop', async () => {
    const r = await insertRun(h, { deadline: h.clock.now(), scheduledFor: new Date('2026-10-21T06:00:00Z'), status: 'done' });
    const app = { ...raw('APP', 1792393200), snapshot: { body: { text: 'app' }, link_url: 'https://play.google.com/store/apps/details?id=x' } };
    await upsertAds(h.db, { runId: r, keywordId: 'kw_0', country: 'US', crawlDay: '2026-10-20' }, [normalizeAd(app)], DEFAULT_SETTINGS.nonShopDomains);
    expect(await one(h, sql`select landing_domain from ads where ad_archive_id = 'APP'`)).toEqual({ landing_domain: 'play.google.com' });
    expect(await one(h, sql`select count(*)::int as n from shops where landing_domain = 'play.google.com'`)).toEqual({ n: 0 });
  });

  it('the SQL ad status agrees with adStatus', async () => {
    await h.db.execute(sql`truncate crawl_runs, ads cascade`);
    const today = '2026-10-20';
    // Ads seen 2026-10-10 under (kw_0, US); later searches on that pair decide the status.
    const cases: { id: string; searches: { status: string; lastHasNext: boolean | null; day: string }[]; keywordActive?: boolean; lastSeen?: string }[] = [
      { id: 'fresh', searches: [], lastSeen: '2026-10-18' },
      { id: 'rotation', searches: [] },
      { id: 'end', searches: [{ status: 'ok', lastHasNext: false, day: '2026-10-15' }] },
      { id: 'nores', searches: [{ status: 'no_results', lastHasNext: false, day: '2026-10-15' }] },
      { id: 'top', searches: [{ status: 'ok', lastHasNext: true, day: '2026-10-15' }] },
      { id: 'blocked', searches: [{ status: 'blocked', lastHasNext: null, day: '2026-10-15' }] },
      { id: 'inactive', searches: [], keywordActive: false },
    ];
    for (const [i, c] of cases.entries()) {
      const kw = `kwc_${i}`;
      await h.db.execute(sql`insert into keywords (id, text, origin, active) values (${kw}, ${`case ${i}`}, 'seed', ${c.keywordActive ?? true})`);
      const seenRun = await insertRun(h, { trigger: 'cli', deadline: h.clock.now(), status: 'done', pairs: [] });
      await h.db.execute(sql`update crawl_runs set started_at = '2026-10-10T18:00:00Z' where id = ${seenRun}`);
      await h.db.execute(sql`insert into ads (ad_archive_id, first_seen_date, last_seen_date, parsed) values (${c.id}, '2026-10-10', ${c.lastSeen ?? '2026-10-10'}, '{}')`);
      await h.db.execute(sql`insert into ad_sightings values (${c.id}, ${seenRun}, ${kw}, 'US', 1, '2026-10-10')`);
      for (const s of c.searches) {
        const r = await insertRun(h, { trigger: 'cli', deadline: h.clock.now(), status: 'done', pairs: [] });
        await h.db.execute(sql`update crawl_runs set started_at = ${`${s.day}T18:00:00Z`} where id = ${r}`);
        await h.db.execute(sql`insert into crawl_searches (id, run_id, keyword_id, country, status, last_has_next) values (${`s_${r}`}, ${r}, ${kw}, 'US', ${s.status}, ${s.lastHasNext})`);
      }
    }
    const rows = await all<{ ad_archive_id: string; status: string }>(h, sql`select * from (${adStatusQuery(today, 3, ['US'])}) st order by 1`);
    const sqlStatus = Object.fromEntries(rows.map((r) => [r.ad_archive_id, r.status]));
    for (const c of cases) {
      const pairs: AdPair[] = [{ active: c.keywordActive ?? true, searches: c.searches.map((s) => ({ crawlDay: s.day, status: s.status as 'ok', lastHasNext: s.lastHasNext })) }];
      expect([c.id, sqlStatus[c.id]]).toEqual([c.id, adStatus({ lastSeenDate: c.lastSeen ?? '2026-10-10', pairs }, today, 3)]);
    }
    expect(sqlStatus).toMatchObject({ fresh: 'running', rotation: 'running', end: 'stopped_or_unknown', nores: 'stopped_or_unknown', top: 'out_of_top', blocked: 'running', inactive: 'stopped_or_unknown' });
  });
});
