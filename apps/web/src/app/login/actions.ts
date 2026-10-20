'use server';

import { APIError } from 'better-auth/api';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { safeCallback } from '@/lib/callback';
import { clearFailures, recordFailure, tooManyFailures } from '@/lib/login-limit';
import { t } from '@/lib/strings.vi';

export async function signIn(_prev: unknown, form: FormData): Promise<{ error: string } | null> {
  const h = await headers();
  const email = String(form.get('email'));
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const keys = [`ip:${ip}`, `email:${email.toLowerCase()}`];
  if (tooManyFailures(keys)) return { error: t.login.tooMany };
  try {
    // nextCookies() writes the session cookie from inside the action.
    await auth.api.signInEmail({ body: { email, password: String(form.get('password')) }, headers: h });
  } catch (e) {
    if (e instanceof APIError) {
      recordFailure(keys);
      return { error: e.status === 'FORBIDDEN' ? t.login.disabled : t.login.failed };
    }
    throw e;
  }
  clearFailures(keys);
  const origin = new URL(process.env.APP_URL ?? 'http://localhost:3300').origin;
  redirect(safeCallback(String(form.get('next') ?? ''), origin));
}
