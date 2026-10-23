import { createDb, createPool } from '@ideas-hub/db/client';
import { createTestDatabase, testDatabaseAvailable } from '@ideas-hub/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { t } from '@/lib/strings.vi';

const tdb = testDatabaseAvailable() ? await createTestDatabase() : null;
const pools: ReturnType<typeof createPool>[] = [];
let current: unknown;

vi.mock('@/lib/db', () => {
  const pool = createPool(tdb!.url);
  pools.push(pool);
  return { pool, db: createDb(pool) };
});
vi.mock('@/lib/session', () => ({ requireUser: async () => current }));
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const viewer = (userId: string, canSave: boolean) => ({
  userId,
  role: 'member' as const,
  name: userId,
  email: `${userId}@t.local`,
  memberships: [{ storeId: 'store_A', view: true, save: canSave, keywords: false }],
});

describe.skipIf(!tdb)('updateIdeaAction', async () => {
  const { updateIdeaAction } = await import('./actions');
  const q = (text: string, values: unknown[] = []) => pools[0]!.query(text, values);
  const idea = async () => (await q(`select notes, tags, assignee_id, updated_at from saved_ideas where id = 'idea_1'`)).rows[0];
  // The action takes untrusted input from the client, so the tests send what a hand-made request could.
  const send = (patch: unknown) => updateIdeaAction('idea_1', patch as Parameters<typeof updateIdeaAction>[1]);

  beforeAll(async () => {
    for (const id of ['u_saver', 'u_viewer', 'u_member', 'u_outsider']) {
      await q(`insert into users (id, email, name, role) values ($1, $2, $1, 'member')`, [id, `${id}@t.local`]);
    }
    await q(`insert into stores (id, name) values ('store_A', 'A')`);
    await q(`insert into store_members (store_id, user_id, can_view, can_save) values
      ('store_A', 'u_saver', true, true), ('store_A', 'u_viewer', true, false), ('store_A', 'u_member', true, false)`);
    await q(`insert into saved_ideas (id, store_id, source, source_ref, via, title, created_by, notes, tags)
      values ('idea_1', 'store_A', 'manual', 'https://example.com/a', 'manual', 'Idea', 'u_saver', 'old note', '{old}')`);
  });

  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end()));
    await tdb?.drop();
  });

  it('saves a valid patch: trimmed, deduplicated tags, a member as assignee', async () => {
    current = viewer('u_saver', true);
    expect(await send({ notes: 'x'.repeat(5000), tags: [' gift ', 'gift', '', 'mug'], assigneeId: 'u_member' })).toEqual({ ok: true });
    expect(await idea()).toMatchObject({ notes: 'x'.repeat(5000), tags: ['gift', 'mug'], assignee_id: 'u_member' });
    expect(await send({ notes: null, tags: Array.from({ length: 20 }, (_, i) => `t${i}`), assigneeId: null })).toEqual({ ok: true });
    expect(await idea()).toMatchObject({ notes: null, assignee_id: null });
    expect(await send({ tags: ['y'.repeat(50)] })).toEqual({ ok: true });
  });

  it.each<[string, unknown, string]>([
    ['notes over 5000 characters', { notes: 'x'.repeat(5001) }, t.ideaPatch.notes],
    ['notes that are not text', { notes: 42 }, t.ideaPatch.invalid],
    ['more than 20 tags', { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }, t.ideaPatch.tags],
    ['a tag over 50 characters', { tags: ['y'.repeat(51)] }, t.ideaPatch.tags],
    ['tags that are not a list', { tags: 'gift' }, t.ideaPatch.invalid],
    ['a non-string tag', { tags: [1, 'gift'] }, t.ideaPatch.invalid],
    ['an assignee that is not text', { assigneeId: 7 }, t.ideaPatch.invalid],
    ['a field the form does not have', { status: 'done' }, t.ideaPatch.invalid],
    ['a patch that is not an object', 'notes', t.ideaPatch.invalid],
    ['a patch that is null', null, t.ideaPatch.invalid],
  ])('refuses %s with an error, and writes nothing', async (_name, patch, error) => {
    current = viewer('u_saver', true);
    const before = await idea();
    expect(await send(patch)).toEqual({ ok: false, error });
    expect(await idea()).toEqual(before);
  });

  it('refuses an assignee who is not a member of the idea store, and writes nothing', async () => {
    current = viewer('u_saver', true);
    const before = await idea();
    expect(await send({ notes: 'changed', assigneeId: 'u_outsider' })).toEqual({ ok: false, error: t.save.failed });
    expect(await send({ notes: 'changed', assigneeId: 'u_missing' })).toEqual({ ok: false, error: t.save.failed });
    expect(await idea()).toEqual(before);
  });

  it('keeps the permission check: a member without save, or without the store, is refused', async () => {
    const before = await idea();
    for (const v of [viewer('u_viewer', false), { ...viewer('u_outsider', true), memberships: [] }]) {
      current = v;
      expect(await send({ notes: 'by someone else' })).toEqual({ ok: false, error: t.save.failed });
    }
    expect(await idea()).toEqual(before);
    expect(await updateIdeaAction('idea_missing', { notes: 'n' })).toEqual({ ok: false, error: t.save.failed });
  });
});
