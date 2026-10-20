import 'server-only';
import { DEFAULT_SETTINGS, type Settings, pacificDate } from '@ideas-hub/core';
import { settings as settingsTable } from '@ideas-hub/db';
import { type StatusOptions } from '@ideas-hub/db/queries';
import { db } from './db';
import { now } from './now';

/** Stored settings over the defaults, as the worker reads them. */
export async function loadSettings(): Promise<Settings> {
  const rows = await db.select().from(settingsTable);
  return { ...(DEFAULT_SETTINGS as unknown as Settings), ...Object.fromEntries(rows.map((r) => [r.key, r.value])) } as Settings;
}

/** What the ad status rule needs: today's Pacific crawl day and the settings it reads. */
export async function statusOptions(s?: Settings): Promise<StatusOptions> {
  const settings = s ?? (await loadSettings());
  return { today: pacificDate(now()), staleAfterDays: settings.staleAfterDays, countries: settings.countries };
}
