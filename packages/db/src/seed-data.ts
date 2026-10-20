// Reference data loaded by `pnpm db:seed` (idempotent): the US holidays (spec §1 "Sources", edited by
// admin afterwards) and the default RSS feeds. A row admin deleted comes back on the next seed; disable a
// feed instead of deleting it.
import { readFileSync } from 'node:fs';
import { type Db } from './client';
import { holidays, newsFeeds } from './schema';

const json = <T>(name: string) => JSON.parse(readFileSync(new URL(`../seed/${name}`, import.meta.url), 'utf8')) as T;

export const SEED_HOLIDAYS = json<{ date: string; name: string }[]>('holidays-us.json');
export const SEED_FEEDS = json<string[]>('news-feeds.json');

export async function seedHolidays(db: Db): Promise<number> {
  return (await db.insert(holidays).values(SEED_HOLIDAYS).onConflictDoNothing().returning({ id: holidays.id })).length;
}

export async function seedFeeds(db: Db): Promise<number> {
  return (await db.insert(newsFeeds).values(SEED_FEEDS.map((url) => ({ url }))).onConflictDoNothing().returning({ id: newsFeeds.id })).length;
}
