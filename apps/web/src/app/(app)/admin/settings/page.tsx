import { DEFAULT_SETTINGS, type Settings } from '@ideas-hub/core';
import { settings as settingsTable } from '@ideas-hub/db';
import { PageHeader } from '@/components/page-header';
import { db } from '@/lib/db';
import { FIELDS, fieldValue } from '@/lib/settings-form';
import { requireAdmin } from '@/lib/session';
import { t } from '@/lib/strings.vi';
import { SettingsForm } from './settings-form';

export default async function SettingsPage() {
  await requireAdmin();
  const rows = await db.select().from(settingsTable);
  const current = { ...(DEFAULT_SETTINGS as unknown as Settings), ...Object.fromEntries(rows.map((r) => [r.key, r.value])) } as Record<string, unknown>;
  const fields = FIELDS.map((f) => ({
    key: f.key,
    label: t.admin.settings.labels[f.key] ?? f.key,
    kind: f.kind,
    value: f.parts ? undefined : fieldValue(current[f.key]),
    parts: f.parts?.map((p) => ({ name: `${f.key}.${p}`, label: p, value: fieldValue(current[f.key], p) })),
  }));
  return (
    <>
      <PageHeader title={t.admin.settings.title} />
      <p className="text-fg-2 mb-3 text-[13px]">{t.admin.settings.hint}</p>
      <SettingsForm fields={fields} />
    </>
  );
}
