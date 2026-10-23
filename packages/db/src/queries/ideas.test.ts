import { type Viewer, storeScope } from '@ideas-hub/core';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, createDb, createPool } from '../client';
import { savedIdeas } from '../schema';
import { createTestDatabase, testDatabaseAvailable } from '../testing';
import {
  type IdeaRow,
  type IdeaSourceInput,
  IdeaAccessError,
  getIdea,
  ideasCsv,
  lastSaveStoreIds,
  savedRefs,
  listIdeas,
  saveIdea,
  setIdeaStatus,
  trackedKeywords,
  undoSave,
  updateIdea,
} from './ideas';

const T0 = new Date('2026-10-20T01:00:00Z');
const sec = (s: number) => new Date(T0.getTime() + s * 1000);
const tick = (storeId: string, view: boolean, save: boolean) => ({ storeId, view, save, keywords: false });

const admin: Viewer = { userId: 'user_admin', role: 'admin', memberships: [] };
const viewA: Viewer = { userId: 'user_viewA', role: 'member', memberships: [tick('store_A', true, false)] };
const saveA: Viewer = { userId: 'user_saveA', role: 'member', memberships: [tick('store_A', false, true)] };
const none: Viewer = { userId: 'user_none', role: 'member', memberships: [] };
const saveB: Viewer = { userId: 'user_saveB', role: 'member', memberships: [tick('store_B', false, true)] };
const both: Viewer = { userId: 'user_both', role: 'member', memberships: [tick('store_A', false, true), tick('store_B', false, true)] };
const everyone = { admin, viewA, saveA, none, saveB } as const;

const ad = (ref: string, extra: Partial<IdeaSourceInput> = {}): IdeaSourceInput => ({
  source: 'ad',
  sourceRef: ref,
  via: 'ads',
  title: `Ad ${ref}`,
  snapshot: { keyword: 'teacher shirt', thumbnailKey: `${ref}_image.jpg` },
  ...extra,
});

