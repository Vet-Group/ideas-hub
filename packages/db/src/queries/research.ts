// The research views (plan Step 6, spec §6): the ads grid and detail, shops, keywords and the per-day
// series behind their charts. Ad status is the SQL form of adStatus (ad-status.ts); the trend score is
// computed in TypeScript, as in the briefing, and in SQL (SCORE) for the grid's filter and sort.
import { type AdStatus, MARKET, MOMENTUM_WINDOW_DAYS, type MarketRead, PROVEN, VIETNAM, addDays, daysActive, isProven, nonShopPattern, trendScore } from '@ideas-hub/core';
import { type SQL, sql } from 'drizzle-orm';
import { type Db } from '../client';
import { adStatusQuery } from './ad-status';
import { escapeLike } from './search';

export interface StatusOptions {
  /** Pacific crawl day of "now". */
  today: string;
  staleAfterDays: number;
  countries: readonly string[];
}

export const AD_SORTS = ['score', 'trending', 'started', 'days', 'last_seen', 'first_seen'] as const;
export type AdSort = (typeof AD_SORTS)[number];
export const AD_PAGE_SIZE = 120;

export interface AdFilters {
  /** Default 'running'. */
  status?: AdStatus | 'all';
  keywordId?: string;
  country?: string;
  /** Minimum days active. */
  minDays?: number;
  minScore?: number;
  /** Proven ads only (isProven). */
  proven?: boolean;
  /** Part of the landing domain. */
  domain?: string;
  /** Near-duplicate creatives (same caption and landing domain) as one item with their count. */
  dedupe?: boolean;
  sort?: AdSort;
  /** 1-based. */
  page?: number;
  limit?: number;
}

export interface AdListItem {
  adArchiveId: string;
  pageName: string | null;
  caption: string | null;
  title: string | null;
  link: string | null;
  landingDomain: string | null;
  mediaType: string | null;
  thumbnailKey: string | null;
  startDate: string | null;
  endDate: string | null;
  firstSeenDate: string;
  lastSeenDate: string;
  seenDays: number;
  daysActive: number | null;
  trendScore: number | null;
  /** collation_count: the ad's variants in the Ad Library. */
  variants: number | null;
  proven: boolean;
  status: AdStatus;
  keywords: { id: string; text: string }[];
  countries: string[];
}

type AdSqlRow = {
  ad_archive_id: string;
  page_name: string | null;
  caption: string | null;
  title: string | null;
  link: string | null;
  landing_domain: string | null;
  media_type: string | null;
  thumbnail_key: string | null;
  start_date: string | null;
  end_date: string | null;
  first_seen_date: string;
  last_seen_date: string;
  seen_days: number;
  collation_count: number | null;
  status: AdStatus;
  keywords: { id: string; text: string }[] | null;
  countries: string[] | null;
};

function toItem(r: AdSqlRow): AdListItem {
  const active = r.start_date && r.end_date ? daysActive(r.start_date, r.end_date) : null;
  return {
    adArchiveId: r.ad_archive_id,
    pageName: r.page_name,
    caption: r.caption,
    title: r.title,
    link: r.link,
    landingDomain: r.landing_domain,
    mediaType: r.media_type,
    thumbnailKey: r.thumbnail_key,
    startDate: r.start_date,
    endDate: r.end_date,
    firstSeenDate: r.first_seen_date,
    lastSeenDate: r.last_seen_date,
    seenDays: r.seen_days,
    daysActive: active,
    trendScore: active === null ? null : trendScore({ daysActive: active, seenDays: r.seen_days, landingDomain: r.landing_domain }),
    variants: r.collation_count,
    proven: isProven({ variants: r.collation_count, daysActive: active, countries: r.countries?.length ?? 0 }),
    status: r.status,
    keywords: r.keywords ?? [],
    countries: r.countries ?? [],
  };
}

