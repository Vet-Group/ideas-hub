'use server';

import { storeMembers, stores } from '@ideas-hub/db';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

const optional = z
  .string()
  .trim()
  .transform((v) => v || null);

export async function createStore(form: FormData) {
  await requireAdmin();
  const name = z.string().trim().min(1).parse(form.get('name'));
  const [row] = await db.insert(stores).values({ name }).returning({ id: stores.id });
  redirect(`/admin/stores/${row!.id}`);
}

export async function updateStore(form: FormData) {
  await requireAdmin();
  const v = z
    .object({ id: z.string(), name: z.string().trim().min(1), erpStoreCode: optional, podStudioStoreId: optional, larkChatId: optional })
    .parse(Object.fromEntries(form));
  await db.update(stores).set({ name: v.name, erpStoreCode: v.erpStoreCode, podStudioStoreId: v.podStudioStoreId, larkChatId: v.larkChatId }).where(eq(stores.id, v.id));
  revalidatePath(`/admin/stores/${v.id}`);
}

/** Saves the ticks of one member; `save` and `keywords` imply `view` (packages/core access.ts). */
export async function setMember(form: FormData) {
  await requireAdmin();
  const storeId = String(form.get('storeId'));
  const userId = String(form.get('userId'));
  const canSave = form.get('save') === 'on';
  const canKeywords = form.get('keywords') === 'on';
  const canView = form.get('view') === 'on' || canSave || canKeywords;
  await db
    .insert(storeMembers)
    .values({ storeId, userId, canView, canSave, canKeywords })
    .onConflictDoUpdate({ target: [storeMembers.storeId, storeMembers.userId], set: { canView, canSave, canKeywords } });
  revalidatePath(`/admin/stores/${storeId}`);
}

export async function removeMember(form: FormData) {
  await requireAdmin();
  const storeId = String(form.get('storeId'));
  await db.delete(storeMembers).where(and(eq(storeMembers.storeId, storeId), eq(storeMembers.userId, String(form.get('userId')))));
  revalidatePath(`/admin/stores/${storeId}`);
}
