// Saved ideas (spec §4 "Save-idea flow", plan Step 6): save with dedupe, undo within 15 s, list, status,
// notes/tags/assignee and CSV. Every read and write checks the viewer's ticks on the idea's store.
import { type StoreScope, type Viewer, can } from '@ideas-hub/core';
import { type SQL, and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { type Db } from '../client';
import { type IDEA_SOURCES, type IDEA_VIA, IDEA_STATUSES, keywords, savedIdeas, storeKeywords, storeMembers, users } from '../schema';
import { escapeLike } from './search';

export type IdeaStatus = (typeof IDEA_STATUSES)[number];
export type IdeaSource = (typeof IDEA_SOURCES)[number];
export type IdeaVia = (typeof IDEA_VIA)[number];

/** The toast shows "Hoàn tác" for 10 s; the server allows 5 s more for a paused toast. */
export const UNDO_WINDOW_MS = 15_000;

export type IdeaSourceInput = {
  source: IdeaSource;
  /** ad_archive_id, suggestion id or pasted link; null for an image-only manual idea (never deduplicated). */
  sourceRef: string | null;
  via: IdeaVia;
  title: string;
  snapshot: Record<string, unknown>;
  /** storeId -> object key of the uploaded image, manual ideas only. */
  imageKeys?: Record<string, string>;
};

export type SaveResult = { storeId: string; ideaId: string; created: boolean }[];

/** A chosen store is outside the viewer's `save` scope; nothing was written. */
export class IdeaAccessError extends Error {}

/** A suggestion's idea title; a later briefing repeats a suggestion under a new id with the same title. */
export const suggestionTitle = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 140);

const sameSuggestionTitle = (titles: string[]) =>
  and(eq(savedIdeas.source, 'suggestion'), inArray(sql`lower(${savedIdeas.title})`, titles.map((t) => t.toLowerCase())));

/**
 * One transaction for all stores, so the rows share `created_at` (lastSaveStoreIds relies on it). A suggestion
 * whose title is already an idea in a store counts as saved there (issue #107).
 */
export async function saveIdea(db: Db, viewer: Viewer, storeIds: string[], input: IdeaSourceInput, at: Date): Promise<SaveResult> {
  const ids = [...new Set(storeIds)];
  if (ids.length === 0 || !ids.every((s) => can(viewer, s, 'save'))) throw new IdeaAccessError('save is not allowed on every chosen store');
  return db.transaction(async (tx) => {
    // shortcut: no unique index on the title, so two saves of one title in the same instant can both insert; add one if that shows up.
    const sameTitle =
      input.source === 'suggestion'
        ? await tx
            .selectDistinctOn([savedIdeas.storeId], { id: savedIdeas.id, storeId: savedIdeas.storeId })
            .from(savedIdeas)
            .where(and(inArray(savedIdeas.storeId, ids), sameSuggestionTitle([input.title])))
            .orderBy(savedIdeas.storeId, asc(savedIdeas.createdAt))
        : [];
    const toInsert = ids.filter((s) => !sameTitle.some((r) => r.storeId === s));
    const inserted =
      toInsert.length === 0
        ? []
        : await tx
            .insert(savedIdeas)
            .values(
              toInsert.map((storeId) => ({
                storeId,
                source: input.source,
                sourceRef: input.sourceRef,
                via: input.via,
                title: input.title,
                snapshot: input.snapshot,
                imageKey: input.imageKeys?.[storeId] ?? null,
                createdBy: viewer.userId,
                createdAt: at,
                updatedAt: at,
              })),
            )
            .onConflictDoNothing({ target: [savedIdeas.storeId, savedIdeas.source, savedIdeas.sourceRef] })
            .returning({ id: savedIdeas.id, storeId: savedIdeas.storeId });
    const missing = toInsert.filter((s) => !inserted.some((r) => r.storeId === s));
    const sameRef =
      missing.length === 0 || input.sourceRef === null
        ? []
        : await tx
            .select({ id: savedIdeas.id, storeId: savedIdeas.storeId })
            .from(savedIdeas)
            .where(and(inArray(savedIdeas.storeId, missing), eq(savedIdeas.source, input.source), eq(savedIdeas.sourceRef, input.sourceRef)));
    const existing = [...sameTitle, ...sameRef];
    return ids.map((storeId) => {
      const made = inserted.find((r) => r.storeId === storeId);
      if (made) return { storeId, ideaId: made.id, created: true };
      const had = existing.find((r) => r.storeId === storeId);
      if (!had) throw new Error(`idea for ${storeId} was neither inserted nor found`);
      return { storeId, ideaId: had.id, created: false };
    });
  });
}

