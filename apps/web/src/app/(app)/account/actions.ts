'use server';

import { APIError } from 'better-auth/api';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { clearFailures, takeAttempt } from '@/lib/login-limit';
import { requireUser } from '@/lib/session';
import { t } from '@/lib/strings.vi';

const s = t.account;
const ChangePassword = z
  .object({
    currentPassword: z.string().min(1, s.errors.required),
    newPassword: z.string().min(8, s.errors.tooShort),
    repeatPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.repeatPassword, { path: ['repeatPassword'], message: s.errors.mismatch })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ['newPassword'], message: s.errors.same });

/**
 * Changes the signed-in user's own password and ends their other sessions. better-auth replaces this one too
 * (new token, new cookie), so the action redirects: a plain return would re-render with the old, revoked cookie.
 */
export async function changePassword(_prev: unknown, form: FormData): Promise<{ error: string } | null> {
  const user = await requireUser();
  const parsed = ChangePassword.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  // Same bucket as sign-in's email key: a wrong current password is a password guess, so it counts there.
  const keys = [`email:${user.email.toLowerCase()}`];
  if (!(await takeAttempt(keys))) return { error: t.login.tooMany };
  try {
    await auth.api.changePassword({
      body: { currentPassword: parsed.data.currentPassword, newPassword: parsed.data.newPassword, revokeOtherSessions: true },
      headers: await headers(),
    });
  } catch (e) {
    if (e instanceof APIError) return { error: s.errors.wrongCurrent };
    throw e;
  }
  await clearFailures(keys);
  redirect('/account?changed=1');
}
