import { APIError } from 'better-auth/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_FAILURES, clearFailures } from '@/lib/login-limit';
import { t } from '@/lib/strings.vi';

const signInEmail = vi.fn();
let ip = '203.0.113.7';
vi.mock('@/lib/auth', () => ({ auth: { api: { signInEmail: (...a: unknown[]) => signInEmail(...a) } } }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': `${ip}, 10.0.0.1` }) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { to });
  },
}));

const { signIn } = await import('./actions');
const form = (email: string) => {
  const f = new FormData();
  f.set('email', email);
  f.set('password', 'wrong');
  return f;
};

describe('sign-in action rate limit', () => {
  beforeEach(() => {
    signInEmail.mockReset().mockRejectedValue(new APIError('UNAUTHORIZED'));
    ip = '203.0.113.7';
    clearFailures(['ip:203.0.113.7', 'ip:198.51.100.9', 'email:a@test.local', 'email:b@test.local']);
  });

  it(`refuses a client IP after ${MAX_FAILURES} failed sign-ins without asking better-auth`, async () => {
    for (let i = 0; i < MAX_FAILURES; i++) expect(await signIn(null, form(`u${i}@test.local`))).toEqual({ error: t.login.failed });
    expect(await signIn(null, form('b@test.local'))).toEqual({ error: t.login.tooMany });
    expect(signInEmail).toHaveBeenCalledTimes(MAX_FAILURES);
  });

  it(`refuses an email after ${MAX_FAILURES} failed sign-ins from any IP, even with the right password`, async () => {
    for (let i = 0; i < MAX_FAILURES; i++) {
      ip = `198.51.100.${i}`;
      await signIn(null, form('A@test.local'));
    }
    ip = '198.51.100.9';
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
});
