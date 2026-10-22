import { DEFAULT_SETTINGS, momentumScore } from '@ideas-hub/core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, createDb, createPool } from '../client';
import { createTestDatabase, testDatabaseAvailable } from '../testing';
import { risingNewAds } from './briefing';
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

  const ids = async (f: Parameters<typeof listAds>[2] = {}) => (await listAds(db, O, f)).items.map((a) => a.adArchiveId);

  it('lists running ads by default with status, keywords and countries, scored and sorted by score', async () => {
    const ads = (await listAds(db, O)).items;
    expect(ads.map((a) => a.adArchiveId)).toEqual(['a_hi', 'a_lo', 'a_new']);
    expect(ads[0]).toMatchObject({ status: 'running', daysActive: 20, trendScore: 100, countries: ['US'], keywords: [{ id: 'kw_1', text: 'teacher shirt' }] });
    // Under 5 days active or no domain: no score.
    expect(ads.find((a) => a.adArchiveId === 'a_new')?.trendScore).toBeNull();
    expect(await ids({ status: 'all' })).toContain('a_old');
  });

  it('filters by keyword, country, days active, score and domain', async () => {
    expect(await ids({ keywordId: 'kw_2' })).toEqual(['a_new']);
    expect(await ids({ country: 'GB' })).toEqual(['a_lo']);
    expect(await ids({ minDays: 10 })).toEqual(['a_hi']);
    expect(await ids({ minScore: 50 })).toEqual(['a_hi']);
    expect(await ids({ domain: 'mug' })).toEqual(['a_lo']);
    expect(await ids({ domain: '%' })).toEqual([]);
  });

  it('returns the total over all pages and pages with the filters kept', async () => {
    expect(await listAds(db, O, { limit: 1 })).toMatchObject({ total: 3, items: [{ adArchiveId: 'a_hi', duplicates: 1 }] });
    expect(await listAds(db, O, { limit: 1, page: 2 })).toMatchObject({ total: 3, items: [{ adArchiveId: 'a_lo' }] });
    // A page past the end still knows the total.
    expect(await listAds(db, O, { limit: 1, page: 9 })).toEqual({ total: 3, items: [] });
    expect(await listAds(db, O, { keywordId: 'kw_1', limit: 1, page: 2 })).toMatchObject({ total: 2, items: [{ adArchiveId: 'a_lo' }] });
    expect((await listAds(db, O, { status: 'all', minScore: 1 })).total).toBe(3);
  });

  it('sorts in SQL by days active, first and last seen, with ads without a score or days last', async () => {
    expect(await ids({ sort: 'days' })).toEqual(['a_hi', 'a_lo', 'a_new']);
    expect(await ids({ sort: 'last_seen' })).toEqual(['a_hi', 'a_new', 'a_lo']);
    await db.execute(sql`insert into ads (ad_archive_id, caption, page_name, landing_domain, seen_days, first_seen_date, last_seen_date, parsed)
      values ('a_nodates', 'no dates', 'Page', 'nodates.com', 1, '2026-10-18', '2026-10-18', '{}'::jsonb)`);
    try {
      expect(await ids({ sort: 'days' })).toEqual(['a_hi', 'a_lo', 'a_new', 'a_nodates']);
      expect(await ids({ sort: 'first_seen' })).toEqual(['a_nodates', 'a_hi', 'a_new', 'a_lo']);
    } finally {
      await db.execute(sql`delete from ads where ad_archive_id = 'a_nodates'`);
    }
  });

  it('sorts by momentum (momentumScore in SQL), from variant and page like growth within 3 crawl days', async () => {
    expect((await listAds(db, O, { sort: 'trending' })).items.map((a) => a.momentum)).toEqual([0, 0, 0]);
    await db.execute(sql`update ads set page_id = case ad_archive_id when 'a_hi' then 'p_hi' when 'a_lo' then 'p_lo' end`);
    // a_hi's 0 on 16 Oct is outside the window (from 17 Oct) and must not count as its baseline.
    await db.execute(sql`insert into ad_sightings (ad_archive_id, run_id, keyword_id, country, position, crawl_day, collation_count) values
      ('a_hi', 'run_1', 'kw_1', 'CA', 1, '2026-10-16', 0), ('a_hi', 'run_1', 'kw_1', 'AU', 1, '2026-10-17', 2),
      ('a_hi', 'run_1', 'kw_1', 'DE', 1, '2026-10-20', 5)`);
    await db.execute(sql`insert into page_days (page_id, crawl_day, like_count) values
      ('p_hi', '2026-10-17', 1000), ('p_hi', '2026-10-20', 1100), ('p_lo', '2026-10-18', 500), ('p_lo', '2026-10-20', 1500)`);
    try {
      const items = (await listAds(db, O, { sort: 'trending' })).items;
      expect(items.map((a) => [a.adArchiveId, a.momentum])).toEqual([
        ['a_lo', momentumScore({ variantsNow: null, variantsBefore: null, pageLikesNow: 1500, pageLikesBefore: 500, daysActive: 7 })],
        ['a_hi', momentumScore({ variantsNow: 5, variantsBefore: 2, pageLikesNow: 1100, pageLikesBefore: 1000, daysActive: 20 })],
        ['a_new', 0],
      ]);
      expect(items.map((a) => a.momentum)).toEqual([107, 60, 0]);
    } finally {
      await db.execute(sql`delete from ad_sightings where country in ('CA', 'AU', 'DE')`);
      await db.execute(sql`delete from page_days`);
      await db.execute(sql`update ads set page_id = null`);
    }
  });

  it('breaks a sightings tie in the rising new ads by momentum before position', async () => {
    await db.execute(sql`insert into ads (ad_archive_id, page_id, caption, page_name, landing_domain, start_date, end_date, seen_days, first_seen_date, last_seen_date, parsed) values
      ('a_r1', 'p_r1', 'r1', 'Page', 'r1.com', '2026-10-19', '2026-10-20', 1, '2026-10-19', '2026-10-20', '{}'::jsonb),
      ('a_r2', 'p_r2', 'r2', 'Page', 'r2.com', '2026-10-19', '2026-10-20', 1, '2026-10-19', '2026-10-20', '{}'::jsonb)`);
    await db.execute(sql`insert into ad_sightings (ad_archive_id, run_id, keyword_id, country, position, crawl_day) values
      ('a_r1', 'run_1', 'kw_1', 'US', 1, '2026-10-19'), ('a_r2', 'run_1', 'kw_1', 'US', 5, '2026-10-19')`);
    const run = { id: 'run_1', scheduledFor: new Date('2026-10-19T18:00:00Z'), startedAt: new Date('2026-10-19T18:00:00Z'), crawlDay: '2026-10-20' };
    const rising = async () => (await risingNewAds(db, run, O)).map((a) => a.adArchiveId);
    try {
      expect(await rising()).toEqual(['a_r1', 'a_r2']);
      await db.execute(sql`insert into page_days (page_id, crawl_day, like_count) values ('p_r2', '2026-10-19', 100), ('p_r2', '2026-10-20', 120)`);
      expect(await rising()).toEqual(['a_r2', 'a_r1']);
    } finally {
      await db.execute(sql`delete from ads where ad_archive_id in ('a_r1', 'a_r2')`);
      await db.execute(sql`delete from page_days`);
    }
  });

  it('groups near-duplicate creatives (same caption and landing domain) only when asked', async () => {
    await db.execute(sql`insert into ads (ad_archive_id, caption, page_name, landing_domain, start_date, end_date, seen_days, first_seen_date, last_seen_date, parsed) values
      ('a_dup1', 'same mug', 'Page', 'dup.com', '2026-10-01', '2026-10-20', 2, '2026-10-10', '2026-10-20', '{}'::jsonb),
      ('a_dup2', 'same mug', 'Page', 'dup.com', '2026-10-01', '2026-10-20', 4, '2026-10-10', '2026-10-20', '{}'::jsonb),
      ('a_dup3', 'same mug', 'Page', 'other.com', '2026-10-01', '2026-10-20', 1, '2026-10-10', '2026-10-20', '{}'::jsonb),
      ('a_nocap1', null, 'Page', 'dup.com', '2026-10-01', '2026-10-20', 1, '2026-10-10', '2026-10-20', '{}'::jsonb),
      ('a_nocap2', null, 'Page', 'dup.com', '2026-10-01', '2026-10-20', 1, '2026-10-10', '2026-10-20', '{}'::jsonb)`);
    try {
      expect((await listAds(db, O, { domain: 'dup.com' })).total).toBe(4);
      const grouped = await listAds(db, O, { domain: 'dup.com', dedupe: true });
      // The best-scored ad of the group stands for it; ads without a caption are never grouped.
      expect(grouped.total).toBe(3);
      expect(grouped.items.map((a) => [a.adArchiveId, a.duplicates])).toEqual([
        ['a_dup2', 2],
        ['a_nocap1', 1],
        ['a_nocap2', 1],
      ]);
      expect((await listAds(db, O, { domain: 'other.com', dedupe: true })).items.map((a) => a.duplicates)).toEqual([1]);
    } finally {
      await db.execute(sql`delete from ads where ad_archive_id like 'a_dup%' or ad_archive_id like 'a_nocap%'`);
    }
  });

  it('reads one ad with its sightings', async () => {
    const ad = await getAd(db, O, 'a_hi');
    expect(ad?.sightings).toEqual([{ keyword: 'teacher shirt', country: 'US', position: 1, crawlDay: '2026-10-19' }]);
    expect(await getAd(db, O, 'missing')).toBeNull();
  });

  it('sorts shops and keywords on the server', async () => {
    expect((await listShops(db, { sort: 'running_ads' })).items.map((s) => s.landingDomain)).toEqual(['teeshop.com', 'mugs.com']);
    expect((await listShops(db, { sort: 'domain' })).items.map((s) => s.landingDomain)).toEqual(['mugs.com', 'teeshop.com']);
    expect((await listShops(db, { sort: 'running_ads', q: 'tee' })).items[0]).toMatchObject({ landingDomain: 'teeshop.com', pageCount: 2 });
    const kws = await listKeywords(db);
    expect(kws[0]).toMatchObject({ id: 'kw_1', runningAds: 5, trackedBy: [] });
    expect(kws.find((k) => k.id === 'kw_2')).toMatchObject({ runningAds: null, trackedBy: ['st_a'] });
  });

  it('pages shops with their total and leaves out the non-shop domains', async () => {
    await db.execute(sql`insert into shops (landing_domain, first_seen_date, last_seen_date, running_ads) values
      ('play.google.com', '2026-10-01', '2026-10-20', 99), ('smile.amazon.de', '2026-10-01', '2026-10-20', 98)`);
    try {
      const nonShopDomains = DEFAULT_SETTINGS.nonShopDomains;
      expect(await listShops(db, { nonShopDomains })).toMatchObject({ total: 2, items: [{ landingDomain: 'teeshop.com' }, { landingDomain: 'mugs.com' }] });
      expect(await listShops(db, { nonShopDomains, limit: 1, page: 2 })).toMatchObject({ total: 2, items: [{ landingDomain: 'mugs.com' }] });
      expect(await listShops(db, { nonShopDomains, limit: 1, page: 5 })).toEqual({ total: 2, items: [] });
      expect((await listShops(db, { nonShopDomains: [] })).total).toBe(4);
    } finally {
      await db.execute(sql`delete from shops where landing_domain in ('play.google.com', 'smile.amazon.de')`);
    }
  });

  it('plots each snapshot on the date and time of its slot in Asia/Ho_Chi_Minh, not the crawl day', async () => {
    expect(await daySeries(db, 'keyword', 'kw_1')).toEqual([
      { date: '2026-10-19', slotTime: '13:00', runningAds: 4 },
      { date: '2026-10-20', slotTime: '01:00', runningAds: 5 },
    ]);
  });
});
