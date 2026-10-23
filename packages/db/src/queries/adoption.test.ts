import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, createDb, createPool } from '../client';
import { createTestDatabase, testDatabaseAvailable } from '../testing';
import { PILOT_RUN_START, storeAdoption, userAdoption } from './adoption';

const after = new Date(PILOT_RUN_START.getTime() + 3_600_000).toISOString();
const before = new Date(PILOT_RUN_START.getTime() - 3_600_000).toISOString();

describe.skipIf(!testDatabaseAvailable())('adoption queries (AC 6 counting)', () => {
  let drop: () => Promise<void>;
  let pool: ReturnType<typeof createPool>;
  let db: Db;
  let n = 0;
  const idea = (storeId: string, by: string, via: string, at: string) =>
    db.execute(sql`insert into saved_ideas (id, store_id, source, source_ref, via, title, created_by, created_at)
      values (${`idea_${++n}`}, ${storeId}, 'manual', ${`ref_${n}`}, ${via}, 'T', ${by}, ${at}::timestamptz)`);

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    pool = createPool(t.url, 3);
    db = createDb(pool);
    await db.execute(sql`insert into users (id, email, name, role) values
      ('u_admin', 'a@x.test', 'Admin', 'admin'), ('u_m1', 'm1@x.test', 'M1', 'member'), ('u_m2', 'm2@x.test', 'M2', 'member')`);
    await db.execute(sql`insert into stores (id, name) values ('s_A', 'A'), ('s_B', 'B'), ('s_C', 'C')`);
    // m1: one idea saved to A and B counts once in each; the others must not count.
    await idea('s_A', 'u_m1', 'briefing', after);
    await idea('s_B', 'u_m1', 'briefing', after);
    await idea('s_A', 'u_m1', 'ads', after); // via != briefing
    await idea('s_A', 'u_m1', 'briefing', before); // before the pilot start
    await idea('s_A', 'u_admin', 'briefing', after); // admin-created
    await idea('s_A', 'u_m2', 'briefing', after);
    await db.execute(sql`insert into sessions (id, user_id, token, expires_at, created_at, updated_at) values
      ('sess_1', 'u_m1', 't1', now() + interval '1 day', '2026-10-23T01:00:00Z', '2026-10-24T02:00:00Z'),
      ('sess_2', 'u_m1', 't2', now() + interval '1 day', '2026-10-25T03:00:00Z', '2026-10-22T00:00:00Z')`);
  }, 60_000);
  afterAll(async () => {
    await pool?.end();
    await drop?.();
  });

  it('counts per user: briefing, non-admin, since the pilot start; admins show 0', async () => {
    const by = Object.fromEntries((await userAdoption(db)).map((r) => [r.userId, r.ideas]));
    expect(by).toEqual({ u_admin: 0, u_m1: 2, u_m2: 1 });
  });

  it('last activity is the latest session created/updated time, null without a session', async () => {
    const by = Object.fromEntries((await userAdoption(db)).map((r) => [r.userId, r.lastActiveAt]));
    expect(by.u_m1).toEqual(new Date('2026-10-25T03:00:00Z'));
    expect(by.u_m2).toBeNull();
  });

  it('counts per store row, one save to two stores once in each, zero stores kept', async () => {
    expect(await storeAdoption(db)).toEqual([
      { storeId: 's_A', name: 'A', ideas: 2 },
      { storeId: 's_B', name: 'B', ideas: 1 },
      { storeId: 's_C', name: 'C', ideas: 0 },
    ]);
  });
});
