'use server';

import { type IdeaStatus, IdeaAccessError, getAd, lastSaveStoreIds, saveIdea, setIdeaStatus, updateIdea } from '@ideas-hub/db/queries';
import { stores } from '@ideas-hub/db';
import { inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { undoIdeas } from '@/lib/ideas-server';
import { now } from '@/lib/now';
import { requireUser } from '@/lib/session';
import { statusOptions } from '@/lib/settings';
import { t } from '@/lib/strings.vi';

/** What is saved; the server builds the title and snapshot from its own data, never from the client. */
export type SaveSource = { kind: 'ad'; adArchiveId: string; via: 'ads' | 'briefing'; keyword?: string };

export type SaveOutcome =
  | { ok: true; results: { storeId: string; storeName: string; ideaId: string; created: boolean }[] }
  | { ok: false; error: string };

export async function saveAction(source: SaveSource, storeIds: string[]): Promise<SaveOutcome> {
  const user = await requireUser();
  if (storeIds.length === 0) return { ok: false, error: t.save.noStore };
  const ad = await getAd(db, await statusOptions(), source.adArchiveId);
  if (!ad) return { ok: false, error: t.save.failed };
  const keyword = source.keyword ?? ad.keywords[0]?.text ?? null;
  try {
    const results = await saveIdea(
      db,
      user,
      storeIds,
      {
        source: 'ad',
        sourceRef: ad.adArchiveId,
        via: source.via,
        title: (ad.caption ?? ad.title ?? ad.pageName ?? ad.adArchiveId).replace(/\s+/g, ' ').trim().slice(0, 140),
        snapshot: {
          thumbnailKey: ad.thumbnailKey,
          caption: ad.caption,
          link: ad.link,
          adLibraryUrl: `https://www.facebook.com/ads/library/?id=${ad.adArchiveId}`,
          pageName: ad.pageName,
          landingDomain: ad.landingDomain,
          keyword,
          trendScore: ad.trendScore,
          mediaType: ad.mediaType,
        },
      },
      now(),
    );
    const names = new Map((await db.select({ id: stores.id, name: stores.name }).from(stores).where(inArray(stores.id, storeIds))).map((s) => [s.id, s.name]));
    revalidatePath('/ideas');
    return { ok: true, results: results.map((r) => ({ ...r, storeName: names.get(r.storeId) ?? r.storeId })) };
  } catch (e) {
    if (e instanceof IdeaAccessError) return { ok: false, error: t.save.failed };
    throw e;
  }
}

/** "Hoàn tác": deletes only the ideas this save created, up to 15 s after it. */
export async function undoAction(ideaIds: string[]): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const r = await undoIdeas(user, ideaIds);
  revalidatePath('/ideas');
  return r.ok ? { ok: true } : { ok: false, error: t.save.expired };
}

export async function lastStoresAction(): Promise<string[]> {
  const user = await requireUser();
  return lastSaveStoreIds(db, user.userId);
}

export async function setStatusAction(ideaId: string, status: IdeaStatus): Promise<boolean> {
  const user = await requireUser();
  const ok = await setIdeaStatus(db, user, ideaId, status, now());
  if (ok) revalidatePath('/ideas');
  return ok;
}

export async function updateIdeaAction(ideaId: string, patch: { notes?: string | null; tags?: string[]; assigneeId?: string | null }): Promise<boolean> {
  const user = await requireUser();
  const ok = await updateIdea(db, user, ideaId, patch, now());
  if (ok) revalidatePath('/ideas');
  return ok;
}
