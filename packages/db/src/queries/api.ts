// Reads for the `/api/v1` endpoints (contract `ideas-hub-v1.md` §3): keyset pages over a StoreScope or a
// Viewer, so none of them runs without an access decision. Each page function returns up to `limit + 1`
// rows; the caller uses the extra one to know whether a next page exists.
import { type BriefingSections, type StoreScope, type Viewer } from '@ideas-hub/core';
import { type SQL, and, asc, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { type Db } from '../client';
import { type IDEA_SOURCES, type IDEA_STATUSES, type IDEA_VIA, briefings, keywords, savedIdeas, stores, users } from '../schema';
import { type SuggestionRow, briefingSuggestions, keywordAiVisible } from './briefing-view';

/** A `storeId` filter or the scope itself as a condition; null means no condition (admin), `false` an empty scope. */
function scopeCondition(scope: StoreScope, column: Parameters<typeof inArray>[0]): SQL | null | false {
  if (scope.storeIds === 'all') return null;
  return scope.storeIds.length === 0 ? false : inArray(column, [...scope.storeIds]);
}

export interface ApiStore {
  id: string;
  name: string;
  erpStoreCode: string | null;
  podStudioStoreId: string | null;
}

const storeColumns = { id: stores.id, name: stores.name, erpStoreCode: stores.erpStoreCode, podStudioStoreId: stores.podStudioStoreId };

/** Stores in the scope, by id ascending. */
export async function apiStores(db: Db, scope: StoreScope, page: { afterId?: string; limit: number }): Promise<ApiStore[]> {
  const inScope = scopeCondition(scope, stores.id);
  if (inScope === false) return [];
  const where = and(inScope ?? undefined, page.afterId ? sql`${stores.id} > ${page.afterId}` : undefined);
  return db.select(storeColumns).from(stores).where(where).orderBy(asc(stores.id)).limit(page.limit + 1);
}

export interface ApiIdea {
  id: string;
  storeId: string;
  source: (typeof IDEA_SOURCES)[number];
  sourceRef: string | null;
  via: (typeof IDEA_VIA)[number];
  title: string;
  notes: string | null;
  tags: string[];
  status: (typeof IDEA_STATUSES)[number];
  assigneeEmail: string | null;
  createdByEmail: string;
  createdAt: Date;
  updatedAt: Date;
  /** `updated_at` with microseconds, the exact keyset value (a JS Date keeps milliseconds only). */
  updatedAtKey: string;
  snapshot: Record<string, unknown>;
  hasImage: boolean;
}

export interface ApiIdeaFilters {
  storeId?: string;
  status?: (typeof IDEA_STATUSES)[number];
  via?: (typeof IDEA_VIA)[number];
  source?: (typeof IDEA_SOURCES)[number];
  /** Inclusive. */
  updatedSince?: Date;
}

const assignee = alias(users, 'assignee');
const creator = alias(users, 'creator');

function selectApiIdeas(db: Db) {
  return db
    .select({
      id: savedIdeas.id,
      storeId: savedIdeas.storeId,
      source: savedIdeas.source,
      sourceRef: savedIdeas.sourceRef,
      via: savedIdeas.via,
      title: savedIdeas.title,
      notes: savedIdeas.notes,
      tags: savedIdeas.tags,
      status: savedIdeas.status,
      assigneeEmail: assignee.email,
      createdByEmail: creator.email,
      createdAt: savedIdeas.createdAt,
      updatedAt: savedIdeas.updatedAt,
      updatedAtKey: sql<string>`to_char(${savedIdeas.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      snapshot: savedIdeas.snapshot,
      hasImage: sql<boolean>`${savedIdeas.imageKey} is not null`,
    })
    .from(savedIdeas)
    .innerJoin(creator, eq(creator.id, savedIdeas.createdBy))
    .leftJoin(assignee, eq(assignee.id, savedIdeas.assigneeId));
}

const asIdea = (r: Awaited<ReturnType<typeof selectApiIdeas>>[number]): ApiIdea => ({ ...r, snapshot: r.snapshot as Record<string, unknown> });

/** Ideas of the scope's stores, newest change first: (`updated_at` desc, `id` desc). */
export async function apiIdeas(
  db: Db,
  scope: StoreScope,
  f: ApiIdeaFilters,
  page: { after?: { updatedAtKey: string; id: string }; limit: number },
): Promise<ApiIdea[]> {
  const inScope = scopeCondition(scope, savedIdeas.storeId);
  if (inScope === false) return [];
  const where = and(
    inScope ?? undefined,
    f.storeId ? eq(savedIdeas.storeId, f.storeId) : undefined,
    f.status ? eq(savedIdeas.status, f.status) : undefined,
    f.via ? eq(savedIdeas.via, f.via) : undefined,
    f.source ? eq(savedIdeas.source, f.source) : undefined,
    f.updatedSince ? gte(savedIdeas.updatedAt, f.updatedSince) : undefined,
    page.after ? sql`(${savedIdeas.updatedAt}, ${savedIdeas.id}) < (${page.after.updatedAtKey}::timestamptz, ${page.after.id})` : undefined,
  );
  const rows = await selectApiIdeas(db)
    .where(where)
    .orderBy(desc(savedIdeas.updatedAt), desc(savedIdeas.id))
    .limit(page.limit + 1);
  return rows.map(asIdea);
}

/** Null when missing or outside the scope (both answer 404). */
export async function apiIdea(db: Db, scope: StoreScope, ideaId: string): Promise<ApiIdea | null> {
  const inScope = scopeCondition(scope, savedIdeas.storeId);
  if (inScope === false) return null;
  const [r] = await selectApiIdeas(db).where(and(eq(savedIdeas.id, ideaId), inScope ?? undefined));
  return r ? asIdea(r) : null;
}

export interface ApiBriefingHead {
  id: string;
  date: string;
  scope: 'global' | 'keyword';
  keyword: { id: string; text: string } | null;
  readyAt: Date;
}

export interface ApiBriefingFilters {
  scope?: 'global' | 'keyword';
  keywordId?: string;
  /** Inclusive Asia/Ho_Chi_Minh dates, `YYYY-MM-DD`. */
  dateFrom?: string;
  dateTo?: string;
}

const headColumns = {
  id: briefings.id,
  date: briefings.date,
  scope: briefings.scope,
  keywordId: briefings.keywordId,
  keywordText: keywords.text,
  readyAt: briefings.readyAt,
};

const asHead = (r: { id: string; date: string; scope: 'global' | 'keyword'; keywordId: string | null; keywordText: string | null; readyAt: Date | null }): ApiBriefingHead => ({
  id: r.id,
  date: r.date,
  scope: r.scope,
  keyword: r.keywordId ? { id: r.keywordId, text: r.keywordText ?? '' } : null,
  readyAt: r.readyAt!,
});

/** Ready briefings, newest first: (`date` desc, `id` desc). Shared research data: no store scope. */
export async function apiBriefings(db: Db, f: ApiBriefingFilters, page: { after?: { date: string; id: string }; limit: number }): Promise<ApiBriefingHead[]> {
  const where = and(
    isNotNull(briefings.readyAt),
    f.scope ? eq(briefings.scope, f.scope) : undefined,
    f.keywordId ? eq(briefings.keywordId, f.keywordId) : undefined,
    f.dateFrom ? sql`${briefings.date} >= ${f.dateFrom}::date` : undefined,
    f.dateTo ? sql`${briefings.date} <= ${f.dateTo}::date` : undefined,
    page.after ? sql`(${briefings.date}, ${briefings.id}) < (${page.after.date}::date, ${page.after.id})` : undefined,
  );
  const rows = await db
    .select(headColumns)
    .from(briefings)
    .leftJoin(keywords, eq(keywords.id, briefings.keywordId))
    .where(where)
    .orderBy(desc(briefings.date), desc(briefings.id))
    .limit(page.limit + 1);
  return rows.map(asHead);
}

export interface ApiBriefing {
  head: ApiBriefingHead;
  /** Without `news` and `suggestions` when `aiVisible` is false. */
  sections: BriefingSections;
  suggestions: SuggestionRow[];
  aiVisible: boolean;
}

/** The latest ready global briefing, by date; what `/briefing` shows. */
export async function apiLatestGlobalBriefingId(db: Db): Promise<string | null> {
  const [r] = await db
    .select({ id: briefings.id })
    .from(briefings)
    .where(and(eq(briefings.scope, 'global'), isNotNull(briefings.readyAt)))
    .orderBy(desc(briefings.date), desc(briefings.id))
    .limit(1);
  return r?.id ?? null;
}

/**
 * One ready briefing for one viewer; null when missing or still building. A keyword briefing's AI sections
 * go only to a viewer who passes `canSeeKeywordAi` (the viewer is already narrowed to the token's stores).
 */
export async function apiBriefing(db: Db, viewer: Viewer, id: string): Promise<ApiBriefing | null> {
  const [r] = await db
    .select({ ...headColumns, sections: briefings.sections })
    .from(briefings)
    .leftJoin(keywords, eq(keywords.id, briefings.keywordId))
    .where(and(eq(briefings.id, id), isNotNull(briefings.readyAt)))
    .limit(1);
  if (!r) return null;
  const head = asHead(r);
  const all = r.sections as BriefingSections;
  const aiVisible = head.keyword ? await keywordAiVisible(db, viewer, head.keyword.id) : true;
  if (!aiVisible) {
    const { news: _news, suggestions: _suggestions, ...shared } = all;
    return { head, sections: shared, suggestions: [], aiVisible };
  }
  return { head, sections: all, suggestions: await briefingSuggestions(db, id), aiVisible };
}
