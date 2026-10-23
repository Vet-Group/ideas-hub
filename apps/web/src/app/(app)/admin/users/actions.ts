'use server';

import { users } from '@ideas-hub/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

const NewUser = z.object({
  name: z.string().trim().min(1),
  email: z.email().trim().toLowerCase(),
  role: z.enum(['admin', 'member']),
  password: z.string().min(8),
});

export async function createUser(form: FormData) {
  const me = await requireAdmin();
  const body = NewUser.parse(Object.fromEntries(form));
  // The admin plugin's createUser: sign-up stays disabled for everyone else.
  const { user } = await auth.api.createUser({ body, headers: await headers() });
  // Only the creating admin may issue API tokens for this account (contract `ideas-hub-v1.md` section 3).
  await db.update(users).set({ createdBy: me.userId }).where(eq(users.id, user.id));
  revalidatePath('/admin/users');
}

/** Disabling bans the user in better-auth, which also deletes their sessions. */
export async function setDisabled(form: FormData) {
  const me = await requireAdmin();
  const userId = String(form.get('userId'));
  if (userId === me.userId) return;
  const h = await headers();
  if (form.get('disabled') === '1') await auth.api.banUser({ body: { userId }, headers: h });
  else await auth.api.unbanUser({ body: { userId }, headers: h });
  revalidatePath('/admin/users');
}
