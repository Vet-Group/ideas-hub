// A store's tracked keywords (spec §4 `keywords` tick): list, add and remove. Every call checks the
// viewer's `keywords` tick on the store. Keyword text is shared, so a store never deletes a keyword row.
import { type Viewer, can } from '@ideas-hub/core';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { type Db } from '../client';
import { keywords, storeKeywords } from '../schema';

export type StoreKeywordRow = { id: string; text: string; origin: 'seed' | 'store'; active: boolean };

/** The store's tracked keywords; null without the `keywords` tick. */
export async function listStoreKeywords(db: Db, viewer: Viewer, storeId: string): Promise<StoreKeywordRow[] | null> {
  if (!can(viewer, storeId, 'keywords')) return null;
  return db
    .select({ id: keywords.id, text: keywords.text, origin: keywords.origin, active: keywords.active })
    .from(storeKeywords)
    .innerJoin(keywords, eq(keywords.id, storeKeywords.keywordId))
    .where(eq(storeKeywords.storeId, storeId))
    .orderBy(asc(keywords.text));
}

export type AddStoreKeywordResult = { ok: true } | { ok: false; reason: 'forbidden' | 'duplicate' | 'limit' };

/**
 * Tracks `text` (already trimmed and whitespace-collapsed) for the store. An existing keyword with the same
 * text (any case) is linked; otherwise a `store` keyword is created. A keyword that no store tracked any
 * more was switched off by `removeStoreKeyword`, so linking it again switches it back on. Creating or
 * switching one on is refused when `maxActive` keywords are already active (spec §1 "Keywords").
 */
export async function addStoreKeyword(db: Db, viewer: Viewer, storeId: string, text: string, maxActive: number): Promise<AddStoreKeywordResult> {
  if (!can(viewer, storeId, 'keywords')) return { ok: false, reason: 'forbidden' };
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: keywords.id, origin: keywords.origin, active: keywords.active })
      .from(keywords)
      .where(sql`lower(${keywords.text}) = lower(${text})`);
    const [actives] = await tx.select({ n: count() }).from(keywords).where(eq(keywords.active, true));
    const activeCount = actives!.n;
    let keywordId = existing?.id;
    if (existing) {
      const [tracked] = await tx.select({ n: count() }).from(storeKeywords).where(eq(storeKeywords.keywordId, existing.id));
      const revive = !existing.active && existing.origin === 'store' && tracked!.n === 0;
      if (revive) {
        if (activeCount >= maxActive) return { ok: false, reason: 'limit' };
        await tx.update(keywords).set({ active: true }).where(eq(keywords.id, existing.id));
      }
    } else {
      if (activeCount >= maxActive) return { ok: false, reason: 'limit' };
      const [created] = await tx.insert(keywords).values({ text, origin: 'store' }).onConflictDoNothing().returning({ id: keywords.id });
      // A concurrent add of the same text won the unique index: link that one.
      keywordId = created?.id ?? (await tx.select({ id: keywords.id }).from(keywords).where(sql`lower(${keywords.text}) = lower(${text})`))[0]!.id;
    }
    const linked = await tx.insert(storeKeywords).values({ storeId, keywordId: keywordId! }).onConflictDoNothing().returning({ k: storeKeywords.keywordId });
    return linked.length === 0 ? { ok: false, reason: 'duplicate' } : { ok: true };
  });
}

/**
 * Stops tracking for the store only. A `store` keyword that no store tracks after this is switched off, so
 * the crawler (which reads every active keyword) does not keep searching for nobody. False without the tick.
 */
export async function removeStoreKeyword(db: Db, viewer: Viewer, storeId: string, keywordId: string): Promise<boolean> {
  if (!can(viewer, storeId, 'keywords')) return false;
  await db.transaction(async (tx) => {
    const removed = await tx.delete(storeKeywords).where(and(eq(storeKeywords.storeId, storeId), eq(storeKeywords.keywordId, keywordId))).returning({ k: storeKeywords.keywordId });
    if (removed.length === 0) return;
    const [rest] = await tx.select({ n: count() }).from(storeKeywords).where(eq(storeKeywords.keywordId, keywordId));
    if (rest!.n === 0) await tx.update(keywords).set({ active: false }).where(and(eq(keywords.id, keywordId), eq(keywords.origin, 'store')));
  });
  return true;
}
