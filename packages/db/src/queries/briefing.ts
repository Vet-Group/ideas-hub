// Briefing sections 1–4 (spec §3): SQL and rules, no AI. Used by the Step 4 preview and by the Step 7
// briefing build. "Running" ads only (spec §1 "Measures").
import { type Delta, type Snapshot, addDays, crawlDay, deltaAt, slotKey, trendScore, daysActive } from '@ideas-hub/core';
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
  }>(sql`
    select a.ad_archive_id, a.page_name, a.caption, a.landing_domain, a.thumbnail_key, a.start_date::text, a.end_date::text,
      a.seen_days, a.first_seen_date::text,
      (select count(*)::int from ad_sightings s where s.ad_archive_id = a.ad_archive_id) as sightings,
      (select min(position)::int from ad_sightings s where s.ad_archive_id = a.ad_archive_id and s.run_id = ${run.id}) as best_position
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

/** Section 4: running ads per landing domain, ranked by their change against the same slot. */
export async function risingShops(db: Db, run: SourceRun, o: Pick<BriefingOptions, 'limit'> = {}): Promise<CountRow[]> {
  return counts(await snapshotsOf(db, 'shop_days', run), run, new Map())
    .sort((a, b) => (b.delta?.change ?? -Infinity) - (a.delta?.change ?? -Infinity) || b.runningAds - a.runningAds || a.key.localeCompare(b.key))
    .slice(0, o.limit ?? 10);
}
