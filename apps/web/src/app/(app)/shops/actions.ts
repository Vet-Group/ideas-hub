'use server';

import { isNonShopDomain } from '@ideas-hub/core';
import { followShop, unfollowShop } from '@ideas-hub/db/queries';
import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { now } from '@/lib/now';
import { requireUser } from '@/lib/session';
import { loadSettings } from '@/lib/settings';

// The `save` tick on the posted store is checked inside the queries; a refusal looks like a missing page, as for tracked keywords.
export async function toggleShopFollow(form: FormData) {
  const user = await requireUser();
  const storeId = String(form.get('storeId'));
  const domain = String(form.get('domain'));
  if (isNonShopDomain(domain, (await loadSettings()).nonShopDomains)) notFound();
  const ok = form.get('follow') === '1' ? await followShop(db, user, storeId, domain, now()) : await unfollowShop(db, user, storeId, domain);
  if (!ok) notFound();
  revalidatePath('/shops', 'layout');
}
