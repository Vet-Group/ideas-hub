// Briefing sections 1–4 (spec §3): SQL and rules, no AI. Used by the Step 4 preview and by the Step 7
// briefing build. "Running" ads only (spec §1 "Measures").
import {
  type BriefingHoliday,
  type BriefingKpi,
  type BriefingNewsItem,
  type BriefingSourceRun,
  type Delta,
  type Snapshot,
  addDays,
  crawlDay,
  daysActive,
  daysBetween,
  deltaAt,
  slotKey,
  trendScore,
} from '@ideas-hub/core';
import { sql } from 'drizzle-orm';
import { type Db } from '../client';
import { adStatusQuery } from './ad-status';

export interface SourceRun {
  id: string;
  scheduledFor: Date;
  startedAt: Date;
  /** Pacific date of the run start. */
  crawlDay: string;
}

/** The last completed scheduled run: the last one that wrote its KeywordDay snapshot (spec §3). */
export async function sourceRun(db: Db, onOrBefore: Date = new Date()): Promise<SourceRun | null> {
  const { rows } = await db.execute<{ id: string; scheduled_for: string; started_at: string }>(sql`
    select r.id, r.scheduled_for, r.started_at from crawl_runs r
    where r.trigger = 'schedule' and r.status in ('done', 'stopped') and r.started_at <= ${onOrBefore}
      and exists (select 1 from keyword_days kd where kd.slot = r.scheduled_for)
    order by r.scheduled_for desc limit 1`);
  const r = rows[0];
  if (!r) return null;
  const startedAt = new Date(r.started_at);
  return { id: r.id, scheduledFor: new Date(r.scheduled_for), startedAt, crawlDay: crawlDay(startedAt) };
}

export interface BriefingOptions {
  staleAfterDays: number;
  countries: readonly string[];
  /** Keyword report: only ads seen under this keyword. */
  keywordId?: string;
  limit?: number;
}

export interface AdRow {
  adArchiveId: string;
  pageName: string | null;
  caption: string | null;
  landingDomain: string | null;
  thumbnailKey: string | null;
  startDate: string | null;
  endDate: string | null;
  seenDays: number;
  daysActive: number | null;
  trendScore: number | null;
  /** Keyword text of the best (lowest position) sighting in the run; a keyword report's own keyword. */
  keyword: string | null;
  /** Distinct countries of its sightings in the run (under the report's keyword), sorted. */
  countries: string[];
}

const keywordFilter = (keywordId?: string) =>
  keywordId ? sql`and exists (select 1 from ad_sightings s where s.ad_archive_id = a.ad_archive_id and s.keyword_id = ${keywordId})` : sql``;

async function runningAds(db: Db, run: SourceRun, o: BriefingOptions, extra = sql``) {
  const { rows } = await db.execute<{
    ad_archive_id: string;
    page_name: string | null;
    caption: string | null;
    landing_domain: string | null;
    thumbnail_key: string | null;
    start_date: string | null;
    end_date: string | null;
    seen_days: number;
    first_seen_date: string;
    sightings: number;
    best_position: number | null;
    keyword: string | null;
    countries: string[];
  }>(sql`
    select a.ad_archive_id, a.page_name, a.caption, a.landing_domain, a.thumbnail_key, a.start_date::text, a.end_date::text,
      a.seen_days, a.first_seen_date::text,
      (select count(*)::int from ad_sightings s where s.ad_archive_id = a.ad_archive_id) as sightings,
      (select min(position)::int from ad_sightings s where s.ad_archive_id = a.ad_archive_id and s.run_id = ${run.id}) as best_position,
      ${o.keywordId
        ? sql`(select text from keywords where id = ${o.keywordId})`
        : sql`(select k.text from ad_sightings s join keywords k on k.id = s.keyword_id
            where s.ad_archive_id = a.ad_archive_id and s.run_id = ${run.id} order by s.position, k.text limit 1)`} as keyword,
      array(select distinct s.country from ad_sightings s where s.ad_archive_id = a.ad_archive_id and s.run_id = ${run.id}
        ${o.keywordId ? sql`and s.keyword_id = ${o.keywordId}` : sql``} order by 1) as countries
    from ads a join (${adStatusQuery(run.crawlDay, o.staleAfterDays, o.countries)}) st on st.ad_archive_id = a.ad_archive_id
    where st.status = 'running' ${keywordFilter(o.keywordId)} ${extra}`);
  return rows;
}

