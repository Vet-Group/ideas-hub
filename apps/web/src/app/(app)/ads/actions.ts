'use server';

import { storeScope } from '@ideas-hub/core';
import { getAd, savedRefs } from '@ideas-hub/db/queries';
import { db } from '@/lib/db';
import { statusOptions } from '@/lib/settings';
import { saveTargets } from '@/lib/store';
import { thumbUrl } from '@/lib/thumb-url';
import { requireUser } from '@/lib/session';

/**
 * One ad's detail pane data, so a card opens its pane without rendering the page again (and losing the
 * scroll). Data, not JSX: the pane's client components are in the client manifest of /ads only.
 */
export async function adPane(adArchiveId: string) {
  const user = await requireUser();
  const [ad, stores] = await Promise.all([getAd(db, await statusOptions(), adArchiveId), saveTargets(user)]);
  if (!ad) return null;
  const saved = await savedRefs(db, storeScope(user), 'ad', [ad.adArchiveId]);
  return { ad, thumbSrc: ad.thumbnailKey ? thumbUrl(ad.thumbnailKey) : null, saveStores: stores, saved: saved.length > 0 };
}
