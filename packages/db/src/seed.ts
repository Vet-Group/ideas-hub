// pnpm db:seed: the seed keywords (seed/seed-keywords.json, the Vietmakers draft list), the US holidays
// and the default RSS feeds (seed-data.ts). Idempotent.
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { createDb, createPool, databaseUrl } from './client';
import { SEED_FEEDS, SEED_HOLIDAYS, seedFeeds, seedHolidays } from './seed-data';

const keywords = JSON.parse(readFileSync(new URL('../seed/seed-keywords.json', import.meta.url), 'utf8')) as string[];
const pool = createPool(databaseUrl(), 1);
const db = createDb(pool);
let added = 0;
for (const [i, text] of keywords.entries()) {
  // created_at keeps the list order, which the budget rotation follows.
  const { rows } = await db.execute(sql`
    insert into keywords (id, text, origin, created_at)
    values (${`kw_seed${String(i).padStart(3, '0')}`}, ${text}, 'seed', ${new Date(Date.UTC(2026, 9, 20, 0, 0, i))})
    on conflict do nothing returning id`);
  added += rows.length;
}
console.log(`seed keywords: ${added} added, ${keywords.length - added} already there`);
const holidays = await seedHolidays(db);
console.log(`holidays: ${holidays} added, ${SEED_HOLIDAYS.length - holidays} already there`);
const feeds = await seedFeeds(db);
console.log(`news feeds: ${feeds} added, ${SEED_FEEDS.length - feeds} already there`);
await pool.end();
