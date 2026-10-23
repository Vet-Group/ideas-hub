// The /api/v1 endpoints (contract `ideas-hub-v1.md` §3): query parsing and the snake_case representation.
// The stored `briefings.sections` jsonb is camelCase; every field is mapped by hand so the stored shape can
// change without breaking v1. Users appear by email only, and no response says which store tracks a keyword.
import { type BriefingAd, type BriefingCount, type BriefingNewsItem, type BriefingRisingAd, type Delta, inScope } from '@ideas-hub/core';
import { IDEA_SOURCES, IDEA_STATUSES, IDEA_VIA } from '@ideas-hub/db';
import {
  type ApiBriefing,
  type ApiIdea,
  type ApiStore,
  apiBriefing,
  apiBriefings,
  apiIdea,
  apiIdeas,
  apiLatestGlobalBriefingId,
  apiStores,
} from '@ideas-hub/db/queries';
import { handleIdeaImage } from '@/app/ideas/[id]/image/handler';
import { adLibraryUrl } from '@/components/ads/ad-library-url';
import { thumbUrl } from '@/lib/thumb-url';
import { decodeCursor, encodeCursor } from './cursor';
import { ApiError } from './error';
import { type V1Ctx } from './pipeline';

const iso = (d: Date) => d.toISOString();
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' ? v : null);
const invalid = (message: string) => new ApiError(400, 'invalid_request', message);

// ---- query parameters ------------------------------------------------------------------------------

function limitOf(ctx: V1Ctx): number {
  const raw = ctx.url.searchParams.get('limit');
  if (raw === null) return 50;
  const n = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  if (!(n >= 1 && n <= 200)) throw invalid('limit must be an integer from 1 to 200.');
  return n;
}

function oneOf<T extends string>(ctx: V1Ctx, name: string, values: readonly T[]): T | undefined {
  const raw = ctx.url.searchParams.get(name);
  if (raw === null) return undefined;
  if (!(values as readonly string[]).includes(raw)) throw invalid(`${name} must be one of: ${values.join(', ')}.`);
  return raw as T;
}

function plain(ctx: V1Ctx, name: string): string | undefined {
  const raw = ctx.url.searchParams.get(name);
  if (raw === null) return undefined;
  if (raw === '' || raw.length > 100) throw invalid(`${name} is not valid.`);
  return raw;
}

function dateOf(ctx: V1Ctx, name: string): string | undefined {
  const raw = ctx.url.searchParams.get(name);
  if (raw === null) return undefined;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) throw invalid(`${name} must be a date as YYYY-MM-DD.`);
  return raw;
}

function instantOf(ctx: V1Ctx, name: string): Date | undefined {
  const raw = ctx.url.searchParams.get(name);
  if (raw === null) return undefined;
  const d = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(raw) ? new Date(raw) : null;
  if (!d || Number.isNaN(d.getTime())) throw invalid(`${name} must be an ISO 8601 timestamp with a time zone.`);
  return d;
}

const ID_PART = /^[A-Za-z0-9_-]{1,100}$/;
const MICROS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Filters = Record<string, string | undefined>;

/** Rows of one page and the cursor of the next, from the `limit + 1` rows a query returns. */
function paged<T>(rows: T[], limit: number, key: (row: T) => string[], filters: Filters) {
  const page = rows.slice(0, limit);
  return { page, next_cursor: rows.length > limit ? encodeCursor(key(page[limit - 1]!), filters) : null };
}

// ---- representation --------------------------------------------------------------------------------

const storeJson = (s: ApiStore) => ({ id: s.id, name: s.name, erp_store_code: s.erpStoreCode, pod_studio_store_id: s.podStudioStoreId });
const deltaJson = (d: Delta | null) => (d ? { change: d.change, baseline_day: d.baselineDay, partial: d.partial } : null);
const absThumb = (ctx: V1Ctx, key: string | null) => (key ? `${ctx.baseUrl}${thumbUrl(key)}` : null);

