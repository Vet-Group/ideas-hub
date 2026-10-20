// The research views (plan Step 6, spec §6): the ads grid and detail, shops, keywords and the per-day
// series behind their charts. Ad status is the SQL form of adStatus (ad-status.ts); the trend score is
// computed in TypeScript, as in the briefing, and in SQL (SCORE) for the grid's filter and sort.
import { type AdStatus, VIETNAM, daysActive, nonShopPattern, trendScore } from '@ideas-hub/core';
import { sql } from 'drizzle-orm';
import { type Db } from '../client';
import { adStatusQuery } from './ad-status';
import { escapeLike } from './search';

export interface StatusOptions {
  /** Pacific crawl day of "now". */
  today: string;
  staleAfterDays: number;
  countries: readonly string[];
}

export const AD_SORTS = ['score', 'days', 'last_seen', 'first_seen'] as const;
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
    status: r.status,
    keywords: r.keywords ?? [],
    countries: r.countries ?? [],
  };
}

async function selectAds(db: Db, o: StatusOptions, where: ReturnType<typeof sql>) {
  const { rows } = await db.execute<AdSqlRow>(sql`
    select a.ad_archive_id, a.page_name, a.caption, a.title, a.link, a.landing_domain, a.media_type, a.thumbnail_key,
      a.start_date::text, a.end_date::text, a.first_seen_date::text, a.last_seen_date::text, a.seen_days, st.status,
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

const AD_ORDER: Record<AdSort, ReturnType<typeof sql>> = {
  score: sql`score desc nulls last, last_seen_date desc, ad_archive_id`,
  days: sql`days_active desc nulls last, last_seen_date desc, ad_archive_id`,
  last_seen: sql`last_seen_date desc, ad_archive_id`,
  first_seen: sql`first_seen_date desc, last_seen_date desc, ad_archive_id`,
};

export interface AdPage {
  /** `duplicates`: ads grouped under the item, 1 without `dedupe`. */
  items: (AdListItem & { duplicates: number })[];
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
    ],
    sql` `,
  );
  // With dedupe, each (caption, landing domain) keeps its first ad in the sort; an ad without a caption stays alone.
  const group = f.dedupe
    ? sql`count(*) over w as duplicates, row_number() over (w order by ${order}) as rn from f window w as (partition by coalesce(caption, ad_archive_id), landing_domain)`
    : sql`1 as duplicates, 1 as rn from f`;
  const { rows } = await db.execute<Omit<AdSqlRow, 'ad_archive_id'> & { ad_archive_id: string | null; duplicates: number; total: number }>(sql`
    with f as (
      select a.ad_archive_id, a.page_name, a.caption, a.title, a.link, a.landing_domain, a.media_type, a.thumbnail_key,
        a.start_date, a.end_date, a.first_seen_date, a.last_seen_date, a.seen_days, st.status, ${DAYS} as days_active, ${SCORE} as score
      from ads a join (${adStatusQuery(o.today, o.staleAfterDays, o.countries)}) st on st.ad_archive_id = a.ad_archive_id
      where true ${where}
    ),
    g as (select f.*, ${group}),
    p as (select * from g where rn = 1 order by ${order} limit ${limit} offset ${offset})
    -- The left join keeps one row with the total when the page is empty.
    select p.ad_archive_id, p.page_name, p.caption, p.title, p.link, p.landing_domain, p.media_type, p.thumbnail_key,
      p.start_date::text, p.end_date::text, p.first_seen_date::text, p.last_seen_date::text, p.seen_days, p.status,
      p.duplicates::int, t.total,
      (select json_agg(distinct jsonb_build_object('id', k.id, 'text', k.text)) from ad_sightings s join keywords k on k.id = s.keyword_id
        where s.ad_archive_id = p.ad_archive_id) as keywords,
      (select array_agg(distinct s.country order by s.country) from ad_sightings s where s.ad_archive_id = p.ad_archive_id) as countries
    from (select count(*)::int as total from g where rn = 1) t left join p on true
    order by ${order}`);
  return {
    items: rows.filter((r) => r.ad_archive_id !== null).map((r) => ({ ...toItem(r as AdSqlRow), duplicates: r.duplicates })),
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