async function selectAds(db: Db, o: StatusOptions, where: ReturnType<typeof sql>) {
  const { rows } = await db.execute<AdSqlRow>(sql`
    select a.ad_archive_id, a.page_name, a.caption, a.title, a.link, a.landing_domain, a.media_type, a.thumbnail_key,
      a.start_date::text, a.end_date::text, a.first_seen_date::text, a.last_seen_date::text, a.seen_days, a.collation_count, st.status,
      (select json_agg(distinct jsonb_build_object('id', k.id, 'text', k.text)) from ad_sightings s join keywords k on k.id = s.keyword_id
        where s.ad_archive_id = a.ad_archive_id) as keywords,
      (select array_agg(distinct s.country order by s.country) from ad_sightings s where s.ad_archive_id = a.ad_archive_id) as countries
    from ads a join (${adStatusQuery(o.today, o.staleAfterDays, o.countries)}) st on st.ad_archive_id = a.ad_archive_id
    where true ${where}`);
  return rows.map(toItem);
}

const DAYS = sql`(a.end_date - a.start_date + 1)`;
/** trendScore (packages/core) in SQL, so the score filter and sort run in the database. */
const SCORE = sql`case when ${DAYS} >= 5 and nullif(a.landing_domain, '') is not null then ${DAYS} * a.seen_days end`;
/** isProven (packages/core) in SQL, from an ad's variants, days active and countries. */
const provenSql = (variants: SQL, days: SQL, countries: SQL) =>
  sql`(coalesce(${variants}, 0) >= ${PROVEN.variants} or (coalesce(${days}, 0) >= ${PROVEN.days} and coalesce(${countries}, 0) >= ${PROVEN.countries}))`;

/**
 * momentumScore (packages/core) in SQL for ad `a` as of crawl day `today`: each series (the ad's
 * collation_count per crawl day, its page's like count per crawl day) compares its latest day in the
 * window with its earliest, so a series seen on one day only adds nothing.
 */
export function momentumSql(today: string) {
  const from = addDays(today, -MOMENTUM_WINDOW_DAYS);
  const series = (days: ReturnType<typeof sql>) =>
    sql`(select (array_agg(x.v order by x.d desc))[1] as now, case when count(*) > 1 then (array_agg(x.v order by x.d))[1] end as before from (${days}) x)`;
  return sql`(select case when v.before is null and coalesce(l.before, 0) = 0 then 0
      else (10 * coalesce(greatest(v.now - v.before, 0), 0)
        + coalesce(least(100, greatest(0, round((l.now - l.before) * 100.0 / nullif(l.before, 0)))), 0)
        + least(30, coalesce(${DAYS}, 0)))::int end
    from ${series(sql`select s.crawl_day as d, max(s.collation_count) as v from ad_sightings s
        where s.ad_archive_id = a.ad_archive_id and s.collation_count is not null and s.crawl_day between ${from}::date and ${today}::date group by s.crawl_day`)} v,
      ${series(sql`select pd.crawl_day as d, pd.like_count as v from page_days pd
        where pd.page_id = a.page_id and pd.like_count is not null and pd.crawl_day between ${from}::date and ${today}::date`)} l)`;
}

const AD_ORDER: Record<AdSort, ReturnType<typeof sql>> = {
  score: sql`score desc nulls last, last_seen_date desc, ad_archive_id`,
  trending: sql`momentum desc, score desc nulls last, last_seen_date desc, ad_archive_id`,
  days: sql`days_active desc nulls last, last_seen_date desc, ad_archive_id`,
  last_seen: sql`last_seen_date desc, ad_archive_id`,
  first_seen: sql`first_seen_date desc, last_seen_date desc, ad_archive_id`,
  started: sql`start_date desc nulls last, last_seen_date desc, ad_archive_id`,
};

export interface AdPage {
  /** `duplicates`: ads grouped under the item, 1 without `dedupe`; `momentum` is computed for the `trending` sort only, else 0. */
  items: (AdListItem & { duplicates: number; momentum: number })[];
  /** Items matching the filters on all pages. */
  total: number;
}