const adJson = (ctx: V1Ctx, a: BriefingAd) => ({
  ad_archive_id: a.adArchiveId,
  ad_library_url: adLibraryUrl(a.adArchiveId),
  page_name: a.pageName,
  caption: a.caption,
  landing_domain: a.landingDomain,
  thumbnail_url: absThumb(ctx, a.thumbnailKey),
  keyword: a.keyword,
  countries: a.countries,
  days_active: a.daysActive,
  trend_score: a.trendScore,
});
const risingAdJson = (ctx: V1Ctx, a: BriefingRisingAd) => ({ ...adJson(ctx, a), sightings: a.sightings, best_position: a.bestPosition });
const countJson = (c: BriefingCount) => ({ key: c.key, label: c.label, running_ads: c.runningAds, delta: deltaJson(c.delta) });
const newsItemJson = (n: BriefingNewsItem) => ({ id: n.id, title: n.title, link: n.link, published_at: n.publishedAt, feed: n.feed });

function briefingJson(ctx: V1Ctx, b: ApiBriefing) {
  const s = b.sections;
  const run = s.sourceRun;
  const kpi = s.kpi;
  let news: unknown = null;
  let suggestions: unknown = null;
  if (!b.aiVisible) {
    news = { state: 'hidden' };
    suggestions = { state: 'hidden' };
  } else {
    if (s.news) {
      const base = { items: s.news.items.map(newsItemJson), holidays: s.news.holidays.map((h) => ({ date: h.date, name: h.name, days: h.days })) };
      news = s.news.state === 'ok' ? { state: 'ok', summary: s.news.summary, ...base } : { state: s.news.state, reason: s.news.reason, ...base };
    }
    if (s.suggestions) {
      suggestions =
        s.suggestions.state === 'ok'
          ? { state: 'ok', items: b.suggestions.map((x) => ({ id: x.id, kind: x.kind, text: x.text, reason: x.reason, evidence: { ads: x.evidence.ads, news: x.evidence.news } })) }
          : { state: s.suggestions.state, reason: s.suggestions.reason };
    }
  }
  return {
    id: b.head.id,
    date: b.head.date,
    scope: b.head.scope,
    keyword: b.head.keyword,
    ready_at: iso(b.head.readyAt),
    source_run: run ? { id: run.id, scheduled_for: run.scheduledFor, running_ads: run.runningAds, ok_searches: run.okSearches, planned_searches: run.plannedSearches } : null,
    kpi: kpi
      ? {
          running_ads: kpi.runningAds,
          delta: deltaJson(kpi.delta),
          ok_rate: kpi.okRate,
          next_holiday: kpi.nextHoliday ? { date: kpi.nextHoliday.date, name: kpi.nextHoliday.name, days: kpi.nextHoliday.days } : null,
        }
      : null,
    top_ads: (s.topAds ?? []).map((a) => adJson(ctx, a)),
    rising_ads: (s.risingAds ?? []).map((a) => risingAdJson(ctx, a)),
    hot_keywords: (s.hotKeywords ?? []).map(countJson),
    rising_shops: (s.risingShops ?? []).map(countJson),
    news,
    suggestions,
  };
}

function ideaJson(ctx: V1Ctx, i: ApiIdea) {
  const snap = i.snapshot;
  return {
    id: i.id,
    store_id: i.storeId,
    source: i.source,
    source_ref: i.sourceRef,
    via: i.via,
    title: i.title,
    notes: i.notes,
    tags: i.tags,
    status: i.status,
    assignee_email: i.assigneeEmail,
    created_by_email: i.createdByEmail,
    created_at: iso(i.createdAt),
    updated_at: iso(i.updatedAt),
    has_image: i.hasImage,
    snapshot: {
      thumbnail_url: absThumb(ctx, str(snap.thumbnailKey)),
      caption: str(snap.caption),
      link: str(snap.link),
      ad_library_url: str(snap.adLibraryUrl),
      page_name: str(snap.pageName),
      landing_domain: str(snap.landingDomain),
      keyword: str(snap.keyword),
      trend_score: num(snap.trendScore),
      media_type: str(snap.mediaType),
      // A suggestion idea keeps its text and reason.
      text: str(snap.text),
      reason: str(snap.reason),
    },
    url: `${ctx.baseUrl}/ideas/${i.id}`,
  };
}

// ---- endpoints -------------------------------------------------------------------------------------

