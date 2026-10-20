// pnpm db:seed: the seed keywords (seed/seed-keywords.json, the Vietmakers draft list). Idempotent.
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { createDb, createPool, databaseUrl } from './client';

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
await pool.end();