/** The ads grid: filters, sort, page and total in one SQL query; the score is computed again in TypeScript. */
export async function listAds(db: Db, o: StatusOptions, f: AdFilters = {}): Promise<AdPage> {
  const status = f.status ?? 'running';
  const limit = f.limit ?? AD_PAGE_SIZE;
  const offset = (Math.max(1, f.page ?? 1) - 1) * limit;
  const order = AD_ORDER[f.sort ?? 'score'];
  const where = sql.join(
    [
      status === 'all' ? sql`` : sql`and st.status = ${status}`,
      f.keywordId ? sql`and exists (select 1 from ad_sightings s where s.ad_archive_id = a.ad_archive_id and s.keyword_id = ${f.keywordId})` : sql``,
      f.country ? sql`and exists (select 1 from ad_sightings s where s.ad_archive_id = a.ad_archive_id and s.country = ${f.country})` : sql``,
      f.domain ? sql`and a.landing_domain ilike ${`%${escapeLike(f.domain)}%`} escape '\\'` : sql``,
      f.minDays === undefined ? sql`` : sql`and coalesce(${DAYS}, 0) >= ${f.minDays}`,
      f.minScore === undefined ? sql`` : sql`and coalesce(${SCORE}, 0) >= ${f.minScore}`,
      f.proven
        ? sql`and ${provenSql(sql`a.collation_count`, DAYS, sql`(select count(distinct s.country) from ad_sightings s where s.ad_archive_id = a.ad_archive_id)`)}`
        : sql``,
    ],
    sql` `,
  );
  // With dedupe, each (caption, landing domain) keeps its first ad in the sort; an ad without a caption stays alone.
  const group = f.dedupe
    ? sql`count(*) over w as duplicates, row_number() over (w order by ${order}) as rn from f window w as (partition by coalesce(caption, ad_archive_id), landing_domain)`
    : sql`1 as duplicates, 1 as rn from f`;
  const { rows } = await db.execute<Omit<AdSqlRow, 'ad_archive_id'> & { ad_archive_id: string | null; duplicates: number; momentum: number; total: number }>(sql`
    with f as (
      select a.ad_archive_id, a.page_name, a.caption, a.title, a.link, a.landing_domain, a.media_type, a.thumbnail_key,
        a.start_date, a.end_date, a.first_seen_date, a.last_seen_date, a.seen_days, a.collation_count, st.status, ${DAYS} as days_active, ${SCORE} as score,
        ${f.sort === 'trending' ? momentumSql(o.today) : sql`0`} as momentum
      from ads a join (${adStatusQuery(o.today, o.staleAfterDays, o.countries)}) st on st.ad_archive_id = a.ad_archive_id
      where true ${where}
    ),
    g as (select f.*, ${group}),
    p as (select * from g where rn = 1 order by ${order} limit ${limit} offset ${offset})
    -- The left join keeps one row with the total when the page is empty.
    select p.ad_archive_id, p.page_name, p.caption, p.title, p.link, p.landing_domain, p.media_type, p.thumbnail_key,
      p.start_date::text, p.end_date::text, p.first_seen_date::text, p.last_seen_date::text, p.seen_days, p.collation_count, p.status,
      p.duplicates::int, p.momentum, t.total,
      (select json_agg(distinct jsonb_build_object('id', k.id, 'text', k.text)) from ad_sightings s join keywords k on k.id = s.keyword_id
        where s.ad_archive_id = p.ad_archive_id) as keywords,
      (select array_agg(distinct s.country order by s.country) from ad_sightings s where s.ad_archive_id = p.ad_archive_id) as countries
    from (select count(*)::int as total from g where rn = 1) t left join p on true
    order by ${order}`);
  return {
    items: rows.filter((r) => r.ad_archive_id !== null).map((r) => ({ ...toItem(r as AdSqlRow), duplicates: r.duplicates, momentum: r.momentum })),
    total: rows[0]?.total ?? 0,
  };
}

export interface AdSighting {
  keyword: string;
  country: string;
  position: number;
  crawlDay: string;
}

