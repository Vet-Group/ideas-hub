'use server';

import { inScope, storeScope } from '@ideas-hub/core';
import { cookies } from 'next/headers';
import { requireUser } from '@/lib/session';
import { STORE_COOKIE } from '@/lib/store';

export async function selectStore(storeId: string) {
  const user = await requireUser();
  if (!inScope(storeScope(user), storeId)) return;
  (await cookies()).set(STORE_COOKIE, storeId, { path: '/', sameSite: 'lax', httpOnly: true, maxAge: 365 * 86_400 });
}