/**
 * Deletes the viewer's own ideas among `ideaIds` in stores where they have `save`, all or none: if one
 * is older than the undo window nothing is deleted. Returns the image keys so the caller deletes the objects.
 */
export async function undoSave(
  db: Db,
  viewer: Viewer,
  ideaIds: string[],
  at: Date,
): Promise<{ ok: true; imageKeys: string[] } | { ok: false; reason: 'expired' }> {
  if (ideaIds.length === 0) return { ok: true, imageKeys: [] };
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: savedIdeas.id, storeId: savedIdeas.storeId, createdAt: savedIdeas.createdAt, imageKey: savedIdeas.imageKey })
      .from(savedIdeas)
      .where(and(inArray(savedIdeas.id, ideaIds), eq(savedIdeas.createdBy, viewer.userId)))
      .for('update');
    const mine = rows.filter((r) => can(viewer, r.storeId, 'save'));
    if (mine.some((r) => at.getTime() - r.createdAt.getTime() > UNDO_WINDOW_MS)) return { ok: false, reason: 'expired' } as const;
    if (mine.length > 0) await tx.delete(savedIdeas).where(inArray(savedIdeas.id, mine.map((r) => r.id)));
    return { ok: true, imageKeys: mine.flatMap((r) => (r.imageKey ? [r.imageKey] : [])) } as const;
  });
}

/** Which of `refs` are saved (any store in `scope`), for the "Đã lưu" state on Save buttons; uses `saved_ideas_source_key`. */
export async function savedRefs(db: Db, scope: StoreScope, source: IdeaSource, refs: string[]): Promise<string[]> {
  if (refs.length === 0 || (scope.storeIds !== 'all' && scope.storeIds.length === 0)) return [];
  const rows = await db
    .selectDistinct({ ref: savedIdeas.sourceRef })
    .from(savedIdeas)
    .where(
      and(
        eq(savedIdeas.source, source),
        inArray(savedIdeas.sourceRef, refs),
        scope.storeIds === 'all' ? undefined : inArray(savedIdeas.storeId, [...scope.storeIds]),
      ),
    );
  return rows.flatMap((r) => (r.ref ? [r.ref] : []));
}

/** Which suggestions are saved in `scope`: by id, or by a saved suggestion with the same title (saveIdea's rule). */
export async function savedSuggestions(db: Db, scope: StoreScope, rows: readonly { id: string; text: string }[]): Promise<string[]> {
  const byId = await savedRefs(db, scope, 'suggestion', rows.map((r) => r.id));
  const rest = rows.filter((r) => !byId.includes(r.id));
  if (rest.length === 0 || (scope.storeIds !== 'all' && scope.storeIds.length === 0)) return byId;
  const hits = await db
    .selectDistinct({ title: sql<string>`lower(${savedIdeas.title})` })
    .from(savedIdeas)
    .where(
      and(
        sameSuggestionTitle(rest.map((r) => suggestionTitle(r.text))),
        scope.storeIds === 'all' ? undefined : inArray(savedIdeas.storeId, [...scope.storeIds]),
      ),
    );
  const saved = new Set(hits.map((h) => h.title));
  return [...byId, ...rest.filter((r) => saved.has(suggestionTitle(r.text).toLowerCase())).map((r) => r.id)];
}

/** The stores of the user's last save: their rows with the latest `created_at` (one save, one transaction). */
export async function lastSaveStoreIds(db: Db, userId: string): Promise<string[]> {
  const { rows } = await db.execute<{ store_id: string }>(sql`
    select distinct store_id from saved_ideas
    where created_by = ${userId} and created_at = (select max(created_at) from saved_ideas where created_by = ${userId})
    order by store_id`);
  return rows.map((r) => r.store_id);
}

export type IdeaFilters = { status?: IdeaStatus; tag?: string; keyword?: string; assigneeId?: string; q?: string };

export type IdeaRow = {
  id: string;
  storeId: string;
  source: IdeaSource;
  sourceRef: string | null;
  via: IdeaVia;
  title: string;
  notes: string | null;
  tags: string[];
  status: IdeaStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
  snapshot: Record<string, unknown>;
  imageKey: string | null;
};