function toAdRow(r: Awaited<ReturnType<typeof runningAds>>[number]): AdRow {
  const active = r.start_date && r.end_date ? daysActive(r.start_date, r.end_date) : null;
  return {
    adArchiveId: r.ad_archive_id,
    pageName: r.page_name,
    caption: r.caption,
    landingDomain: r.landing_domain,
    thumbnailKey: r.thumbnail_key,
    startDate: r.start_date,
    endDate: r.end_date,
    seenDays: r.seen_days,
    daysActive: active,
    trendScore: active === null ? null : trendScore({ daysActive: active, seenDays: r.seen_days, landingDomain: r.landing_domain }),
    keyword: r.keyword,
    countries: r.countries,
  };
}

/** Section 1: top trending ads by trend score. */
export async function topTrendingAds(db: Db, run: SourceRun, o: BriefingOptions): Promise<AdRow[]> {
  return (await runningAds(db, run, o))
    .map(toAdRow)
    .filter((a) => a.trendScore !== null)
    .sort((a, b) => b.trendScore! - a.trendScore! || a.adArchiveId.localeCompare(b.adArchiveId))
    .slice(0, o.limit ?? 10);
}

/** Section 2: rising new ads, first seen and started within the last 3 crawl days, by how often and how high. */
export async function risingNewAds(db: Db, run: SourceRun, o: BriefingOptions): Promise<(AdRow & { sightings: number; bestPosition: number | null })[]> {
  const from = addDays(run.crawlDay, -2);
  const rows = await runningAds(db, run, o, sql`and a.first_seen_date >= ${from}::date and a.start_date >= ${from}::date`);
  return rows
    .map((r) => ({ ...toAdRow(r), sightings: r.sightings, bestPosition: r.best_position }))
    .sort((a, b) => b.sightings - a.sightings || (a.bestPosition ?? 999) - (b.bestPosition ?? 999) || a.adArchiveId.localeCompare(b.adArchiveId))
    .slice(0, o.limit ?? 10);
}

export interface CountRow {
  key: string;
  label: string;
  runningAds: number;
  delta: Delta | null;
}

async function snapshotsOf(db: Db, table: 'keyword_days' | 'shop_days', run: SourceRun) {
  const keyCol = table === 'keyword_days' ? sql.raw('keyword_id') : sql.raw('landing_domain');
  const { rows } = await db.execute<{ key: string; crawl_day: string; slot: string; running_ads: number }>(sql`
    select ${keyCol} as key, crawl_day::text, slot, running_ads from ${sql.raw(table)} where slot <= ${run.scheduledFor}`);
  const slot = slotKey(run.scheduledFor);
  const byKey = new Map<string, Snapshot[]>();
  for (const r of rows) {
    const s: Snapshot = { crawlDay: r.crawl_day, slot: new Date(r.slot), value: r.running_ads };
    if (slotKey(s.slot) !== slot) continue;
    byKey.set(r.key, [...(byKey.get(r.key) ?? []), s]);
  }
  return byKey;
}

function counts(byKey: Map<string, Snapshot[]>, run: SourceRun, labels: Map<string, string>): CountRow[] {
  const out: CountRow[] = [];
  for (const [key, snaps] of byKey) {
    const latest = snaps.find((s) => s.slot.getTime() === run.scheduledFor.getTime());
    if (!latest) continue;
    out.push({ key, label: labels.get(key) ?? key, runningAds: latest.value, delta: deltaAt(snaps, latest) });
  }
  return out;
}

/** Section 3: running ads per keyword and the change against the same slot 7 crawl days earlier. */
export async function hotKeywords(db: Db, run: SourceRun, o: Pick<BriefingOptions, 'keywordId' | 'limit'> = {}): Promise<CountRow[]> {
  const { rows } = await db.execute<{ id: string; text: string }>(sql`select id, text from keywords`);
  const rowsOut = counts(await snapshotsOf(db, 'keyword_days', run), run, new Map(rows.map((r) => [r.id, r.text])));
  return rowsOut
    .filter((r) => !o.keywordId || r.key === o.keywordId)
    .sort((a, b) => b.runningAds - a.runningAds || a.label.localeCompare(b.label))
    .slice(0, o.limit ?? 10);
}

/** Section 4: running ads per landing domain, ranked by their change against the same slot; a keyword report keeps the domains of ads seen under its keyword. */
export async function risingShops(db: Db, run: SourceRun, o: Pick<BriefingOptions, 'keywordId' | 'limit'> = {}): Promise<CountRow[]> {
  const domains = o.keywordId
    ? new Set(
        (
          await db.execute<{ d: string }>(sql`
            select distinct a.landing_domain as d from ads a join ad_sightings s on s.ad_archive_id = a.ad_archive_id
            where s.keyword_id = ${o.keywordId} and a.landing_domain is not null`)
        ).rows.map((r) => r.d),
      )
    : null;
  return counts(await snapshotsOf(db, 'shop_days', run), run, new Map())
    .filter((r) => !domains || domains.has(r.key))
    .sort((a, b) => (b.delta?.change ?? -Infinity) - (a.delta?.change ?? -Infinity) || b.runningAds - a.runningAds || a.key.localeCompare(b.key))
    .slice(0, o.limit ?? 10);
}

