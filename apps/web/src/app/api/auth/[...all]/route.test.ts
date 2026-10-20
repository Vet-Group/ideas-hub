import { createDb, createPool } from '@ideas-hub/db/client';
import { createTestDatabase, testDatabaseAvailable } from '@ideas-hub/db/testing';
import { afterAll, describe, expect, it, vi } from 'vitest';

const tdb = testDatabaseAvailable() ? await createTestDatabase() : null;
const pools: ReturnType<typeof createPool>[] = [];

// better-auth's own tables, rate-limit rows included, in a disposable database.
vi.mock('@/lib/db', () => {
  const pool = createPool(tdb!.url);
  pools.push(pool);
  return { pool, db: createDb(pool) };
});

const APP = 'http://localhost:3300';

describe.skipIf(!tdb)('POST /api/auth/sign-in/email rate limit', async () => {
  const { POST } = await import('./route');
  const signIn = (ip: string, xff?: string) =>
    POST(
      new Request(`${APP}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: APP, 'cf-connecting-ip': ip, ...(xff ? { 'x-forwarded-for': xff } : {}) },
        body: JSON.stringify({ email: 'nobody@test.local', password: 'wrong-password-1' }),
      }),
    );

  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end()));
    await tdb?.drop();
  });

  it('refuses a 4th sign-in within 10 s from one client IP, outside production too, and keeps the count in Postgres', async () => {
    expect(process.env.NODE_ENV).not.toBe('production');
    for (let i = 0; i < 3; i++) expect((await signIn('203.0.113.20')).status).toBe(401);
    expect((await signIn('203.0.113.20')).status).toBe(429);
    const { rows } = await pools[0]!.query<{ key: string; count: number }>('select key, count from rate_limits');
    expect(rows).toEqual([{ key: '203.0.113.20|/sign-in/email', count: 3 }]);
  });

  it('keys the limit on the trusted proxy header, not on x-forwarded-for', async () => {
    for (let i = 0; i < 3; i++) expect((await signIn('203.0.113.21', `192.0.2.${i}`)).status).toBe(401);
    expect((await signIn('203.0.113.21', '192.0.2.99')).status).toBe(429);
    expect((await signIn('203.0.113.22', '192.0.2.99')).status).toBe(401);
  });
});