const assignee = alias(users, 'assignee');
const creator = alias(users, 'creator');

function selectIdeas(db: Db) {
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
      assigneeId: savedIdeas.assigneeId,
      assigneeName: assignee.name,
      createdBy: savedIdeas.createdBy,
      createdByName: creator.name,
      createdAt: savedIdeas.createdAt,
      updatedAt: savedIdeas.updatedAt,
      snapshot: savedIdeas.snapshot,
      imageKey: savedIdeas.imageKey,
    })
    .from(savedIdeas)
    .innerJoin(creator, eq(creator.id, savedIdeas.createdBy))
    .leftJoin(assignee, eq(assignee.id, savedIdeas.assigneeId));
}

const toRow = (r: Awaited<ReturnType<typeof selectIdeas>>[number]): IdeaRow => ({ ...r, snapshot: r.snapshot as Record<string, unknown> });

/** Null when the viewer lacks `view` on the store; newest change first. */
export async function listIdeas(db: Db, viewer: Viewer, storeId: string, f: IdeaFilters): Promise<IdeaRow[] | null> {
  if (!can(viewer, storeId, 'view')) return null;
  const where: SQL[] = [eq(savedIdeas.storeId, storeId)];
  if (f.status) where.push(eq(savedIdeas.status, f.status));
  if (f.tag) where.push(sql`${f.tag} = any(${savedIdeas.tags})`);
  if (f.keyword) where.push(sql`lower(${savedIdeas.snapshot}->>'keyword') = lower(${f.keyword})`);
  if (f.assigneeId) where.push(eq(savedIdeas.assigneeId, f.assigneeId));
  const q = f.q?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(sql`(${savedIdeas.title} ilike ${like} escape '\\' or ${savedIdeas.notes} ilike ${like} escape '\\')`);
  }
  const rows = await selectIdeas(db)
    .where(and(...where))
    .orderBy(desc(savedIdeas.updatedAt), desc(savedIdeas.id));
  return rows.map(toRow);
}

/** Null when missing or outside the viewer's `view` scope (both answer 404). */
export async function getIdea(db: Db, viewer: Viewer, ideaId: string): Promise<IdeaRow | null> {
  const [r] = await selectIdeas(db).where(eq(savedIdeas.id, ideaId));
  return r && can(viewer, r.storeId, 'view') ? toRow(r) : null;
}

async function storeOfIdea(db: Db, ideaId: string): Promise<string | null> {
  const [r] = await db.select({ storeId: savedIdeas.storeId }).from(savedIdeas).where(eq(savedIdeas.id, ideaId));
  return r?.storeId ?? null;
}

/**
 * Any status to any status (Done back to New included); needs `save` on the idea's store. Applies only while the
 * idea is still in the status the caller was shown (`expected`), so a double click cannot jump New to Done.
 * Picked or done records `picked_at` once; done records `done_at`, which leaving done clears.
 */
export async function setIdeaStatus(db: Db, viewer: Viewer, ideaId: string, status: IdeaStatus, at: Date, expected: IdeaStatus): Promise<boolean> {
  if (!IDEA_STATUSES.includes(status) || !IDEA_STATUSES.includes(expected)) return false;
  const storeId = await storeOfIdea(db, ideaId);
  if (!storeId || !can(viewer, storeId, 'save')) return false;
  const set = {
    status,
    updatedAt: at,
    ...(status === 'picked' || status === 'done' ? { pickedAt: sql`coalesce(${savedIdeas.pickedAt}, ${at.toISOString()}::timestamptz)` } : {}),
    doneAt: status === 'done' ? at : null,
  };
  const updated = await db.update(savedIdeas).set(set).where(and(eq(savedIdeas.id, ideaId), eq(savedIdeas.status, expected))).returning({ id: savedIdeas.id });
  return updated.length > 0;
}

