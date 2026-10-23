import { createDb, createPool } from '@ideas-hub/db/client';
import { createTestDatabase, testDatabaseAvailable } from '@ideas-hub/db/testing';
import { APIError } from 'better-auth/api';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/lib/strings.vi';

const tdb = testDatabaseAvailable() ? await createTestDatabase() : null;
const pools: ReturnType<typeof createPool>[] = [];
const changePassword = vi.fn();
const MAX_FAILURES = 10;

// The limiter's rows live in a disposable database.
vi.mock('@/lib/db', () => {
  const pool = createPool(tdb!.url);
  pools.push(pool);
  return { pool, db: createDb(pool) };
});
// Only the password change and the signed-in user are faked; e2e/auth.spec.ts covers the real flow.
vi.mock('@/lib/auth', () => ({ auth: { api: { changePassword: (...a: unknown[]) => changePassword(...a) } } }));
vi.mock('@/lib/session', () => ({ requireUser: async () => ({ userId: 'u1', email: 'Me@Test.local' }) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { to });
  },
}));

const form = (current: string, next = 'new-password-1', repeat = next) => {
  const f = new FormData();
  f.set('currentPassword', current);
  f.set('newPassword', next);
  f.set('repeatPassword', repeat);
  return f;
};

describe.skipIf(!tdb)('change-password action', async () => {
  const { changePassword: change } = await import('./actions');

  beforeEach(async () => {
    changePassword.mockReset().mockResolvedValue({});
    await pools[0]!.query('delete from login_failures');
  });

  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end()));
    await tdb?.drop();
  });

  it('returns a form error for a wrong current password', async () => {
    changePassword.mockRejectedValue(new APIError('BAD_REQUEST', { message: 'Invalid password' }));
    expect(await change(null, form('wrong'))).toEqual({ error: t.account.errors.wrongCurrent });
  });

  it.each([
    ['a new password shorter than 8 characters', form('old-password-1', 'short', 'short'), t.account.errors.tooShort],
    ['two new passwords that differ', form('old-password-1', 'new-password-1', 'new-password-2'), t.account.errors.mismatch],
    ['a new password equal to the current one', form('old-password-1', 'old-password-1'), t.account.errors.same],
    ['an empty current password', form(''), t.account.errors.required],
  ])('refuses %s without asking better-auth or counting an attempt', async (_name, f, error) => {
    expect(await change(null, f)).toEqual({ error });
    expect(changePassword).not.toHaveBeenCalled();
    expect((await pools[0]!.query('select 1 from login_failures')).rows).toEqual([]);
  });

  it('changes the password and ends the other sessions', async () => {
    await expect(change(null, form('old-password-1'))).rejects.toMatchObject({ to: '/account?changed=1' });
    expect(changePassword).toHaveBeenCalledWith({
      body: { currentPassword: 'old-password-1', newPassword: 'new-password-1', revokeOtherSessions: true },
      headers: expect.any(Headers),
    });
  });

  it(`refuses after ${MAX_FAILURES} wrong current passwords, even with the right one, without asking better-auth`, async () => {
    changePassword.mockRejectedValue(new APIError('BAD_REQUEST'));
    for (let i = 0; i < MAX_FAILURES; i++) expect(await change(null, form('wrong'))).toEqual({ error: t.account.errors.wrongCurrent });
    changePassword.mockResolvedValue({});
    expect(await change(null, form('old-password-1'))).toEqual({ error: t.login.tooMany });
    expect(changePassword).toHaveBeenCalledTimes(MAX_FAILURES);
  });

  it('counts on the same email key as sign-in, so wrong guesses here also block sign-in', async () => {
    changePassword.mockRejectedValue(new APIError('BAD_REQUEST'));
    await change(null, form('wrong'));
    expect((await pools[0]!.query('select key, count from login_failures')).rows).toEqual([{ key: 'email:me@test.local', count: 1 }]);
  });

  it('a successful change clears the email key', async () => {
    changePassword.mockRejectedValueOnce(new APIError('BAD_REQUEST'));
    await change(null, form('wrong'));
    await expect(change(null, form('old-password-1'))).rejects.toMatchObject({ to: '/account?changed=1' });
    expect((await pools[0]!.query('select 1 from login_failures')).rows).toEqual([]);
  });
});