export async function getAd(db: Db, o: StatusOptions, adArchiveId: string): Promise<(AdListItem & { cta: string | null; sightings: AdSighting[] }) | null> {
  const [ad] = await selectAds(db, o, sql`and a.ad_archive_id = ${adArchiveId}`);
  if (!ad) return null;
  const { rows } = await db.execute<{ keyword: string; country: string; position: number; crawl_day: string; cta: string | null }>(sql`
    select k.text as keyword, s.country, s.position, s.crawl_day::text, a.cta
    from ad_sightings s join keywords k on k.id = s.keyword_id join ads a on a.ad_archive_id = s.ad_archive_id
    where s.ad_archive_id = ${adArchiveId} order by s.crawl_day desc, s.position limit 50`);
  return { ...ad, cta: rows[0]?.cta ?? null, sightings: rows.map((r) => ({ keyword: r.keyword, country: r.country, position: r.position, crawlDay: r.crawl_day })) };
}

export const SHOP_SORTS = ['running_ads', 'last_seen', 'first_seen', 'domain'] as const;
export type ShopSort = (typeof SHOP_SORTS)[number];

export interface ShopRow {
  landingDomain: string;
  pageCount: number;
  firstSeenDate: string;
  lastSeenDate: string;
  runningAds: number;
}

const SHOP_ORDER: Record<ShopSort, ReturnType<typeof sql>> = {
  running_ads: sql`running_ads desc, landing_domain`,
  last_seen: sql`last_seen_date desc, landing_domain`,
  first_seen: sql`first_seen_date desc, landing_domain`,
  domain: sql`landing_domain`,
};

export const SHOP_PAGE_SIZE = 200;

/** Leaves out the landing domains of the `nonShopDomains` setting (isNonShopDomain in SQL). */
export function shopDomainFilter(column: ReturnType<typeof sql>, nonShopDomains: readonly string[]) {
  return nonShopDomains.length ? sql`not (${column} ~ any(${sql.param(nonShopDomains.map(nonShopPattern))}::text[]))` : sql`true`;
}

export interface ShopFilters {
  sort?: ShopSort;
  /** Part of the domain. */
  q?: string;
  /** 1-based. */
  page?: number;
  limit?: number;
  nonShopDomains?: readonly string[];
}

/** The shops table, sorted and paged on the server (spec §6), with the total over all pages. */
export async function listShops(db: Db, f: ShopFilters = {}): Promise<{ items: ShopRow[]; total: number }> {
  const limit = f.limit ?? SHOP_PAGE_SIZE;
  const where = sql`${f.q ? sql`landing_domain ilike ${`%${escapeLike(f.q)}%`} escape '\\'` : sql`true`} and ${shopDomainFilter(sql`landing_domain`, f.nonShopDomains ?? [])}`;
  const { rows } = await db.execute<{ landing_domain: string; page_count: number; first_seen_date: string; last_seen_date: string; running_ads: number }>(sql`
    select landing_domain, cardinality(page_ids) as page_count, first_seen_date::text, last_seen_date::text, running_ads from shops
    where ${where} order by ${SHOP_ORDER[f.sort ?? 'running_ads']} limit ${limit} offset ${(Math.max(1, f.page ?? 1) - 1) * limit}`);
  const { rows: count } = await db.execute<{ n: number }>(sql`select count(*)::int as n from shops where ${where}`);
  return {
    items: rows.map((r) => ({ landingDomain: r.landing_domain, pageCount: r.page_count, firstSeenDate: r.first_seen_date, lastSeenDate: r.last_seen_date, runningAds: r.running_ads })),
    total: count[0]!.n,
  };
}

export interface ShopRead {
  /** Running ads with this landing domain (ad status, not the shops table's snapshot count). */
  ads: number;
  /** Started in the last MARKET.newDays days. */
  newAds: number;
  proven: number;
  /** Keywords its running ads were found under. */
  keywords: number;
}