/** A source run by id, so a rerun keeps the run its first attempt chose. */
export async function sourceRunById(db: Db, id: string): Promise<SourceRun | null> {
  const { rows } = await db.execute<{ id: string; scheduled_for: string; started_at: string }>(sql`
    select id, scheduled_for, started_at from crawl_runs where id = ${id}`);
  const r = rows[0];
  if (!r) return null;
  const startedAt = new Date(r.started_at);
  return { id: r.id, scheduledFor: new Date(r.scheduled_for), startedAt, crawlDay: crawlDay(startedAt) };
}

/** The source run as stored in `briefings.sections.sourceRun`. */
export async function briefingSourceRun(db: Db, run: SourceRun): Promise<BriefingSourceRun> {
  const { rows } = await db.execute<{ running_ads: number | null; ok_searches: number | null; planned_searches: number }>(sql`
    select running_ads, ok_searches, planned_searches from crawl_runs where id = ${run.id}`);
  const r = rows[0]!;
  return { id: run.id, scheduledFor: run.scheduledFor.toISOString(), runningAds: r.running_ads ?? 0, okSearches: r.ok_searches ?? 0, plannedSearches: r.planned_searches };
}

/**
 * The KPI row (spec §3, plan Step 7 "Briefing page"): the run's `running_ads` and its change against the
 * same slot 7 crawl days earlier, the baseline being a run of that slot that wrote `keyword_days`, so a
 * run that wrote none is skipped; `ok_searches` ÷ `planned_searches`; the next US holiday from `holidays`.
 */
export async function briefingKpi(db: Db, run: SourceRun, date: string): Promise<BriefingKpi> {
  const { rows } = await db.execute<{ id: string; scheduled_for: string; started_at: string; running_ads: number; ok_searches: number | null; planned_searches: number }>(sql`
    select r.id, r.scheduled_for, r.started_at, r.running_ads, r.ok_searches, r.planned_searches from crawl_runs r
    where r.trigger = 'schedule' and r.status in ('done', 'stopped') and r.running_ads is not null and r.scheduled_for <= ${run.scheduledFor}
      and exists (select 1 from keyword_days kd where kd.slot = r.scheduled_for)`);
  const snaps = rows.map((r) => ({ id: r.id, crawlDay: crawlDay(new Date(r.started_at)), slot: new Date(r.scheduled_for), value: r.running_ads }));
  const latest = snaps.find((s) => s.id === run.id);
  const own = rows.find((r) => r.id === run.id);
  const { rows: hol } = await db.execute<{ date: string; name: string }>(sql`
    select date::text, name from holidays where date >= ${date}::date order by date, name limit 1`);
  return {
    runningAds: latest?.value ?? 0,
    delta: latest ? deltaAt(snaps, latest) : null,
    okRate: own && own.planned_searches > 0 ? (own.ok_searches ?? 0) / own.planned_searches : null,
    nextHoliday: hol[0] ? { date: hol[0].date, name: hol[0].name, days: daysBetween(date, hol[0].date) } : null,
  };
}

/** Section 5's holidays: those within `days` of the briefing date. */
export async function upcomingHolidays(db: Db, date: string, days = 60, limit = 5): Promise<BriefingHoliday[]> {
  const { rows } = await db.execute<{ date: string; name: string }>(sql`
    select date::text, name from holidays where date >= ${date}::date and date <= ${addDays(date, days)}::date order by date, name limit ${limit}`);
  return rows.map((r) => ({ date: r.date, name: r.name, days: daysBetween(date, r.date) }));
}

/** Section 5's news: items of enabled feeds from the `hours` before `at`, newest first, with their summary for the prompt. */
export async function briefingNews(db: Db, at: Date, hours = 72, limit = 15): Promise<(BriefingNewsItem & { summary: string | null })[]> {
  const { rows } = await db.execute<{ id: string; title: string; link: string; published_at: string | null; url: string; summary: string | null }>(sql`
    select n.id, n.title, n.link, n.published_at, f.url, n.summary from news_items n join news_feeds f on f.id = n.feed_id
    where f.enabled and coalesce(n.published_at, n.created_at) > ${new Date(at.getTime() - hours * 3_600_000)} and coalesce(n.published_at, n.created_at) <= ${at}
    order by coalesce(n.published_at, n.created_at) desc, n.id limit ${limit}`);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    link: r.link,
    publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
    feed: new URL(r.url).hostname.replace(/^www\./, ''),
    summary: r.summary,
  }));
}
