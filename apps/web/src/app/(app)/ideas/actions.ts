'use server';

import { type IdeaStatus, IdeaAccessError, getAd, lastSaveStoreIds, saveIdea, setIdeaStatus, suggestionForViewer, updateIdea } from '@ideas-hub/db/queries';
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
export type SaveSource = { kind: 'ad'; adArchiveId: string; via: 'ads' | 'briefing'; keyword?: string } | { kind: 'suggestion'; suggestionId: string };

type NewIdea = Parameters<typeof saveIdea>[3];

async function adIdea(source: Extract<SaveSource, { kind: 'ad' }>): Promise<NewIdea | null> {
  const ad = await getAd(db, await statusOptions(), source.adArchiveId);
  if (!ad) return null;
  return {
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
      keyword: source.keyword ?? ad.keywords[0]?.text ?? null,
      trendScore: ad.trendScore,
      mediaType: ad.mediaType,
    },
  };
}

/** An AI suggestion, only when the user may see it: a keyword report's AI sections follow §4 (AC 4). */
async function suggestionIdea(user: Awaited<ReturnType<typeof requireUser>>, suggestionId: string): Promise<NewIdea | null> {
  const s = await suggestionForViewer(db, user, suggestionId);
  if (!s) return null;
  return {
    source: 'suggestion',
    sourceRef: s.id,
    via: 'briefing',
    title: s.text.replace(/\s+/g, ' ').trim().slice(0, 140),
    snapshot: { kind: s.kind, text: s.text, reason: s.reason, evidence: s.evidence, keyword: s.keyword },
  };
}

export type SaveOutcome =
  | { ok: true; results: { storeId: string; storeName: string; ideaId: string; created: boolean }[] }
  | { ok: false; error: string };

export async function saveAction(source: SaveSource, storeIds: string[]): Promise<SaveOutcome> {
  const user = await requireUser();
  if (storeIds.length === 0) return { ok: false, error: t.save.noStore };
  const idea = source.kind === 'ad' ? await adIdea(source) : await suggestionIdea(user, source.suggestionId);
  if (!idea) return { ok: false, error: t.save.failed };
  try {
    const results = await saveIdea(db, user, storeIds, idea, now());
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
