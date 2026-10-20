'use server';

import { inScope, storeScope } from '@ideas-hub/core';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { requireUser } from '@/lib/session';
import { STORE_COOKIE } from '@/lib/store';

export async function selectStore(storeId: string) {
  const user = await requireUser();
  if (!inScope(storeScope(user), storeId)) return;
  (await cookies()).set(STORE_COOKIE, storeId, { path: '/', sameSite: 'lax', httpOnly: true, maxAge: 365 * 86_400 });
}

/** Ends the session (nextCookies() clears its cookie) and goes to the sign-in page. */
export async function signOut() {
  await auth.api.signOut({ headers: await headers() });
  redirect('/login');
}