export async function me(ctx: V1Ctx) {
  const rows = await apiStores(ctx.deps.db, ctx.scope, { limit: 1000 });
  return {
    data: {
      email: ctx.owner.email,
      role: ctx.owner.role,
      scopes: ctx.token.scopes,
      expires_at: iso(ctx.token.expiresAt),
      stores: rows.slice(0, 1000).map(storeJson),
    },
  };
}

export async function stores(ctx: V1Ctx) {
  const limit = limitOf(ctx);
  const after = decodeCursor(ctx.url.searchParams.get('cursor'), {}, [ID_PART]);
  const rows = await apiStores(ctx.deps.db, ctx.scope, { afterId: after?.[0], limit });
  const { page, next_cursor } = paged(rows, limit, (s) => [s.id], {});
  return { data: page.map(storeJson), next_cursor };
}

export async function briefings(ctx: V1Ctx) {
  const limit = limitOf(ctx);
  const filters = {
    scope: oneOf(ctx, 'scope', ['global', 'keyword']),
    keyword_id: plain(ctx, 'keyword_id'),
    date_from: dateOf(ctx, 'date_from'),
    date_to: dateOf(ctx, 'date_to'),
  };
  const after = decodeCursor(ctx.url.searchParams.get('cursor'), filters, [DAY, ID_PART]);
  const rows = await apiBriefings(
    ctx.deps.db,
    { scope: filters.scope, keywordId: filters.keyword_id, dateFrom: filters.date_from, dateTo: filters.date_to },
    { after: after && { date: after[0]!, id: after[1]! }, limit },
  );
  const { page, next_cursor } = paged(rows, limit, (b) => [b.date, b.id], filters);
  // The list carries each briefing's head; its sections are one request away (`/briefings/{id}`).
  return { data: page.map((b) => ({ id: b.id, date: b.date, scope: b.scope, keyword: b.keyword, ready_at: iso(b.readyAt) })), next_cursor };
}

export async function briefing(ctx: V1Ctx, id: string) {
  const b = await apiBriefing(ctx.deps.db, ctx.viewer, id);
  if (!b) throw new ApiError(404, 'not_found', 'Briefing not found.');
  return { data: briefingJson(ctx, b) };
}

export async function latestBriefing(ctx: V1Ctx) {
  const id = await apiLatestGlobalBriefingId(ctx.deps.db);
  if (!id) throw new ApiError(404, 'not_found', 'No briefing is ready yet.');
  return briefing(ctx, id);
}

export async function ideas(ctx: V1Ctx) {
  const limit = limitOf(ctx);
  const storeId = plain(ctx, 'store_id');
  // A store outside the token's stores answers like an unknown one.
  if (storeId && !inScope(ctx.scope, storeId)) throw new ApiError(404, 'not_found', 'Store not found.');
  const updatedSince = instantOf(ctx, 'updated_since');
  const filters = {
    store_id: storeId,
    status: oneOf(ctx, 'status', IDEA_STATUSES),
    via: oneOf(ctx, 'via', IDEA_VIA),
    source: oneOf(ctx, 'source', IDEA_SOURCES),
    updated_since: updatedSince && iso(updatedSince),
  };
  const after = decodeCursor(ctx.url.searchParams.get('cursor'), filters, [MICROS, ID_PART]);
  const rows = await apiIdeas(
    ctx.deps.db,
    ctx.scope,
    { storeId, status: filters.status, via: filters.via, source: filters.source, updatedSince },
    { after: after && { updatedAtKey: after[0]!, id: after[1]! }, limit },
  );
  const { page, next_cursor } = paged(rows, limit, (i) => [i.updatedAtKey, i.id], filters);
  return { data: page.map((i) => ideaJson(ctx, i)), next_cursor };
}

export async function idea(ctx: V1Ctx, id: string) {
  const i = await apiIdea(ctx.deps.db, ctx.scope, id);
  if (!i) throw new ApiError(404, 'not_found', 'Idea not found.');
  return { data: ideaJson(ctx, i) };
}

export async function ideaImage(ctx: V1Ctx, id: string) {
  const res = await handleIdeaImage(id, { db: ctx.deps.db, viewer: ctx.viewer, store: ctx.deps.objects });
  if (res.status === 404) throw new ApiError(404, 'not_found', 'Image not found.');
  return res;
}

export function unknownPath(): never {
  throw new ApiError(404, 'not_found', 'Unknown endpoint.');
}
