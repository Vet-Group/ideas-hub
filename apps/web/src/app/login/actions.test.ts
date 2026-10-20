import { createDb, createPool } from '@ideas-hub/db/client';
import { createTestDatabase, testDatabaseAvailable } from '@ideas-hub/db/testing';
import { APIError } from 'better-auth/api';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '@/lib/auth';
import { t } from '@/lib/strings.vi';

const tdb = testDatabaseAvailable() ? await createTestDatabase() : null;
const pools: ReturnType<typeof createPool>[] = [];
const signInEmail = vi.fn();
let reqHeaders: Record<string, string> = {};

// The limiter's rows live in a disposable database; a fresh import of '@/lib/db' is another server process.
vi.mock('@/lib/db', () => {
  const pool = createPool(tdb!.url);
  pools.push(pool);
  return { pool, db: createDb(pool) };
});
// The real auth config (trusted IP headers); only the password check is faked.
vi.mock('@/lib/auth', async (importOriginal) => {
  const { auth } = await importOriginal<typeof AuthModule>();
  return { auth: { ...auth, api: { ...auth.api, signInEmail: (...a: unknown[]) => signInEmail(...a) } } };
});
vi.mock('next/headers', () => ({ headers: async () => new Headers(reqHeaders) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { to });
  },
}));

const form = (email: string) => {
  const f = new FormData();
  f.set('email', email);
  f.set('password', 'wrong');
  return f;
};
const MAX_FAILURES = 10;

describe.skipIf(!tdb)('sign-in action rate limit', async () => {
  const { signIn } = await import('./actions');
  const from = (ip: string, extra: Record<string, string> = {}) => (reqHeaders = { 'cf-connecting-ip': ip, ...extra });

  beforeEach(async () => {
    signInEmail.mockReset().mockRejectedValue(new APIError('UNAUTHORIZED'));
    from('203.0.113.7');
    await pools[0]!.query('delete from login_failures');
  });

  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end()));
    await tdb?.drop();
  });

  it(`refuses a client IP after ${MAX_FAILURES} failed sign-ins without asking better-auth`, async () => {
    for (let i = 0; i < MAX_FAILURES; i++) expect(await signIn(null, form(`u${i}@test.local`))).toEqual({ error: t.login.failed });
    expect(await signIn(null, form('b@test.local'))).toEqual({ error: t.login.tooMany });
    expect(t.login.tooMany).toContain('Thử lại sau ít phút');
    expect(signInEmail).toHaveBeenCalledTimes(MAX_FAILURES);
  });

  it(`refuses an email after ${MAX_FAILURES} failed sign-ins from any IP, even with the right password`, async () => {
    for (let i = 0; i < MAX_FAILURES; i++) {
      from(`198.51.100.${i}`);
      await signIn(null, form('A@test.local'));
    }
    from('198.51.100.99');
    signInEmail.mockResolvedValue({});
    expect(await signIn(null, form('a@test.local'))).toEqual({ error: t.login.tooMany });
    expect(signInEmail).toHaveBeenCalledTimes(MAX_FAILURES);
  });

  it('a successful sign-in clears the failures of its IP and email', async () => {
    for (let i = 0; i < MAX_FAILURES - 1; i++) await signIn(null, form('a@test.local'));
    signInEmail.mockResolvedValue({});
    await expect(signIn(null, form('a@test.local'))).rejects.toMatchObject({ to: '/briefing' });
    signInEmail.mockRejectedValue(new APIError('UNAUTHORIZED'));
    expect(await signIn(null, form('a@test.local'))).toEqual({ error: t.login.failed });
  });

  it('reads the client IP from the trusted proxy header only: a rotating x-forwarded-for does not escape the limit', async () => {
    for (let i = 0; i < MAX_FAILURES; i++) {
      from('203.0.113.7', { 'x-forwarded-for': `192.0.2.${i}` });
      await signIn(null, form(`u${i}@test.local`));
    }
    from('203.0.113.7', { 'x-forwarded-for': '192.0.2.200' });
    expect(await signIn(null, form('b@test.local'))).toEqual({ error: t.login.tooMany });
    from('203.0.113.8', { 'x-forwarded-for': '192.0.2.200' });
    expect(await signIn(null, form('c@test.local'))).toEqual({ error: t.login.failed });
  });

  it('keeps the failures in Postgres, so another server process refuses too', async () => {
    for (let i = 0; i < MAX_FAILURES; i++) await signIn(null, form(`u${i}@test.local`));
    vi.resetModules();
    const other = await import('./actions');
    expect(await other.signIn(null, form('b@test.local'))).toEqual({ error: t.login.tooMany });
    expect(signInEmail).toHaveBeenCalledTimes(MAX_FAILURES);
  });

  it('frees a key after its 10 min window and prunes expired rows', async () => {
    const { takeAttempt } = await import('@/lib/login-limit');
    const t0 = new Date('2026-10-20T00:00:00Z');
    for (let i = 0; i < MAX_FAILURES; i++) expect(await takeAttempt(['ip:k'], t0)).toBe(true);
    expect(await takeAttempt(['ip:k'], new Date(t0.getTime() + 10 * 60_000 - 1))).toBe(false);
    const later = new Date(t0.getTime() + 10 * 60_000);
    expect(await takeAttempt(['ip:k'], later)).toBe(true);
    expect((await pools[0]!.query('select count from login_failures where key = $1', ['ip:k'])).rows).toEqual([{ count: 1 }]);
    await takeAttempt(['ip:other'], new Date(later.getTime() + 10 * 60_000));
    expect((await pools[0]!.query('select key from login_failures')).rows).toEqual([{ key: 'ip:other' }]);
  });

  it('concurrent attempts past the limit are refused: at most the limit reaches better-auth', async () => {
    const results = await Promise.all(Array.from({ length: MAX_FAILURES * 3 }, (_, i) => signIn(null, form(`p${i}@test.local`))));
    expect(signInEmail.mock.calls.length).toBeLessThanOrEqual(MAX_FAILURES);
    expect(results.filter((r) => r?.error === t.login.tooMany).length).toBeGreaterThanOrEqual(MAX_FAILURES * 2);
  });
});