/** The market read of some shops' running ads (spec §6 "Market read"), keyed by landing domain. */
export async function shopReads(db: Db, o: StatusOptions, domains: readonly string[]): Promise<Map<string, ShopRead>> {
  if (domains.length === 0) return new Map();
  const { rows } = await db.transaction(async (tx) => {
    // As in marketReads: JIT compiling would cost more than the query.
    await tx.execute(sql`set local jit = off`);
    return tx.execute<{ landing_domain: string; ads: number; new_ads: number; proven: number; keywords: number }>(sql`
    with r as (
      select a.ad_archive_id, a.landing_domain, a.start_date, ${DAYS} as days_active, a.collation_count
      from ads a join (${adStatusQuery(o.today, o.staleAfterDays, o.countries)}) st on st.ad_archive_id = a.ad_archive_id and st.status = 'running'
      where a.landing_domain = any(${sql.param([...domains])}::text[])
    ),
    c as (
      select s.ad_archive_id, count(distinct s.country)::int as n from ad_sightings s
      where s.ad_archive_id in (select ad_archive_id from r) group by 1
    ),
    k as (
      select r.landing_domain, count(distinct s.keyword_id)::int as keywords from r join ad_sightings s on s.ad_archive_id = r.ad_archive_id
      group by r.landing_domain
    )
    select r.landing_domain, count(*)::int as ads,
      (count(*) filter (where r.start_date > ${o.today}::date - ${MARKET.newDays}::int))::int as new_ads,
      (count(*) filter (where ${provenSql(sql`r.collation_count`, sql`r.days_active`, sql`c.n`)}))::int as proven,
      coalesce(max(k.keywords), 0) as keywords
    from r left join c on c.ad_archive_id = r.ad_archive_id left join k on k.landing_domain = r.landing_domain
    group by r.landing_domain`);
  });
  return new Map(rows.map((r) => [r.landing_domain, { ads: r.ads, newAds: r.new_ads, proven: r.proven, keywords: r.keywords }]));
}

export async function getShop(db: Db, domain: string): Promise<ShopRow | null> {
  const { rows } = await db.execute<{ landing_domain: string; page_count: number; first_seen_date: string; last_seen_date: string; running_ads: number }>(sql`
    select landing_domain, cardinality(page_ids) as page_count, first_seen_date::text, last_seen_date::text, running_ads from shops where landing_domain = ${domain}`);
  const r = rows[0];
  return r ? { landingDomain: r.landing_domain, pageCount: r.page_count, firstSeenDate: r.first_seen_date, lastSeenDate: r.last_seen_date, runningAds: r.running_ads } : null;
}

export const KEYWORD_SORTS = ['running_ads', 'text', 'origin'] as const;
export type KeywordSort = (typeof KEYWORD_SORTS)[number];

export interface KeywordRow {
  id: string;
  text: string;
  origin: 'seed' | 'store';
  active: boolean;
  /** Running ads in the latest snapshot; null before the first. */
  runningAds: number | null;
  /** Store ids that track it. */
  trackedBy: string[];
}

const KEYWORD_ORDER: Record<KeywordSort, ReturnType<typeof sql>> = {
  running_ads: sql`running_ads desc nulls last, text`,
  text: sql`text`,
  origin: sql`origin, text`,
};

export async function listKeywords(db: Db, sort: KeywordSort = 'running_ads'): Promise<KeywordRow[]> {
  const { rows } = await db.execute<{ id: string; text: string; origin: 'seed' | 'store'; active: boolean; running_ads: number | null; tracked_by: string[] | null }>(sql`
    select k.id, k.text, k.origin, k.active,
      (select kd.running_ads from keyword_days kd where kd.keyword_id = k.id order by kd.slot desc limit 1) as running_ads,
      (select array_agg(sk.store_id order by sk.store_id) from store_keywords sk where sk.keyword_id = k.id) as tracked_by
    from keywords k order by ${KEYWORD_ORDER[sort]}`);
  return rows.map((r) => ({ id: r.id, text: r.text, origin: r.origin, active: r.active, runningAds: r.running_ads, trackedBy: r.tracked_by ?? [] }));
}

/**
 * The market read of each keyword's running ads (spec §6 "Market read"), keyed by keyword id: shops and
 * the top 3 shops' share, ads started in the last 7 days and the 7 before, proven ads (isProven in SQL,
 * countries over all sightings) and videos. A keyword without running ads has no entry.
 */
