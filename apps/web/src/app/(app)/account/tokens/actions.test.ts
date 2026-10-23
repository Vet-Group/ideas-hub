import { createDb, createPool } from '@ideas-hub/db/client';
import { createTestDatabase, testDatabaseAvailable } from '@ideas-hub/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashToken } from '@/lib/api-v1/token';
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
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const viewer = (userId: string, role: 'admin' | 'member', storeIds: string[] = []) => ({
  userId,
  role,
  name: userId,
  email: `${userId}@t.local`,
  memberships: storeIds.map((storeId) => ({ storeId, view: true, save: false, keywords: false })),
});
const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
const base = { name: 'POD Studio', scopes: ['ideas:read'], days: '90' };

describe.skipIf(!tdb)('Tokens page actions', async () => {
  const { createToken, revokeToken } = await import('./actions');
  const q = (text: string, values: unknown[] = []) => pools[0]!.query(text, values);
  const tokens = async () => (await q(`select * from api_tokens order by created_at`)).rows;

  beforeAll(async () => {
    for (const [id, role, createdBy] of [
      ['u_admin', 'admin', null],
      ['u_member', 'member', null],
      ['u_service', 'member', 'u_admin'],
      ['u_other_service', 'member', null],
    ] as const) {
      await q(`insert into users (id, email, name, role) values ($1, $2, $1, $3)`, [id, `${id}@t.local`, role]);
      if (createdBy) await q(`update users set created_by = $1 where id = $2`, [createdBy, id]);
    }
    await q(`insert into stores (id, name) values ('store_A', 'A'), ('store_B', 'B')`);
    await q(`insert into store_members (store_id, user_id, can_view) values ('store_A', 'u_member', true), ('store_A', 'u_service', true)`);
  });

  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end()));
    await tdb?.drop();
  });

  it('creates a token once: ihp_ plus 40 characters, only its hash stored, 90 days by default', async () => {
    current = viewer('u_member', 'member', ['store_A']);
    const out = await createToken(null, form({ ...base, ownerId: '', storeIds: [] }));
    expect(out).toMatchObject({ name: 'POD Studio', token: expect.stringMatching(/^ihp_[0-9A-Za-z]{40}$/) });
    const [row] = await tokens();
    expect(row).toMatchObject({ user_id: 'u_member', created_by: 'u_member', name: 'POD Studio', scopes: ['ideas:read'], store_ids: null, revoked_at: null, last_used_at: null });
    expect(row.token_hash).toBe(hashToken((out as { token: string }).token));
    expect(JSON.stringify(row)).not.toContain((out as { token: string }).token);
    expect((row.expires_at.getTime() - row.created_at.getTime()) / 86_400_000).toBe(90);
  });

  it('refuses a missing name or scope and a lifetime outside 1 to 365 days, and writes nothing', async () => {
    current = viewer('u_member', 'member', ['store_A']);
    const before = (await tokens()).length;
    const cases: [Record<string, string | string[]>, unknown][] = [
      [{ ...base, name: '  ' }, t.tokens.errors.name],
      [{ ...base, scopes: [] }, t.tokens.errors.scopes],
      [{ ...base, scopes: ['admin:write'] }, expect.any(String)],
      [{ ...base, days: '0' }, t.tokens.errors.days],
      [{ ...base, days: '366' }, t.tokens.errors.days],
      [{ ...base, days: 'abc' }, t.tokens.errors.days],
    ];
    for (const [fields, error] of cases) {
      expect(await createToken(null, form({ ownerId: '', storeIds: [], ...fields }))).toEqual({ error });
    }
    expect((await tokens()).length).toBe(before);
    expect(await createToken(null, form({ ...base, days: '365', ownerId: '', storeIds: [] }))).toHaveProperty('token');
  });

  it('keeps a store list inside the owner’s stores', async () => {
    current = viewer('u_member', 'member', ['store_A']);
    expect(await createToken(null, form({ ...base, ownerId: '', storeIds: ['store_B'] }))).toEqual({ error: t.tokens.errors.stores });
    expect(await createToken(null, form({ ...base, ownerId: '', storeIds: ['store_A', 'store_nope'] }))).toEqual({ error: t.tokens.errors.stores });
    expect(await createToken(null, form({ ...base, ownerId: '', storeIds: ['store_A'] }))).toHaveProperty('token');
    expect((await tokens()).at(-1)).toMatchObject({ store_ids: ['store_A'] });
  });

  it('lets an admin create a token for a service user they created, and nobody else', async () => {
    current = viewer('u_admin', 'admin');
    const out = await createToken(null, form({ ...base, ownerId: 'u_service', storeIds: ['store_A'] }));
    expect(out).toHaveProperty('token');
    expect((await tokens()).at(-1)).toMatchObject({ user_id: 'u_service', created_by: 'u_admin', store_ids: ['store_A'] });
    // Not the service user's store, not a user another admin (or nobody) created, not a member's own request for someone else.
    expect(await createToken(null, form({ ...base, ownerId: 'u_service', storeIds: ['store_B'] }))).toEqual({ error: t.tokens.errors.stores });
    expect(await createToken(null, form({ ...base, ownerId: 'u_other_service', storeIds: [] }))).toEqual({ error: t.tokens.errors.owner });
    expect(await createToken(null, form({ ...base, ownerId: 'u_member', storeIds: [] }))).toEqual({ error: t.tokens.errors.owner });
    current = viewer('u_member', 'member', ['store_A']);
    expect(await createToken(null, form({ ...base, ownerId: 'u_service', storeIds: [] }))).toEqual({ error: t.tokens.errors.owner });
    await q(`update users set disabled = true where id = 'u_service'`);
    current = viewer('u_admin', 'admin');
    expect(await createToken(null, form({ ...base, ownerId: 'u_service', storeIds: [] }))).toEqual({ error: t.tokens.errors.owner });
    await q(`update users set disabled = false where id = 'u_service'`);
  });

  it('revokes a token of one’s own, or of a service user one created, and no other', async () => {
    const all = await tokens();
    const own = all.find((r) => r.user_id === 'u_member')!;
    const service = all.find((r) => r.user_id === 'u_service')!;
    const revokedAt = async (id: string) => (await q(`select revoked_at from api_tokens where id = $1`, [id])).rows[0].revoked_at;

    current = viewer('u_member', 'member', ['store_A']);
    await revokeToken(form({ tokenId: service.id })); // someone else's
    expect(await revokedAt(service.id)).toBeNull();
    await revokeToken(form({ tokenId: own.id }));
    expect(await revokedAt(own.id)).toBeInstanceOf(Date);

    await q(`insert into users (id, email, name, role) values ('u_admin2', 'a2@t.local', 'a2', 'admin')`);
    current = viewer('u_admin2', 'admin'); // an admin who did not create u_service
    await revokeToken(form({ tokenId: service.id }));
    expect(await revokedAt(service.id)).toBeNull();
    current = viewer('u_admin', 'admin');
    await revokeToken(form({ tokenId: service.id }));
    expect(await revokedAt(service.id)).toBeInstanceOf(Date);
  });
});
