import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, createDb, createPool } from '../client';
import { createTestDatabase, testDatabaseAvailable } from '../testing';
import { daySeries, getAd, listAds, listKeywords, listShops } from './research';

const O = { today: '2026-10-20', staleAfterDays: 3, countries: ['US', 'GB'] };

describe.skipIf(!testDatabaseAvailable())('research queries', () => {
  let drop: () => Promise<void>;
  let pool: ReturnType<typeof createPool>;
  let db: Db;
  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    pool = createPool(t.url, 2);
    db = createDb(pool);
    await db.execute(sql`insert into keywords (id, text, origin) values ('kw_1', 'teacher shirt', 'seed'), ('kw_2', 'nurse shirt', 'store')`);
    await db.execute(sql`insert into stores (id, name) values ('st_a', 'Store A')`);
    await db.execute(sql`insert into store_keywords (store_id, keyword_id) values ('st_a', 'kw_2')`);
    await db.execute(sql`insert into crawl_runs (id, source, trigger, status, planned_searches, deadline, scheduled_for, started_at)
      values ('run_1', 'fb_ad_library', 'schedule', 'done', 4, '2026-10-20T22:00:00Z', '2026-10-19T18:00:00Z', '2026-10-19T18:00:00Z')`);
    const ad = (id: string, domain: string | null, start: string, end: string, seenDays: number, lastSeen: string) =>
      sql`(${id}, ${`caption ${id}`}, 'Page', ${domain}, ${start}, ${end}, ${seenDays}, '2026-10-10', ${lastSeen}, '{}'::jsonb)`;
    await db.execute(sql`insert into ads (ad_archive_id, caption, page_name, landing_domain, start_date, end_date, seen_days, first_seen_date, last_seen_date, parsed) values
      ${sql.join(
        [
          ad('a_hi', 'teeshop.com', '2026-10-01', '2026-10-20', 5, '2026-10-20'),
          ad('a_lo', 'mugs.com', '2026-10-14', '2026-10-20', 2, '2026-10-19'),
          ad('a_new', null, '2026-10-19', '2026-10-20', 1, '2026-10-20'),
          ad('a_old', 'old.com', '2026-09-01', '2026-10-01', 9, '2026-10-01'),
        ],
        sql`, `,
      )}`);
    await db.execute(sql`insert into ad_sightings (ad_archive_id, run_id, keyword_id, country, position, crawl_day) values
      ('a_hi', 'run_1', 'kw_1', 'US', 1, '2026-10-19'), ('a_lo', 'run_1', 'kw_1', 'GB', 2, '2026-10-19'),
      ('a_new', 'run_1', 'kw_2', 'US', 3, '2026-10-19'), ('a_old', 'run_1', 'kw_2', 'US', 4, '2026-10-19')`);
    // a_old's pair was searched after it was last seen and reached the end of results: stopped.
    await db.execute(sql`insert into crawl_searches (id, run_id, keyword_id, country, status, last_has_next)
      values ('cs_1', 'run_1', 'kw_2', 'US', 'ok', false)`);
    await db.execute(sql`insert into shops (landing_domain, page_ids, first_seen_date, last_seen_date, running_ads) values
      ('teeshop.com', '{p1,p2}', '2026-10-01', '2026-10-20', 7), ('mugs.com', '{p3}', '2026-10-14', '2026-10-19', 3)`);
    // Slots 01:00 and 13:00 Asia/Ho_Chi_Minh; the 01:00 slot of 20/10 is 18:00 UTC on 19/10.
    await db.execute(sql`insert into keyword_days (keyword_id, crawl_day, slot, running_ads) values
      ('kw_1', '2026-10-19', '2026-10-19T06:00:00Z', 4), ('kw_1', '2026-10-19', '2026-10-19T18:00:00Z', 5)`);
  }, 60_000);
  afterAll(async () => {
    await pool?.end();
    await drop?.();
  });

  it('lists running ads by default with status, keywords and countries, scored and sorted by score', async () => {
    const ads = await listAds(db, O);
    expect(ads.map((a) => a.adArchiveId)).toEqual(['a_hi', 'a_lo', 'a_new']);
    expect(ads[0]).toMatchObject({ status: 'running', daysActive: 20, trendScore: 100, countries: ['US'], keywords: [{ id: 'kw_1', text: 'teacher shirt' }] });
    // Under 5 days active or no domain: no score.
    expect(ads.find((a) => a.adArchiveId === 'a_new')?.trendScore).toBeNull();
    expect((await listAds(db, O, { status: 'all' })).map((a) => a.adArchiveId)).toContain('a_old');
  });

  it('filters by keyword, country, days active, score and domain', async () => {
    expect((await listAds(db, O, { keywordId: 'kw_2' })).map((a) => a.adArchiveId)).toEqual(['a_new']);
    expect((await listAds(db, O, { country: 'GB' })).map((a) => a.adArchiveId)).toEqual(['a_lo']);
    expect((await listAds(db, O, { minDays: 10 })).map((a) => a.adArchiveId)).toEqual(['a_hi']);
    expect((await listAds(db, O, { minScore: 50 })).map((a) => a.adArchiveId)).toEqual(['a_hi']);
    expect((await listAds(db, O, { domain: 'mug' })).map((a) => a.adArchiveId)).toEqual(['a_lo']);
    expect((await listAds(db, O, { domain: '%' })).map((a) => a.adArchiveId)).toEqual([]);
  });

  it('reads one ad with its sightings', async () => {
    const ad = await getAd(db, O, 'a_hi');
    expect(ad?.sightings).toEqual([{ keyword: 'teacher shirt', country: 'US', position: 1, crawlDay: '2026-10-19' }]);
    expect(await getAd(db, O, 'missing')).toBeNull();
  });

  it('sorts shops and keywords on the server', async () => {
    expect((await listShops(db, 'running_ads')).map((s) => s.landingDomain)).toEqual(['teeshop.com', 'mugs.com']);
    expect((await listShops(db, 'domain')).map((s) => s.landingDomain)).toEqual(['mugs.com', 'teeshop.com']);
    expect((await listShops(db, 'running_ads', 'tee'))[0]).toMatchObject({ landingDomain: 'teeshop.com', pageCount: 2 });
    const kws = await listKeywords(db);
    expect(kws[0]).toMatchObject({ id: 'kw_1', runningAds: 5, trackedBy: [] });
    expect(kws.find((k) => k.id === 'kw_2')).toMatchObject({ runningAds: null, trackedBy: ['st_a'] });
  });

  it('plots each snapshot on the date and time of its slot in Asia/Ho_Chi_Minh, not the crawl day', async () => {
    expect(await daySeries(db, 'keyword', 'kw_1')).toEqual([
      { date: '2026-10-19', slotTime: '13:00', runningAds: 4 },
      { date: '2026-10-20', slotTime: '01:00', runningAds: 5 },
    ]);
  });
});
