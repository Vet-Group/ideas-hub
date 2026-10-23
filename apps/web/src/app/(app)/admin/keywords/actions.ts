'use server';

import { keywords } from '@ideas-hub/db';
import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { keywordText } from '@/lib/keyword-text';
import { requireAdmin } from '@/lib/session';

export async function addSeedKeyword(form: FormData) {
  await requireAdmin();
  const text = keywordText.parse(form.get('text'));
  // keywords_text_key is unique on lower(text).
  const inserted = await db.execute(sql`insert into keywords (id, text, origin) values (${`kw_${crypto.randomUUID().replace(/-/g, '').slice(0, 21)}`}, ${text}, 'seed') on conflict do nothing returning id`);
  if (inserted.rows.length === 0) redirect('/admin/keywords?error=duplicate');
  revalidatePath('/admin/keywords');
}

export async function setKeywordActive(form: FormData) {
  await requireAdmin();
  await db.update(keywords).set({ active: form.get('active') === '1' }).where(eq(keywords.id, String(form.get('id'))));
  revalidatePath('/admin/keywords');
}
