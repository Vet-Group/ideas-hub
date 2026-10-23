import { type Viewer } from '@ideas-hub/core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, createDb, createPool } from '../client';
import { createTestDatabase, testDatabaseAvailable } from '../testing';
import { escapeLike, globalSearch } from './search';

describe('escapeLike', () => {
  it('escapes %, _ and backslash', () => {
    expect(escapeLike('50%_off\\x')).toBe('50\\%\\_off\\\\x');
  });
});

const tick = (storeId: string, view: boolean, save: boolean, keywords: boolean) => ({ storeId, view, save, keywords });
const admin: Viewer = { userId: 'user_admin', role: 'admin', memberships: [] };
const viewA: Viewer = { userId: 'user_viewA', role: 'member', memberships: [tick('store_A', true, false, false)] };
const saveA: Viewer = { userId: 'user_saveA', role: 'member', memberships: [tick('store_A', false, true, false)] };
const keywordsB: Viewer = { userId: 'user_kwB', role: 'member', memberships: [tick('store_B', false, false, true)] };
const none: Viewer = { userId: 'user_none', role: 'member', memberships: [] };
const noTicks: Viewer = { userId: 'user_noTicks', role: 'member', memberships: [tick('store_A', false, false, false)] };

describe.skipIf(!testDatabaseAvailable())('globalSearch', () => {
  let drop: () => Promise<void>;
  let pool: ReturnType<typeof createPool>;
  let db: Db;
  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    pool = createPool(t.url, 2);
    db = createDb(pool);
    const ad = (id: string, caption: string, page: string, domain: string, lastSeen: string) =>
      sql`(${id}, ${caption}, ${page}, ${domain}, '2026-10-01', ${lastSeen}, '{}'::jsonb)`;
    await db.execute(sql`insert into ads (ad_archive_id, caption, page_name, landing_domain, first_seen_date, last_seen_date, parsed) values
      ${sql.join(
        [
          ad('a1', '50% off teacher shirt', 'Shop One', 'one.com', '2026-10-10'),
          ad('a2', '50 off teacher shirt', 'Shop Two', 'two.com', '2026-10-12'),
          ad('a3', 'teacher_shirt bundle', 'Shop Three', 'three.com', '2026-10-11'),
          ad('a4', 'teacher shirt', 'Teacher Shirt Co', 'teachershirt.com', '2026-10-09'),
          ...Array.from({ length: 6 }, (_, i) => ad(`b${i}`, `mug number ${i}`, 'Mugs', `mug${i}.com`, `2026-10-0${i + 1}`)),
        ],
        sql`, `,
      )}`);
    await db.execute(sql`insert into keywords (id, text, origin) values ('kw_1', 'teacher shirt', 'seed'), ('kw_2', 'nurse shirt', 'seed')`);
    await db.execute(sql`insert into users (id, email, name, role) values ('user_admin', 'a@x.test', 'Admin', 'admin')`);
    await db.execute(sql`insert into stores (id, name) values ('store_A', 'Store A'), ('store_B', 'Store B')`);
    await db.execute(sql`insert into saved_ideas (id, store_id, source, source_ref, via, title, notes, created_by) values
      ('idea_A', 'store_A', 'manual', null, 'manual', 'Paw print mug', 'gift for dog moms', 'user_admin'),
      ('idea_B', 'store_B', 'manual', null, 'manual', 'Zebra scarf only in B', 'secret_B_note', 'user_admin'),
      ('idea_pct', 'store_A', 'manual', null, 'manual', '100% cotton idea', null, 'user_admin')`);
    await db.execute(sql`insert into shops (landing_domain, first_seen_date, last_seen_date, running_ads) values ('teachershirt.com', '2026-10-01', '2026-10-09', 4)`);
  }, 60_000);
  afterAll(async () => {
    await pool?.end();
    await drop?.();
  });

  it('starts at 3 characters', async () => {
    expect(await globalSearch(db, 'te', admin)).toEqual({ ads: [], shops: [], keywords: [], ideas: [] });
  });

  it('treats % and _ as plain characters', async () => {
    expect((await globalSearch(db, '50%', admin)).ads.map((a) => a.adArchiveId)).toEqual(['a1']);
    expect((await globalSearch(db, 'r_s', admin)).ads.map((a) => a.adArchiveId)).toEqual(['a3']);
  });

  it('ranks the closer match first, then by last seen, and keeps 5 per group', async () => {
    const r = await globalSearch(db, 'teacher shirt', admin);
    expect(r.ads[0]?.adArchiveId).toBe('a4');
    expect(r.keywords.map((k) => k.text)).toEqual(['teacher shirt']);
    expect((await globalSearch(db, 'teachershirt', admin)).shops.map((s) => s.landingDomain)).toEqual(['teachershirt.com']);
    const mugs = await globalSearch(db, 'mug number', admin);
    expect(mugs.ads.map((a) => a.adArchiveId)).toEqual(['b5', 'b4', 'b3', 'b2', 'b1']);
  });

  it('finds ideas by title or notes inside the viewer view scope only', async () => {
    const ids = async (v: Viewer, q: string) => (await globalSearch(db, q, v)).ideas.map((i) => i.id);
    expect((await globalSearch(db, 'paw print', saveA)).ideas).toEqual([{ id: 'idea_A', title: 'Paw print mug', storeName: 'Store A' }]);
    expect(await ids(viewA, 'dog moms')).toEqual(['idea_A']);
    // Store B text never reaches a member of store A, by title or by notes.
    expect(await ids(viewA, 'zebra scarf')).toEqual([]);
    expect(await ids(saveA, 'secret_B_note')).toEqual([]);
    expect(await ids(admin, 'zebra scarf')).toEqual(['idea_B']);
    expect(await ids(admin, 'secret_B_note')).toEqual(['idea_B']);
    // keywords-only implies view of its own store (B), nothing of A.
    expect(await ids(keywordsB, 'zebra scarf')).toEqual(['idea_B']);
    expect(await ids(keywordsB, 'paw print')).toEqual([]);
    // No membership, or a membership with no tick, sees no idea.
    expect(await ids(none, 'paw print')).toEqual([]);
    expect(await ids(noTicks, 'paw print')).toEqual([]);
    expect(await ids(viewA, '100%')).toEqual(['idea_pct']);
  });
});
