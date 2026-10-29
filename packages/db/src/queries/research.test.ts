import { DEFAULT_SETTINGS, type Viewer, momentumScore } from '@ideas-hub/core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, createDb, createPool } from '../client';
import { createTestDatabase, testDatabaseAvailable } from '../testing';
import { risingNewAds } from './briefing';
import { daySeries, followShop, followedShopAds, followedShops, getAd, listAds, listKeywords, listShops, lowYieldKeywords, marketReads, shopProductPages, shopReads, titlePhrases, unfollowShop } from './research';

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

  it('filters by display format (media_type) and publisher platform (parsed), and ignores unknown values', async () => {
    await db.execute(sql`update ads set media_type = 'VIDEO', parsed = '{"publisher_platform": ["FACEBOOK", "INSTAGRAM"]}'::jsonb where ad_archive_id = 'a_hi'`);
    await db.execute(sql`update ads set media_type = 'IMAGE', parsed = '{"publisher_platform": ["FACEBOOK"]}'::jsonb where ad_archive_id = 'a_lo'`);
    try {
      expect(await ids({ format: 'VIDEO' })).toEqual(['a_hi']);
      expect(await ids({ format: 'IMAGE' })).toEqual(['a_lo']);
      expect(await ids({ format: 'DPA' })).toEqual([]);
      expect(await ids({ platform: 'FACEBOOK' })).toEqual(['a_hi', 'a_lo']);
      expect(await ids({ platform: 'INSTAGRAM' })).toEqual(['a_hi']);
      // An ad without the field (a_new: '{}') is in no platform; the filters combine with the others.
      expect(await ids({ platform: 'THREADS' })).toEqual([]);
      expect(await ids({ platform: 'FACEBOOK', format: 'IMAGE' })).toEqual(['a_lo']);
      expect((await listAds(db, O, { platform: 'INSTAGRAM', limit: 1 })).total).toBe(1);
    } finally {
      await db.execute(sql`update ads set media_type = null, parsed = '{}'::jsonb where ad_archive_id in ('a_hi', 'a_lo')`);
    }
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
      // Other sorts skip the subqueries and carry 0.
      expect((await listAds(db, O, { sort: 'score' })).items.map((a) => a.momentum)).toEqual([0, 0, 0]);
      // Edge cases against momentumScore: a zero like baseline, no page_id, no dates.
      await db.execute(sql`insert into page_days (page_id, crawl_day, like_count) values ('p_zero', '2026-10-18', 0), ('p_zero', '2026-10-20', 50)`);
      await db.execute(sql`update ads set page_id = 'p_zero' where ad_archive_id = 'a_lo'`);
      await db.execute(sql`update ads set start_date = null, end_date = null where ad_archive_id = 'a_hi'`);
      await db.execute(sql`update ads set page_id = null where ad_archive_id = 'a_hi'`);
      const edge = new Map((await listAds(db, O, { sort: 'trending' })).items.map((a) => [a.adArchiveId, a.momentum]));
      expect(edge.get('a_lo')).toBe(momentumScore({ variantsNow: null, variantsBefore: null, pageLikesNow: 50, pageLikesBefore: 0, daysActive: 7 }));
      expect(edge.get('a_hi')).toBe(momentumScore({ variantsNow: 5, variantsBefore: 2, pageLikesNow: null, pageLikesBefore: null, daysActive: null }));
      expect([edge.get('a_lo'), edge.get('a_hi')]).toEqual([0, 30]);
    } finally {
      await db.execute(sql`delete from ad_sightings where country in ('CA', 'AU', 'DE')`);
      await db.execute(sql`delete from page_days`);
      await db.execute(sql`update ads set page_id = null`);
      await db.execute(sql`update ads set start_date = '2026-10-01', end_date = '2026-10-20' where ad_archive_id = 'a_hi'`);
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

  // Last: it adds ads that the exact lists above do not expect.
  it('reads a keyword market: shops without non-shop domains, top 3 share, new ads by start date, proven ads and videos', async () => {
    await db.execute(sql`insert into keywords (id, text, origin) values ('kw_m', 'market shirt', 'seed')`);
    const ad = (id: string, domain: string, media: string, start: string, variants: number | null) =>
      sql`(${id}, ${domain}, ${media}, ${start}, '2026-10-20', 2, '2026-10-01', '2026-10-20', ${variants}, '{}'::jsonb)`;
    await db.execute(sql`insert into ads (ad_archive_id, landing_domain, media_type, start_date, end_date, seen_days, first_seen_date, last_seen_date, collation_count, parsed) values
      ${sql.join(
        [
          // New (started in the last 7 days), a video, proven by 7 variants.
          ad('m_new', 'shop1.com', 'VIDEO', '2026-10-18', 7),
          // Started in the 7 days before.
          ad('m_before', 'shop1.com', 'IMAGE', '2026-10-10', null),
          // Proven by 50 days in 3 countries.
          ad('m_long', 'shop2.com', 'IMAGE', '2026-09-01', 1),
          // 50 days in 1 country, on a non-shop domain: counted as an ad, not as a shop.
          ad('m_app', 'amazon.com', 'IMAGE', '2026-09-01', null),
        ],
        sql`, `,
      )}`);
    await db.execute(sql`insert into ad_sightings (ad_archive_id, run_id, keyword_id, country, position, crawl_day) values
      ('m_new', 'run_1', 'kw_m', 'US', 1, '2026-10-19'), ('m_before', 'run_1', 'kw_m', 'US', 2, '2026-10-19'),
      ('m_long', 'run_1', 'kw_m', 'US', 3, '2026-10-19'), ('m_long', 'run_1', 'kw_m', 'GB', 3, '2026-10-19'), ('m_long', 'run_1', 'kw_m', 'CA', 3, '2026-10-19'),
      ('m_app', 'run_1', 'kw_m', 'US', 4, '2026-10-19')`);
    const reads = await marketReads(db, O, { nonShopDomains: ['amazon.*'] });
    expect(reads.get('kw_m')).toEqual({ ads: 4, shops: 2, top3Share: 0.75, newAds: 1, newAdsBefore: 1, proven: 2, video: 1 });
    expect([...(await marketReads(db, O, { keywordId: 'kw_m' })).keys()]).toEqual(['kw_m']);
    // kw_1's running ads: a_hi (20 days, 1 country, not proven) and a_lo (started 14/10, within 7 days of 20/10).
    expect(reads.get('kw_1')).toMatchObject({ ads: 2, proven: 0, newAds: 1, newAdsBefore: 0 });
  });

  // Uses the kw_m ads of the test above.
  it('filters proven ads, sorts by start date and marks each ad with its variants and proven', async () => {
    const ads = (await listAds(db, O, { keywordId: 'kw_m', proven: true })).items;
    expect(ads.map((a) => [a.adArchiveId, a.variants, a.proven])).toEqual([
      ['m_long', 1, true],
      ['m_new', 7, true],
    ]);
    expect(await ids({ keywordId: 'kw_m', sort: 'started' })).toEqual(['m_new', 'm_before', 'm_app', 'm_long']);
    expect((await getAd(db, O, 'm_before'))).toMatchObject({ variants: null, proven: false });
  });

  it('reads shops: running ads, new and proven ones, and the keywords they were found under', async () => {
    const reads = await shopReads(db, O, ['shop1.com', 'shop2.com', 'teeshop.com', 'none.com']);
    expect(reads.get('shop1.com')).toEqual({ ads: 2, newAds: 1, proven: 1, keywords: 1 });
    expect(reads.get('shop2.com')).toEqual({ ads: 1, newAds: 0, proven: 1, keywords: 1 });
    expect(reads.get('teeshop.com')).toMatchObject({ ads: 1, keywords: 1 });
    expect(reads.has('none.com')).toBe(false);
    expect((await shopReads(db, O, [])).size).toBe(0);
  });

  // Uses the kw_m ads above: shop1.com twice, shop2.com, and amazon.com as a non-shop domain.
  it('reads the 2-word title phrases most shops use, and filters ads by them as whole words', async () => {
    await db.execute(sql`update ads set title = case ad_archive_id
      when 'm_new' then 'Sea-Glass Ornament for Mom' when 'm_before' then 'sea glass ornament'
      when 'm_long' then 'SEA GLASS Market Shirt' when 'm_app' then 'Sea glass' end
      where ad_archive_id in ('m_new', 'm_before', 'm_long', 'm_app')`);
    // "glass ornament" is on 1 shop only, "ornament for"/"for mom" have a stop word, "market shirt" is the keyword.
    expect(await titlePhrases(db, O, { id: 'kw_m', text: 'Market shirt' }, ['amazon.*'])).toEqual([{ phrase: 'sea glass', ads: 4, shops: 2 }]);
    expect((await ids({ keywordId: 'kw_m', title: 'Sea glass!', sort: 'started' }))).toEqual(['m_new', 'm_before', 'm_app', 'm_long']);
    expect(await ids({ keywordId: 'kw_m', title: 'glass ornament', sort: 'started' })).toEqual(['m_new', 'm_before']);
    expect(await ids({ keywordId: 'kw_m', title: 'glass orn' })).toEqual([]);
  });

  it("groups a shop's ads by landing page without tracking parameters, counting running ads and the seen range", async () => {
    await db.execute(sql`insert into ads (ad_archive_id, landing_domain, link, first_seen_date, last_seen_date, parsed) values
      ('p_1', 'pages.example', 'https://pages.example/p/mug?utm_source=fb&fbclid=1', '2026-10-05', '2026-10-20', '{}'::jsonb),
      ('p_2', 'pages.example', 'https://pages.example/p/mug/', '2026-09-20', '2026-10-01', '{}'::jsonb),
      ('p_3', 'pages.example', 'https://pages.example/p/shirt#top', '2026-10-10', '2026-10-19', '{}'::jsonb),
      ('p_4', 'pages.example', null, '2026-10-10', '2026-10-19', '{}'::jsonb),
      ('p_5', 'pages.example', 'not a url', '2026-10-10', '2026-10-19', '{}'::jsonb),
      ('p_6', 'other.example', 'https://other.example/x', '2026-10-10', '2026-10-19', '{}'::jsonb)`);
    expect(await shopProductPages(db, O, 'pages.example')).toEqual([
      { url: 'https://pages.example/p/mug', ads: 2, running: 1, firstSeenDate: '2026-09-20', lastSeenDate: '2026-10-20' },
      { url: 'https://pages.example/p/shirt', ads: 1, running: 1, firstSeenDate: '2026-10-10', lastSeenDate: '2026-10-19' },
    ]);
    expect(await shopProductPages(db, O, 'pages.example', 1)).toHaveLength(1);
    expect(await shopProductPages(db, O, 'none.example')).toEqual([]);
  });

  it('lists active keywords whose searches in the window all ended ok or no_results with no ads', async () => {
    await db.execute(sql`insert into keywords (id, text, origin, active) values
      ('ly_dry', 'dry', 'seed', true), ('ly_dry2', 'a dry too', 'seed', true), ('ly_hit', 'hit', 'seed', true), ('ly_blocked', 'blocked', 'seed', true),
      ('ly_quiet', 'quiet', 'seed', true), ('ly_paused', 'paused', 'seed', false), ('ly_old_hit', 'old hit', 'seed', true)`);
    // [keyword, country, status, ads_found, finished_at]
    const rows: [string, string, string, number, string][] = [
      ['ly_dry', 'US', 'ok', 0, '2026-10-19T01:00:00Z'],
      ['ly_dry', 'GB', 'no_results', 0, '2026-10-20T01:00:00Z'],
      ['ly_dry2', 'US', 'no_results', 0, '2026-10-14T01:00:00Z'],
      ['ly_hit', 'US', 'ok', 0, '2026-10-19T01:00:00Z'],
      ['ly_hit', 'GB', 'ok', 3, '2026-10-19T01:00:00Z'],
      ['ly_blocked', 'US', 'ok', 0, '2026-10-19T01:00:00Z'],
      ['ly_blocked', 'GB', 'blocked', 0, '2026-10-19T01:00:00Z'],
      ['ly_paused', 'US', 'ok', 0, '2026-10-19T01:00:00Z'],
      // Found ads only before the window, and the one search inside it found none.
      ['ly_old_hit', 'US', 'ok', 5, '2026-10-10T01:00:00Z'],
      ['ly_old_hit', 'GB', 'ok', 0, '2026-10-19T01:00:00Z'],
    ];
    for (const [kw, country, status, found, at] of rows)
      await db.execute(sql`insert into crawl_searches (id, run_id, keyword_id, country, status, ads_found, finished_at)
        values (${`ly_${kw}_${country}_${at}`}, 'run_1', ${kw}, ${country}, ${status}, ${found}, ${at})`);
    try {
      const since = new Date('2026-10-14T00:00:00Z');
      // ly_quiet has no search in the window: nothing to judge. ly_old_hit's 5-ad search is outside the window.
      expect(await lowYieldKeywords(db, since)).toEqual([
        { id: 'ly_dry2', text: 'a dry too', searches: 1, lastSearchAt: new Date('2026-10-14T01:00:00Z') },
        { id: 'ly_dry', text: 'dry', searches: 2, lastSearchAt: new Date('2026-10-20T01:00:00Z') },
        { id: 'ly_old_hit', text: 'old hit', searches: 1, lastSearchAt: new Date('2026-10-19T01:00:00Z') },
      ]);
      expect((await lowYieldKeywords(db, new Date('2026-10-15T00:00:00Z'))).map((k) => k.id)).toEqual(['ly_dry', 'ly_old_hit']);
    } finally {
      await db.execute(sql`delete from crawl_searches where id like 'ly_%'`);
      await db.execute(sql`delete from keywords where id like 'ly_%'`);
    }
  });

  it('follows a shop per store with `save`, lists its ads started in the last 7 days, and unfollows', async () => {
    const tick = (storeId: string, save: boolean) => ({ storeId, view: true, save, keywords: false });
    const admin: Viewer = { userId: 'u_admin', role: 'admin', memberships: [] };
    const saveA: Viewer = { userId: 'u_save', role: 'member', memberships: [tick('st_a', true)] };
    const viewA: Viewer = { userId: 'u_view', role: 'member', memberships: [tick('st_a', false)] };
    const saveB: Viewer = { userId: 'u_saveb', role: 'member', memberships: [tick('st_b', true)] };
    const none: Viewer = { userId: 'u_none', role: 'member', memberships: [] };
    const at = new Date('2026-10-20T03:00:00Z');
    await db.execute(sql`insert into users (id, email, name) values ('u_save', 'save@x.test', 'Save')`);
    await db.execute(sql`insert into stores (id, name) values ('st_b', 'Store B')`);
    await db.execute(sql`insert into shops (landing_domain, page_ids, first_seen_date, last_seen_date) values ('follow.example', '{pf}', '2026-10-01', '2026-10-20')`);
    // f_edge started 7 days before today: outside the window. f_old's start is unknown, so its first crawl day counts.
    await db.execute(sql`insert into ads (ad_archive_id, caption, page_name, landing_domain, start_date, end_date, seen_days, first_seen_date, last_seen_date, parsed) values
      ('f_new', 'f new', 'Page', 'follow.example', '2026-10-18', '2026-10-20', 1, '2026-10-18', '2026-10-20', '{}'::jsonb),
      ('f_dup', 'f new', 'Page', 'follow.example', '2026-10-17', '2026-10-20', 1, '2026-10-17', '2026-10-20', '{}'::jsonb),
      ('f_in', 'f in', 'Page', 'follow.example', '2026-10-14', '2026-10-14', 1, '2026-10-14', '2026-10-14', '{}'::jsonb),
      ('f_edge', 'f edge', 'Page', 'follow.example', '2026-10-13', '2026-10-20', 1, '2026-10-13', '2026-10-20', '{}'::jsonb),
      ('f_nostart', 'f nostart', 'Page', 'follow.example', null, null, 1, '2026-10-19', '2026-10-20', '{}'::jsonb),
      ('f_old', 'f old', 'Page', 'follow.example', null, null, 1, '2026-10-01', '2026-10-20', '{}'::jsonb),
      ('f_other', 'f other', 'Page', 'other.example', '2026-10-19', '2026-10-20', 1, '2026-10-19', '2026-10-20', '{}'::jsonb)`);
    const ads = async (v: Viewer, storeId = 'st_a') => (await followedShopAds(db, O, v, storeId)).items.map((a) => a.adArchiveId);

    // Without `save` on the store, or for an unknown shop, nothing is written.
    expect(await followShop(db, viewA, 'st_a', 'follow.example', at)).toBe(false);
    expect(await followShop(db, saveB, 'st_a', 'follow.example', at)).toBe(false);
    expect(await followShop(db, none, 'st_a', 'follow.example', at)).toBe(false);
    expect(await followShop(db, saveA, 'st_a', 'nope.example', at)).toBe(false);
    expect(await followShop(db, admin, 'st_missing', 'follow.example', at)).toBe(false);
    expect(await followedShops(db, admin, 'st_a')).toEqual([]);

    expect(await followShop(db, saveA, 'st_a', 'follow.example', at)).toBe(true);
    // Following again is a no-op.
    expect(await followShop(db, saveA, 'st_a', 'follow.example', at)).toBe(true);
    const { rows } = await db.execute<{ created_by: string; n: number }>(sql`select created_by, count(*) over ()::int as n from shop_follows`);
    expect(rows).toEqual([{ created_by: 'u_save', n: 1 }]);
    expect(await followedShops(db, viewA, 'st_a')).toEqual(['follow.example']);
    // Per store: store B follows nothing, and a viewer outside store A sees nothing of it.
    expect(await followedShops(db, admin, 'st_b')).toEqual([]);
    expect(await followedShops(db, saveB, 'st_a')).toEqual([]);

    expect(await ads(viewA)).toEqual(['f_nostart', 'f_new', 'f_in']);
    const { items: list, total } = await followedShopAds(db, O, admin, 'st_a');
    expect(total).toBe(3);
    // The same creative (f_dup) is grouped under its newest ad.
    expect(list.map((a) => a.duplicates)).toEqual([1, 2, 1]);
    expect(list.map((a) => a.status)).toEqual(['running', 'running', 'stopped_or_unknown']);
    // The limit cuts the newest-first order; the total still counts every ad.
    expect(await followedShopAds(db, O, admin, 'st_a', 7, 2)).toMatchObject({ total: 3, items: [{ adArchiveId: 'f_nostart' }, { adArchiveId: 'f_new' }] });
    expect(await ads(none)).toEqual([]);
    expect(await ads(admin, 'st_b')).toEqual([]);
    expect((await followedShopAds(db, O, admin, 'st_a', 30)).items.map((a) => a.adArchiveId)).toEqual(['f_nostart', 'f_new', 'f_in', 'f_edge', 'f_old']);

    expect(await unfollowShop(db, viewA, 'st_a', 'follow.example')).toBe(false);
    expect(await followedShops(db, admin, 'st_a')).toEqual(['follow.example']);
    expect(await unfollowShop(db, saveA, 'st_a', 'follow.example')).toBe(true);
    expect(await followedShops(db, admin, 'st_a')).toEqual([]);
    expect(await ads(admin)).toEqual([]);
  });

  // Last: it adds 200 running ads on its own keyword, N = 200, so the floor is max(3, ceil(0.02 * 200)) = 4.
  it('counts title phrases once per ad above a noise floor and drops 2-word fragments of a 3-word phrase', async () => {
    await db.execute(sql`insert into keywords (id, text, origin) values ('kw_t', 'pillow', 'seed')`);
    await db.execute(sql`insert into ads (ad_archive_id, title, landing_domain, media_type, start_date, end_date, seen_days, first_seen_date, last_seen_date, parsed)
      select 't_' || i,
        case when i <= 10 then 'Sea glass ornament' when i <= 20 then 'Sea glass lamp' when i <= 23 then 'Rare moon'
          when i = 24 then 'Moon rock moon rock' when i <= 27 then 'Moon rock' else 'Gift' end,
        'shop' || (i % 10) || '.com', 'IMAGE', '2026-10-01', '2026-10-20', 2, '2026-10-01', '2026-10-20', '{}'::jsonb
      from generate_series(1, 200) i`);
    await db.execute(sql`insert into ad_sightings (ad_archive_id, run_id, keyword_id, country, position, crawl_day)
      select 't_' || i, 'run_1', 'kw_t', 'US', i, '2026-10-19' from generate_series(1, 200) i`);
    // "glass ornament" and "glass lamp" are all inside a 3-word phrase; "sea glass" is only half inside either;
    // "rare moon" (3 ads) is under the floor; "moon rock" has 4 ads, t_24 counted once although it says it twice.
    expect(await titlePhrases(db, O, { id: 'kw_t', text: 'Pillow' })).toEqual([
      { phrase: 'sea glass', ads: 20, shops: 10 },
      { phrase: 'sea glass lamp', ads: 10, shops: 10 },
      { phrase: 'sea glass ornament', ads: 10, shops: 10 },
      { phrase: 'moon rock', ads: 4, shops: 4 },
    ]);
  });
});
