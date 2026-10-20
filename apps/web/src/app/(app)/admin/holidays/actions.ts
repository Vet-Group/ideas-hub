'use server';

import { holidays } from '@ideas-hub/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

export async function addHoliday(form: FormData) {
  await requireAdmin();
  const v = z.object({ date: z.iso.date(), name: z.string().trim().min(1) }).parse(Object.fromEntries(form));
  await db.insert(holidays).values(v).onConflictDoNothing();
  revalidatePath('/admin/holidays');
}

export async function deleteHoliday(form: FormData) {
  await requireAdmin();
  await db.delete(holidays).where(eq(holidays.id, String(form.get('id'))));
  revalidatePath('/admin/holidays');
}
