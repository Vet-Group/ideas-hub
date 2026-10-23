'use server';

import { addStoreKeyword, removeStoreKeyword } from '@ideas-hub/db/queries';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { keywordText } from '@/lib/keyword-text';
import { requireUser } from '@/lib/session';
import { loadSettings } from '@/lib/settings';

// The `keywords` tick on the posted store is checked inside the queries; a refusal looks like a missing page, as for admins.
export async function addTrackedKeyword(form: FormData) {
  const user = await requireUser();
  const text = keywordText.safeParse(form.get('text'));
  if (!text.success) redirect('/store-keywords?error=invalid');
  const r = await addStoreKeyword(db, user, String(form.get('storeId')), text.data, (await loadSettings()).maxKeywords);
  if (!r.ok) {
    if (r.reason === 'forbidden') notFound();
    redirect(`/store-keywords?error=${r.reason}`);
  }
  revalidatePath('/store-keywords');
}

export async function removeTrackedKeyword(form: FormData) {
  const user = await requireUser();
  if (!(await removeStoreKeyword(db, user, String(form.get('storeId')), String(form.get('keywordId'))))) notFound();
  revalidatePath('/store-keywords');
}
