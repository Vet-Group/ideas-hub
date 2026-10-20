'use server';

import { type SettingsProblem } from '@ideas-hub/core';
import { settings as settingsTable } from '@ideas-hub/db';
import { sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { now } from '@/lib/now';
import { type FieldError, parseSettingsForm } from '@/lib/settings-form';
import { requireAdmin } from '@/lib/session';

export type SaveResult = { ok: boolean; fieldErrors?: FieldError[]; problems?: SettingsProblem[] };

/** Saves every Setting after the field and cross-field checks; the worker applies it within a minute. */
export async function saveSettings(_prev: SaveResult | null, form: FormData): Promise<SaveResult> {
  const admin = await requireAdmin();
  const { settings, fieldErrors, problems } = parseSettingsForm((name) => {
    const v = form.get(name);
    return typeof v === 'string' ? v : null;
  });
  if (fieldErrors.length || problems.length) return { ok: false, fieldErrors, problems };
  const at = now();
  await db
    .insert(settingsTable)
    .values(
      Object.entries(settings).map(([key, value]) => ({
        key: key as keyof typeof settings,
        // An empty optional setting (proxy, browser profile) is JSON null; a bare null would be SQL NULL.
        value: value === null ? sql`'null'::jsonb` : value,
        updatedAt: at,
        updatedBy: admin.userId,
      })),
    )
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: sql`excluded.value`, updatedAt: sql`excluded.updated_at`, updatedBy: sql`excluded.updated_by` },
      // Only rows whose value changed get a new updated_at and updated_by.
      setWhere: sql`${settingsTable.value} is distinct from excluded.value`,
    });
  revalidatePath('/admin/settings');
  return { ok: true };
}
