'use server';

import { APIError, getIP } from 'better-auth/api';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { safeCallback } from '@/lib/callback';
import { clearFailures, takeAttempt } from '@/lib/login-limit';
import { t } from '@/lib/strings.vi';

export async function signIn(_prev: unknown, form: FormData): Promise<{ error: string } | null> {
  const h = await headers();
  const email = String(form.get('email'));
  // Only the trusted proxy headers of the auth config; without one every client shares the `unknown` bucket.
  const ip = getIP(h, auth.options) ?? 'unknown';
  const keys = [`ip:${ip}`, `email:${email.toLowerCase()}`];
  if (!(await takeAttempt(keys))) return { error: t.login.tooMany };
  try {
    // nextCookies() writes the session cookie from inside the action.
    await auth.api.signInEmail({ body: { email, password: String(form.get('password')) }, headers: h });
  } catch (e) {
    if (e instanceof APIError) {
      return { error: e.status === 'FORBIDDEN' ? t.login.disabled : t.login.failed };
    }
    throw e;
  }
  await clearFailures(keys);
  const origin = new URL(process.env.APP_URL ?? 'http://localhost:3300').origin;
  redirect(safeCallback(String(form.get('next') ?? ''), origin));
}
