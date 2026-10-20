'use server';

import { alerts } from '@ideas-hub/db';
import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { now } from '@/lib/now';
import { requireAdmin } from '@/lib/session';

/** "Đã xử lý": sets resolved_at, which clears the crawler attention bar once none is left open. */
export async function resolveAlert(form: FormData) {
  await requireAdmin();
  await db
    .update(alerts)
    .set({ resolvedAt: now() })
    .where(and(eq(alerts.id, String(form.get('id'))), isNull(alerts.resolvedAt)));
  revalidatePath('/', 'layout');
}
