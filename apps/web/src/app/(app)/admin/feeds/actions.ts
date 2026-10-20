'use server';

import { newsFeeds } from '@ideas-hub/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

export async function addFeed(form: FormData) {
  await requireAdmin();
  const url = z.url({ protocol: /^https?$/ }).parse(String(form.get('url')).trim());
  await db.insert(newsFeeds).values({ url }).onConflictDoNothing();
  revalidatePath('/admin/feeds');
}

export async function setFeedEnabled(form: FormData) {
  await requireAdmin();
  await db.update(newsFeeds).set({ enabled: form.get('enabled') === '1' }).where(eq(newsFeeds.id, String(form.get('id'))));
  revalidatePath('/admin/feeds');
}