/** Needs `save`; the assignee must be a member of the idea's store (any tick), or null. */
export async function updateIdea(
  db: Db,
  viewer: Viewer,
  ideaId: string,
  patch: { notes?: string | null; tags?: string[]; assigneeId?: string | null },
  at: Date,
): Promise<boolean> {
  const storeId = await storeOfIdea(db, ideaId);
  if (!storeId || !can(viewer, storeId, 'save')) return false;
  if (patch.assigneeId) {
    const member = await db
      .select({ userId: storeMembers.userId })
      .from(storeMembers)
      .where(
        and(
          eq(storeMembers.storeId, storeId),
          eq(storeMembers.userId, patch.assigneeId),
          or(eq(storeMembers.canView, true), eq(storeMembers.canSave, true), eq(storeMembers.canKeywords, true)),
        ),
      );
    if (member.length === 0) return false;
  }
  const set: Partial<typeof savedIdeas.$inferInsert> = { updatedAt: at };
  if (patch.notes !== undefined) set.notes = patch.notes;
  if (patch.tags !== undefined) set.tags = [...new Set(patch.tags.map((t) => t.trim()).filter(Boolean))];
  if (patch.assigneeId !== undefined) set.assigneeId = patch.assigneeId;
  const updated = await db.update(savedIdeas).set(set).where(eq(savedIdeas.id, ideaId)).returning({ id: savedIdeas.id });
  return updated.length > 0;
}

const CSV_COLUMNS: [string, (r: IdeaRow) => string][] = [
  ['id', (r) => r.id],
  ['title', (r) => r.title],
  ['status', (r) => r.status],
  ['source', (r) => r.source],
  ['source_ref', (r) => r.sourceRef ?? ''],
  ['via', (r) => r.via],
  ['keyword', (r) => (typeof r.snapshot.keyword === 'string' ? r.snapshot.keyword : '')],
  ['link', (r) => (typeof r.snapshot.link === 'string' ? r.snapshot.link : '')],
  ['tags', (r) => r.tags.join('; ')],
  ['notes', (r) => r.notes ?? ''],
  ['assignee', (r) => r.assigneeName ?? ''],
  ['created_by', (r) => r.createdByName],
  ['created_at', (r) => r.createdAt.toISOString()],
  ['updated_at', (r) => r.updatedAt.toISOString()],
];

/** A spreadsheet would run a cell starting with = + - @ (or tab/CR) as a formula; a leading ' keeps it text. */
function csvCell(value: string): string {
  const v = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** RFC 4180 (CRLF, quoted where needed) with a UTF-8 BOM so Excel reads Vietnamese text correctly. */
export function ideasCsv(rows: IdeaRow[]): string {
  const lines = [CSV_COLUMNS.map(([h]) => h), ...rows.map((r) => CSV_COLUMNS.map(([, get]) => get(r)))];
  return `\uFEFF${lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** The keywords the store tracks; null without `view`. */
export async function trackedKeywords(db: Db, viewer: Viewer, storeId: string): Promise<{ id: string; text: string }[] | null> {
  if (!can(viewer, storeId, 'view')) return null;
  return db
    .select({ id: keywords.id, text: keywords.text })
    .from(storeKeywords)
    .innerJoin(keywords, eq(keywords.id, storeKeywords.keywordId))
    .where(eq(storeKeywords.storeId, storeId))
    .orderBy(asc(keywords.text));
}

/** True when the store has any saved idea, whatever the filters; null without `view`. */
export async function storeHasIdeas(db: Db, viewer: Viewer, storeId: string): Promise<boolean | null> {
  if (!can(viewer, storeId, 'view')) return null;
  const [r] = await db.select({ id: savedIdeas.id }).from(savedIdeas).where(eq(savedIdeas.storeId, storeId)).limit(1);
  return !!r;
}

/**
 * Options of the Ideas keyword filter: the keywords the store tracks plus those on its saved ideas
 * (`snapshot.keyword`, which a store with no tracked keywords still carries), one per spelling ignoring
 * case since the filter matches ignoring case. Null without `view`.
 */
export async function ideaKeywordOptions(db: Db, viewer: Viewer, storeId: string): Promise<string[] | null> {
  const tracked = await trackedKeywords(db, viewer, storeId);
  if (!tracked) return null;
  const onIdeas = await db
    .selectDistinct({ text: sql<string>`btrim(${savedIdeas.snapshot}->>'keyword')` })
    .from(savedIdeas)
    .where(and(eq(savedIdeas.storeId, storeId), sql`btrim(${savedIdeas.snapshot}->>'keyword') <> ''`));
  const byLower = new Map<string, string>();
  for (const text of [...tracked.map((k) => k.text), ...onIdeas.map((k) => k.text).sort()]) if (!byLower.has(text.toLowerCase())) byLower.set(text.toLowerCase(), text);
  return [...byLower.values()].sort((a, b) => a.localeCompare(b));
}
