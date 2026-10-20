import 'server-only';
import { type Viewer } from '@ideas-hub/core';
import { storeMembers } from '@ideas-hub/db';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { auth } from './auth';
import { db } from './db';

export interface CurrentUser extends Viewer {
  name: string;
  email: string;
}

/**
 * The signed-in user for server components and actions. It never extends the session (`disableRefresh`):
 * a full page load already did that in proxy.ts, which can write the cookie.
 */
export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  const s = await auth.api.getSession({ headers: await headers(), query: { disableRefresh: true } });
  if (!s || s.user.banned) return null;
  const rows = await db.select().from(storeMembers).where(eq(storeMembers.userId, s.user.id));
  return {
    userId: s.user.id,
    name: s.user.name,
    email: s.user.email,
    role: s.user.role === 'admin' ? 'admin' : 'member',
    memberships: rows.map((m) => ({ storeId: m.storeId, view: m.canView, save: m.canSave, keywords: m.canKeywords })),
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const u = await currentUser();
  if (!u) redirect('/login');
  return u;
}

/** Admin pages and actions: anyone else gets the same 404 as a missing page (spec §6 "No permission"). */
export async function requireAdmin(): Promise<CurrentUser> {
  const u = await requireUser();
  if (u.role !== 'admin') notFound();
  return u;
}
