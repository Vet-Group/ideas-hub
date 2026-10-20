// The research views (plan Step 6, spec §6): the ads grid and detail, shops, keywords and the per-day
// series behind their charts. Ad status is the SQL form of adStatus (ad-status.ts); the trend score is
// computed in TypeScript, as in the briefing.
import { type AdStatus, VIETNAM, daysActive, trendScore } from '@ideas-hub/core';
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
  sort?: AdSort;
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

const BY: Record<AdSort, (a: AdListItem, b: AdListItem) => number> = {
  score: (a, b) => (b.trendScore ?? -1) - (a.trendScore ?? -1),
  days: (a, b) => (b.daysActive ?? -1) - (a.daysActive ?? -1),
  last_seen: (a, b) => b.lastSeenDate.localeCompare(a.lastSeenDate),
  first_seen: (a, b) => b.firstSeenDate.localeCompare(a.firstSeenDate),
};

/** The ads grid: filters in SQL where they can be, the score filter and sort after scoring. */
export async function listAds(db: Db, o: StatusOptions, f: AdFilters = {}): Promise<AdListItem[]> {
  const status = f.status ?? 'running';
  const where = sql.join(
    [
      status === 'all' ? sql`` : sql`and st.status = ${status}`,
      f.keywordId ? sql`and exists (select 1 from ad_sightings s where s.ad_archive_id = a.ad_archive_id and s.keyword_id = ${f.keywordId})` : sql``,
      f.country ? sql`and exists (select 1 from ad_sightings s where s.ad_archive_id = a.ad_archive_id and s.country = ${f.country})` : sql``,
      f.domain ? sql`and a.landing_domain ilike ${`%${escapeLike(f.domain)}%`} escape '\\'` : sql``,
    ],
    sql` `,
  );
  const sort = BY[f.sort ?? 'score'];
  return (await selectAds(db, o, where))
    .filter((a) => (f.minDays === undefined || (a.daysActive ?? 0) >= f.minDays) && (f.minScore === undefined || (a.trendScore ?? 0) >= f.minScore))
    .sort((a, b) => sort(a, b) || b.lastSeenDate.localeCompare(a.lastSeenDate) || a.adArchiveId.localeCompare(b.adArchiveId))
    .slice(0, f.limit ?? 120);
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

/** The shops table, sorted on the server (spec §6). */
export async function listShops(db: Db, sort: ShopSort = 'running_ads', q?: string, limit = 200): Promise<ShopRow[]> {
  const { rows } = await db.execute<{ landing_domain: string; page_count: number; first_seen_date: string; last_seen_date: string; running_ads: number }>(sql`
    select landing_domain, cardinality(page_ids) as page_count, first_seen_date::text, last_seen_date::text, running_ads from shops
    where ${q ? sql`landing_domain ilike ${`%${escapeLike(q)}%`} escape '\\'` : sql`true`}
    order by ${SHOP_ORDER[sort]} limit ${limit}`);
  return rows.map((r) => ({ landingDomain: r.landing_domain, pageCount: r.page_count, firstSeenDate: r.first_seen_date, lastSeenDate: r.last_seen_date, runningAds: r.running_ads }));
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
