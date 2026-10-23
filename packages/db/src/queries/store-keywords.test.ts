import { type Viewer } from '@ideas-hub/core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, createDb, createPool } from '../client';
import { createTestDatabase, testDatabaseAvailable } from '../testing';
import { addStoreKeyword, listStoreKeywords, removeStoreKeyword } from './store-keywords';

const tick = (storeId: string, view: boolean, keywords: boolean) => ({ storeId, view, save: false, keywords });

const admin: Viewer = { userId: 'user_admin', role: 'admin', memberships: [] };
const kwA: Viewer = { userId: 'user_kwA', role: 'member', memberships: [tick('store_A', false, true)] };
const viewA: Viewer = { userId: 'user_viewA', role: 'member', memberships: [tick('store_A', true, false)] };
const none: Viewer = { userId: 'user_none', role: 'member', memberships: [] };
const kwB: Viewer = { userId: 'user_kwB', role: 'member', memberships: [tick('store_B', false, true)] };
const MAX = 80;

describe.skipIf(!testDatabaseAvailable())('store keywords queries', () => {
  let drop: () => Promise<void>;
  let pool: ReturnType<typeof createPool>;
  let db: Db;
  const rows = async () => (await db.execute<{ text: string; origin: string; active: boolean }>(sql`select text, origin, active from keywords order by text`)).rows;
  const links = async () => Number((await db.execute<{ n: string }>(sql`select count(*) n from store_keywords`)).rows[0]!.n);

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    pool = createPool(t.url, 3);
    db = createDb(pool);
    await db.execute(sql`insert into stores (id, name) values ('store_A', 'A'), ('store_B', 'B')`);
    await db.execute(sql`insert into keywords (id, text, origin) values ('kw_seed', 'Teacher Shirt', 'seed'), ('kw_pre', 'pre linked', 'store')`);
    await db.execute(sql`insert into store_keywords (store_id, keyword_id) values ('store_A', 'kw_pre')`);
  }, 60_000);
  afterAll(async () => {
    await pool?.end();
    await drop?.();
  });

  it.each([
    ['admin', admin, true],
    ['kwA', kwA, true],
    ['viewA (view only)', viewA, false],
    ['none', none, false],
    ['kwB (other store)', kwB, false],
  ] as const)('%s: keywords tick on store A is %s', async (_who, viewer, allowed) => {
    expect((await listStoreKeywords(db, viewer, 'store_A')) !== null).toBe(allowed);
    const before = { kw: (await rows()).length, links: await links() };
    const r = await addStoreKeyword(db, viewer, 'store_A', `matrix ${_who}`, MAX);
    expect(r.ok).toBe(allowed);
    if (!allowed) {
      expect(r).toEqual({ ok: false, reason: 'forbidden' });
      expect({ kw: (await rows()).length, links: await links() }).toEqual(before);
    }
    const created = (await db.execute<{ id: string }>(sql`select id from keywords where text = ${`matrix ${_who}`}`)).rows[0];
    // Removing needs the tick too: an allowed viewer removes what it added, the others cannot touch the pre-existing link.
    expect(await removeStoreKeyword(db, viewer, 'store_A', created?.id ?? 'kw_pre')).toBe(allowed);
    if (!allowed) expect(await links()).toBe(before.links);
  });

  it('a store keyword is created with origin store, collapsed text kept, and listed for its store only', async () => {
    expect(await addStoreKeyword(db, kwA, 'store_A', 'dog mom mug', MAX)).toEqual({ ok: true });
    expect((await listStoreKeywords(db, kwA, 'store_A'))!.map((k) => [k.text, k.origin, k.active])).toContainEqual(['dog mom mug', 'store', true]);
    expect((await listStoreKeywords(db, kwB, 'store_B'))!.map((k) => k.text)).not.toContain('dog mom mug');
  });

  it('adding text that exists in another case links the existing keyword and never creates a second', async () => {
    const before = (await rows()).length;
    expect(await addStoreKeyword(db, kwA, 'store_A', 'teacher shirt', MAX)).toEqual({ ok: true });
    expect((await rows()).length).toBe(before);
    expect((await listStoreKeywords(db, kwA, 'store_A'))!.map((k) => k.text)).toContain('Teacher Shirt');
    expect(await addStoreKeyword(db, kwA, 'store_A', 'TEACHER SHIRT', MAX)).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('refuses a new keyword at the active limit but still links an existing one', async () => {
    const active = (await rows()).filter((r) => r.active).length;
    expect(await addStoreKeyword(db, kwB, 'store_B', 'one more', active)).toEqual({ ok: false, reason: 'limit' });
    expect((await rows()).map((r) => r.text)).not.toContain('one more');
    expect(await addStoreKeyword(db, kwB, 'store_B', 'teacher shirt', active)).toEqual({ ok: true });
  });

  it('remove drops only this store link; the last tracker switches a store keyword off, never a seed one', async () => {
    expect(await addStoreKeyword(db, kwB, 'store_B', 'dog mom mug', MAX)).toEqual({ ok: true });
    const mug = (await listStoreKeywords(db, kwA, 'store_A'))!.find((k) => k.text === 'dog mom mug')!;
    // Store B cannot remove store A's link.
    expect(await removeStoreKeyword(db, kwB, 'store_A', mug.id)).toBe(false);
    expect(await removeStoreKeyword(db, kwA, 'store_A', mug.id)).toBe(true);
    expect((await rows()).find((r) => r.text === 'dog mom mug')!.active).toBe(true);
    expect(await removeStoreKeyword(db, kwB, 'store_B', mug.id)).toBe(true);
    expect((await rows()).find((r) => r.text === 'dog mom mug')!.active).toBe(false);

    const seed = (await listStoreKeywords(db, kwA, 'store_A'))!.find((k) => k.text === 'Teacher Shirt')!;
    expect(await removeStoreKeyword(db, kwA, 'store_A', seed.id)).toBe(true);
    expect(await removeStoreKeyword(db, kwB, 'store_B', seed.id)).toBe(true);
    expect((await rows()).find((r) => r.text === 'Teacher Shirt')!.active).toBe(true);
  });

  it('tracking an orphaned store keyword again switches it back on, within the limit', async () => {
    const active = (await rows()).filter((r) => r.active).length;
    expect(await addStoreKeyword(db, kwA, 'store_A', 'dog mom mug', active)).toEqual({ ok: false, reason: 'limit' });
    expect((await rows()).find((r) => r.text === 'dog mom mug')!.active).toBe(false);
    expect(await addStoreKeyword(db, kwA, 'store_A', 'dog mom mug', MAX)).toEqual({ ok: true });
    expect((await rows()).find((r) => r.text === 'dog mom mug')!.active).toBe(true);
  });
});