describe.skipIf(!testDatabaseAvailable())('ideas queries', () => {
  let drop: () => Promise<void>;
  let pool: ReturnType<typeof createPool>;
  let db: Db;
  let ideaA: string;
  const count = async () => Number((await db.execute<{ n: string }>(sql`select count(*) n from saved_ideas`)).rows[0]!.n);

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    pool = createPool(t.url, 3);
    db = createDb(pool);
    await db.execute(sql`insert into users (id, email, name, role) values
      ('user_admin', 'admin@x.test', 'Admin', 'admin'), ('user_viewA', 'va@x.test', 'View A', 'member'),
      ('user_saveA', 'sa@x.test', 'Save A', 'member'), ('user_none', 'n@x.test', 'None', 'member'),
      ('user_saveB', 'sb@x.test', 'Save B', 'member'), ('user_both', 'b@x.test', 'Both', 'member')`);
    await db.execute(sql`insert into stores (id, name) values ('store_A', 'A'), ('store_B', 'B')`);
    await db.execute(sql`insert into store_members (store_id, user_id, can_view, can_save) values
      ('store_A', 'user_viewA', true, false), ('store_A', 'user_saveA', false, true), ('store_B', 'user_saveB', false, true),
      ('store_A', 'user_both', false, true), ('store_B', 'user_both', false, true)`);
    await db.execute(sql`insert into keywords (id, text, origin) values ('kw_1', 'teacher shirt', 'store'), ('kw_2', 'nurse mug', 'store')`);
    await db.execute(sql`insert into store_keywords (store_id, keyword_id) values ('store_A', 'kw_1'), ('store_B', 'kw_2')`);
    ideaA = (await saveIdea(db, saveA, ['store_A'], ad('matrix'), T0))[0]!.ideaId;
  }, 60_000);
  afterAll(async () => {
    await pool?.end();
    await drop?.();
  });

  describe('permission matrix (AC 4) on store A', () => {
    it.each([
      ['admin', true, true],
      ['viewA', true, false],
      ['saveA', true, true],
      ['none', false, false],
      ['saveB', false, false],
    ] as const)('%s: view %s, save %s', async (who, view, save) => {
      const v = everyone[who];
      expect((await listIdeas(db, v, 'store_A', {}))?.map((r) => r.id).includes(ideaA) ?? null).toBe(view ? true : null);
      expect((await getIdea(db, v, ideaA))?.id ?? null).toBe(view ? ideaA : null);
      expect(await setIdeaStatus(db, v, ideaA, 'picked', sec(1))).toBe(save);
      expect(await updateIdea(db, v, ideaA, { notes: `by ${who}` }, sec(1))).toBe(save);
      const before = await count();
      if (save) {
        const [r] = await saveIdea(db, v, ['store_A'], ad(`matrix-${who}`), sec(2));
        expect(r?.created).toBe(true);
        expect((await undoSave(db, v, [r!.ideaId], sec(3))).ok).toBe(true);
      } else {
        await expect(saveIdea(db, v, ['store_A'], ad(`matrix-${who}`), sec(2))).rejects.toBeInstanceOf(IdeaAccessError);
      }
      expect(await count()).toBe(before);
    });

    it('a save to A and B by a member with save on A only writes nothing', async () => {
      const before = await count();
      await expect(saveIdea(db, saveA, ['store_A', 'store_B'], ad('ab'), sec(5))).rejects.toBeInstanceOf(IdeaAccessError);
      expect(await count()).toBe(before);
    });

    it('undo never deletes an idea of another user or in a store without save', async () => {
      const [r] = await saveIdea(db, both, ['store_A'], ad('others'), sec(10));
      expect(await undoSave(db, saveA, [r!.ideaId], sec(11))).toEqual({ ok: true, imageKeys: [] });
      expect(await undoSave(db, admin, [r!.ideaId], sec(11))).toEqual({ ok: true, imageKeys: [] });
      const lostSave: Viewer = { ...both, memberships: [tick('store_A', true, false)] };
      expect(await undoSave(db, lostSave, [r!.ideaId], sec(11))).toEqual({ ok: true, imageKeys: [] });
      expect(await getIdea(db, admin, r!.ideaId)).not.toBeNull();
    });
  });

  it('trackedKeywords needs view on the store', async () => {
    expect(await trackedKeywords(db, viewA, 'store_A')).toEqual([{ id: 'kw_1', text: 'teacher shirt' }]);
    expect(await trackedKeywords(db, saveB, 'store_A')).toBeNull();
    expect(await trackedKeywords(db, none, 'store_B')).toBeNull();
    expect(await trackedKeywords(db, admin, 'store_B')).toEqual([{ id: 'kw_2', text: 'nurse mug' }]);
  });

  describe('save', () => {
    it('dedupes on (store, source, source_ref): "Đã có sẵn" returns the existing id', async () => {
      const first = await saveIdea(db, both, ['store_A'], ad('dup'), sec(20));
      const again = await saveIdea(db, both, ['store_A', 'store_B'], ad('dup'), sec(21));
      expect(again).toEqual([
        { storeId: 'store_A', ideaId: first[0]!.ideaId, created: false },
        { storeId: 'store_B', ideaId: expect.stringMatching(/^idea_/), created: true },
      ]);
      // The same ref from another source is a different idea.
      expect((await saveIdea(db, both, ['store_A'], ad('dup', { source: 'suggestion', via: 'briefing' }), sec(22)))[0]?.created).toBe(true);
    });

    it('never dedupes an image-only manual idea', async () => {
      const manual = (key: string): IdeaSourceInput => ({ source: 'manual', sourceRef: null, via: 'manual', title: 'Image', snapshot: {}, imageKeys: { store_A: key } });
      const a = await saveIdea(db, both, ['store_A'], manual('ideas/store_A/one.webp'), sec(30));
      const b = await saveIdea(db, both, ['store_A'], manual('ideas/store_A/two.webp'), sec(31));
      expect(a[0]?.created && b[0]?.created).toBe(true);
      expect(a[0]?.ideaId).not.toBe(b[0]?.ideaId);
      expect((await getIdea(db, both, b[0]!.ideaId))?.imageKey).toBe('ideas/store_A/two.webp');
    });

    it('rows of one save share created_at, so lastSaveStoreIds returns its stores', async () => {
      const u: Viewer = { userId: 'user_saveB', role: 'member', memberships: [tick('store_A', false, true), tick('store_B', false, true)] };
      await saveIdea(db, u, ['store_A'], ad('last-1'), sec(40));
      await saveIdea(db, u, ['store_B', 'store_A'], ad('last-2'), sec(41));
      expect(await lastSaveStoreIds(db, 'user_saveB')).toEqual(['store_A', 'store_B']);
      await saveIdea(db, u, ['store_B'], ad('last-3'), sec(42));
      expect(await lastSaveStoreIds(db, 'user_saveB')).toEqual(['store_B']);
      expect(await lastSaveStoreIds(db, 'user_none')).toEqual([]);
    });
  });

  describe('savedRefs', () => {
    it('marks refs saved in the viewer scope only: a member never sees another store saves', async () => {
      await saveIdea(db, saveB, ['store_B'], ad('only-B'), sec(50));
      const refs = ['matrix', 'only-B', 'never-saved'];
      expect(await savedRefs(db, storeScope(saveA), 'ad', refs)).toEqual(['matrix']);
      expect(await savedRefs(db, storeScope(saveB), 'ad', refs)).toEqual(['only-B']);
      expect((await savedRefs(db, storeScope(admin), 'ad', refs)).sort()).toEqual(['matrix', 'only-B']);
      expect(await savedRefs(db, storeScope(none), 'ad', refs)).toEqual([]);
      expect(await savedRefs(db, storeScope(saveA), 'ad', [])).toEqual([]);
    });

    it('keeps sources apart and lists a ref saved in two stores once', async () => {
      await saveIdea(db, both, ['store_A', 'store_B'], ad('twice'), sec(52));
      expect(await savedRefs(db, storeScope(both), 'ad', ['twice'])).toEqual(['twice']);
      expect(await savedRefs(db, storeScope(both), 'suggestion', ['twice'])).toEqual([]);
    });
  });

  describe('undo', () => {
    it('is accepted at 14 s and refused at 16 s', async () => {
      const [r] = await saveIdea(db, both, ['store_A'], ad('undo-14'), sec(100));
      expect(await undoSave(db, both, [r!.ideaId], sec(114))).toEqual({ ok: true, imageKeys: [] });
      expect(await getIdea(db, both, r!.ideaId)).toBeNull();
      const [late] = await saveIdea(db, both, ['store_A'], ad('undo-16'), sec(200));
      expect(await undoSave(db, both, [late!.ideaId], sec(216))).toEqual({ ok: false, reason: 'expired' });
      expect(await getIdea(db, both, late!.ideaId)).not.toBeNull();
    });

    it('deletes only the ideas this save created, never one the store already had, and returns image keys', async () => {
      const [had] = await saveIdea(db, both, ['store_A'], ad('had'), sec(300));
      const res = await saveIdea(db, both, ['store_A', 'store_B'], ad('had', { source: 'ad' }), sec(305));
      const created = res.filter((r) => r.created).map((r) => r.ideaId);
      expect(created).toHaveLength(1);
      expect(await undoSave(db, both, created, sec(306))).toEqual({ ok: true, imageKeys: [] });
      expect(await getIdea(db, both, had!.ideaId)).not.toBeNull();
      const img = await saveIdea(
        db,
        both,
        ['store_A', 'store_B'],
        { source: 'manual', sourceRef: null, via: 'manual', title: 'x', snapshot: {}, imageKeys: { store_A: 'ideas/store_A/k1.webp', store_B: 'ideas/store_B/k2.webp' } },
        sec(310),
      );
      const undone = await undoSave(db, both, img.map((r) => r.ideaId), sec(311));
      expect(undone.ok && [...undone.imageKeys].sort()).toEqual(['ideas/store_A/k1.webp', 'ideas/store_B/k2.webp']);
    });
  });

  describe('list, status and update', () => {
    let ids: Record<string, string>;
    beforeAll(async () => {
      const save = async (ref: string, title: string, keyword: string, s: number) =>
        (await saveIdea(db, saveB, ['store_B'], ad(ref, { title, snapshot: { keyword } }), sec(s)))[0]!.ideaId;
      ids = {
        one: await save('l1', '50% off teacher', 'Teacher Shirt', 500),
        two: await save('l2', '50 off teacher', 'nurse mug', 501),
        three: await save('l3', 'a_b mug', 'nurse mug', 502),
      };
      await db.execute(sql`delete from saved_ideas where store_id = 'store_B' and id not in (${sql.join(Object.values(ids).map((id) => sql`${id}`), sql`, `)})`);
    });

    it('sorts by updated_at desc and filters by status, tag, keyword, assignee and text', async () => {
      const list = async (f: Parameters<typeof listIdeas>[3]) => (await listIdeas(db, saveB, 'store_B', f))?.map((r) => r.id);
      expect(await list({})).toEqual([ids.three, ids.two, ids.one]);
      expect(await setIdeaStatus(db, saveB, ids.one!, 'done', sec(600))).toBe(true);
      expect(await list({})).toEqual([ids.one, ids.three, ids.two]);
      expect(await setIdeaStatus(db, saveB, ids.one!, 'new', sec(601))).toBe(true);
      expect(await setIdeaStatus(db, saveB, ids.two!, 'dropped', sec(602))).toBe(true);
      expect(await list({ status: 'dropped' })).toEqual([ids.two]);
      expect(await updateIdea(db, saveB, ids.three!, { tags: [' gift ', 'gift', ''], notes: 'see 100%' }, sec(603))).toBe(true);
      expect((await getIdea(db, saveB, ids.three!))?.tags).toEqual(['gift']);
      expect(await list({ tag: 'gift' })).toEqual([ids.three]);
      expect(await list({ keyword: 'teacher shirt' })).toEqual([ids.one]);
      expect(await list({ q: '50%' })).toEqual([ids.one]);
      expect(await list({ q: 'a_b' })).toEqual([ids.three]);
      expect(await list({ q: '100%' })).toEqual([ids.three]);
      expect(await list({ q: '\\' })).toEqual([]);
      expect(await updateIdea(db, saveB, ids.two!, { assigneeId: 'user_both' }, sec(604))).toBe(true);
      expect(await list({ assigneeId: 'user_both' })).toEqual([ids.two]);
      const row = await getIdea(db, saveB, ids.two!);
      expect([row?.assigneeName, row?.createdByName, row?.status]).toEqual(['Both', 'Save B', 'dropped']);
    });

    it('refuses an assignee who is not a member of the store, and an unknown idea', async () => {
      expect(await updateIdea(db, saveB, ids.one!, { assigneeId: 'user_viewA' }, sec(700))).toBe(false);
      expect(await updateIdea(db, saveB, ids.one!, { assigneeId: null }, sec(700))).toBe(true);
      expect(await setIdeaStatus(db, admin, 'idea_missing', 'done', sec(700))).toBe(false);
      expect(await setIdeaStatus(db, saveB, ids.one!, 'archived' as never, sec(700))).toBe(false);
      const [r] = await db.select({ status: savedIdeas.status }).from(savedIdeas).where(eq(savedIdeas.id, ids.one!));
      expect(r?.status).toBe('new');
    });
  });
});