export async function marketReads(
  db: Db,
  o: StatusOptions,
  f: { keywordId?: string; nonShopDomains?: readonly string[] } = {},
): Promise<Map<string, MarketRead>> {
  // JIT compiling took 1.6 s of 2.5 s on production data (2026-10-25); the query itself runs in 0.85 s.
  const { rows } = await db.transaction(async (tx) => {
    await tx.execute(sql`set local jit = off`);
    return tx.execute<{ keyword_id: string; ads: number; shops: number; top3: number | null; new_ads: number; new_before: number; proven: number; video: number }>(sql`
    with r as (
      select distinct s.keyword_id, a.ad_archive_id, a.landing_domain, a.media_type, a.start_date, ${DAYS} as days_active, a.collation_count
      from ads a join (${adStatusQuery(o.today, o.staleAfterDays, o.countries)}) st on st.ad_archive_id = a.ad_archive_id and st.status = 'running'
      join ad_sightings s on s.ad_archive_id = a.ad_archive_id
      ${f.keywordId ? sql`where s.keyword_id = ${f.keywordId}` : sql``}
    ),
    c as (select s.ad_archive_id, count(distinct s.country)::int as n from ad_sightings s where s.ad_archive_id in (select ad_archive_id from r) group by 1),
    shop as (
      select keyword_id, count(*) as n, row_number() over (partition by keyword_id order by count(*) desc, landing_domain) as rk
      from r where nullif(landing_domain, '') is not null and ${shopDomainFilter(sql`landing_domain`, f.nonShopDomains ?? [])}
      group by keyword_id, landing_domain
    ),
    k as (select keyword_id, count(*)::int as shops, (sum(n) filter (where rk <= 3))::int as top3 from shop group by keyword_id)
    select r.keyword_id, count(*)::int as ads, coalesce(max(k.shops), 0) as shops, max(k.top3) as top3,
      (count(*) filter (where r.start_date > ${o.today}::date - ${MARKET.newDays}::int))::int as new_ads,
      (count(*) filter (where r.start_date > ${o.today}::date - ${2 * MARKET.newDays}::int and r.start_date <= ${o.today}::date - ${MARKET.newDays}::int))::int as new_before,
      (count(*) filter (where ${provenSql(sql`r.collation_count`, sql`r.days_active`, sql`c.n`)}))::int as proven,
      (count(*) filter (where upper(r.media_type) = 'VIDEO'))::int as video
    from r left join c on c.ad_archive_id = r.ad_archive_id left join k on k.keyword_id = r.keyword_id
    group by r.keyword_id`);
  });
  return new Map(
    rows.map((r) => [
      r.keyword_id,
      { ads: r.ads, shops: r.shops, top3Share: r.top3 === null || r.ads === 0 ? null : r.top3 / r.ads, newAds: r.new_ads, newAdsBefore: r.new_before, proven: r.proven, video: r.video },
    ]),
  );
}

export async function getKeyword(db: Db, id: string): Promise<KeywordRow | null> {
  return (await listKeywords(db)).find((k) => k.id === id) ?? null;
}

export interface SeriesPoint {
  /** The slot's date in Asia/Ho_Chi_Minh (the date of `scheduled_for`, not the crawl day). */
  date: string;
  /** The slot's time of day there, "01:00". */
  slotTime: string;
  runningAds: number;
}

/** One point per snapshot of a keyword or a shop, oldest first (spec §6 "Charts"). */
export async function daySeries(db: Db, kind: 'keyword' | 'shop', key: string): Promise<SeriesPoint[]> {
  const table = kind === 'keyword' ? sql.raw('keyword_days') : sql.raw('shop_days');
  const col = kind === 'keyword' ? sql.raw('keyword_id') : sql.raw('landing_domain');
  const { rows } = await db.execute<{ date: string; slot_time: string; running_ads: number }>(sql`
    select to_char(slot at time zone ${VIETNAM}, 'YYYY-MM-DD') as date, to_char(slot at time zone ${VIETNAM}, 'HH24:MI') as slot_time, running_ads
    from ${table} where ${col} = ${key} order by slot`);
  return rows.map((r) => ({ date: r.date, slotTime: r.slot_time, runningAds: r.running_ads }));
}
