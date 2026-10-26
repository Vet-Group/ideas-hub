'use server';

import { storeScope } from '@ideas-hub/core';
import { getAd, savedRefs } from '@ideas-hub/db/queries';
import { DetailPane } from '@/components/ads/detail-pane';
import { db } from '@/lib/db';
import { statusOptions } from '@/lib/settings';
import { saveTargets } from '@/lib/store';
import { requireUser } from '@/lib/session';

/** One ad's detail pane, so a card opens it without rendering the grid again (and losing the scroll). */
export async function adPane(adArchiveId: string) {
  const user = await requireUser();
  const [ad, stores] = await Promise.all([getAd(db, await statusOptions(), adArchiveId), saveTargets(user)]);
  if (!ad) return null;
  const saved = await savedRefs(db, storeScope(user), 'ad', [ad.adArchiveId]);
  return <DetailPane ad={ad} saveStores={stores} saved={saved.length > 0} />;
}
