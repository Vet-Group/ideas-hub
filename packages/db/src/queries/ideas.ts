// Saved ideas (spec §4 "Save-idea flow", plan Step 6): save with dedupe, undo within 15 s, list, status,
// notes/tags/assignee and CSV. Every read and write checks the viewer's ticks on the idea's store.
import { type Viewer, can } from '@ideas-hub/core';
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

/** One transaction for all stores, so the rows share `created_at` (lastSaveStoreIds relies on it). */
export async function saveIdea(db: Db, viewer: Viewer, storeIds: string[], input: IdeaSourceInput, at: Date): Promise<SaveResult> {
  const ids = [...new Set(storeIds)];
  if (ids.length === 0 || !ids.every((s) => can(viewer, s, 'save'))) throw new IdeaAccessError('save is not allowed on every chosen store');
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(savedIdeas)
      .values(
        ids.map((storeId) => ({
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
    const missing = ids.filter((s) => !inserted.some((r) => r.storeId === s));
    const existing =
      missing.length === 0 || input.sourceRef === null
        ? []
        : await tx
            .select({ id: savedIdeas.id, storeId: savedIdeas.storeId })
            .from(savedIdeas)
            .where(and(inArray(savedIdeas.storeId, missing), eq(savedIdeas.source, input.source), eq(savedIdeas.sourceRef, input.sourceRef)));
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

/** Any status to any status (Done back to New included); needs `save` on the idea's store. */
export async function setIdeaStatus(db: Db, viewer: Viewer, ideaId: string, status: IdeaStatus, at: Date): Promise<boolean> {
  if (!IDEA_STATUSES.includes(status)) return false;
  const storeId = await storeOfIdea(db, ideaId);
  if (!storeId || !can(viewer, storeId, 'save')) return false;
  const updated = await db.update(savedIdeas).set({ status, updatedAt: at }).where(eq(savedIdeas.id, ideaId)).returning({ id: savedIdeas.id });
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
