'use server';

import { APIError } from 'better-auth/api';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { safeCallback } from '@/lib/callback';
import { t } from '@/lib/strings.vi';

export async function signIn(_prev: unknown, form: FormData): Promise<{ error: string } | null> {
  try {
    // nextCookies() writes the session cookie from inside the action.
    await auth.api.signInEmail({ body: { email: String(form.get('email')), password: String(form.get('password')) }, headers: await headers() });
  } catch (e) {
    if (e instanceof APIError) return { error: e.status === 'FORBIDDEN' ? t.login.disabled : t.login.failed };
    throw e;
  }
  const origin = new URL(process.env.APP_URL ?? 'http://localhost:3300').origin;
  redirect(safeCallback(String(form.get('next') ?? ''), origin));
}