describe('ideasCsv', () => {
  const row: IdeaRow = {
    id: 'idea_1',
    storeId: 'store_A',
    source: 'manual',
    sourceRef: 'https://example.com/a,b',
    via: 'manual',
    title: '=HYPERLINK("http://evil")',
    notes: 'line 1\nline "2"',
    tags: ['gift', '+1'],
    status: 'new',
    assigneeId: null,
    assigneeName: null,
    createdBy: 'user_1',
    createdByName: '@Ngọc',
    createdAt: new Date('2026-10-20T01:00:00Z'),
    updatedAt: new Date('2026-10-20T02:00:00Z'),
    snapshot: { keyword: '-teacher', link: 'https://example.com/a,b' },
    imageKey: null,
  };

  it('starts with a BOM and a header row, ends lines with CRLF', () => {
    const csv = ideasCsv([]);
    expect(csv.startsWith('\uFEFFid,title,status,source,source_ref,via,keyword,link,tags,notes,assignee,created_by,created_at,updated_at\r\n')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(2);
  });

  it('quotes commas, quotes and newlines and guards formula cells', () => {
    const line = ideasCsv([row]).split('\r\n')[1];
    expect(line).toBe(
      [
        'idea_1',
        `"'=HYPERLINK(""http://evil"")"`,
        'new',
        'manual',
        '"https://example.com/a,b"',
        'manual',
        `'-teacher`,
        '"https://example.com/a,b"',
        'gift; +1',
        '"line 1\nline ""2"""',
        '',
        `'@Ngọc`,
        '2026-10-20T01:00:00.000Z',
        '2026-10-20T02:00:00.000Z',
      ].join(','),
    );
  });
});
