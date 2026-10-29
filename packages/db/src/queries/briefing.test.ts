import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, createDb, createPool } from '../client';
import { createTestDatabase, testDatabaseAvailable } from '../testing';
import { briefingNews } from './briefing';

const AT = new Date('2026-10-28T23:30:00Z');

describe.skipIf(!testDatabaseAvailable())('briefingNews (section 5)', () => {
  let drop: () => Promise<void>;
  let pool: ReturnType<typeof createPool>;
  let db: Db;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    pool = createPool(t.url, 3);
    db = createDb(pool);
    await db.execute(sql`insert into news_feeds (id, url) values ('f_busy', 'https://www.busy.test/rss'), ('f_quiet', 'https://quiet.test/rss')`);
    // The busy feed has 8 items, all newer than the quiet feed's 2.
    for (let i = 0; i < 8; i++) {
      await db.execute(sql`insert into news_items (id, feed_id, title, link, published_at)
        values (${`busy_${i}`}, 'f_busy', ${`busy ${i}`}, ${`https://busy.test/${i}`}, ${new Date(AT.getTime() - (i + 1) * 3_600_000)})`);
    }
    for (let i = 0; i < 2; i++) {
      await db.execute(sql`insert into news_items (id, feed_id, title, link, published_at)
        values (${`quiet_${i}`}, 'f_quiet', ${`quiet ${i}`}, ${`https://quiet.test/${i}`}, ${new Date(AT.getTime() - (20 + i) * 3_600_000)})`);
    }
  }, 60_000);
  afterAll(async () => {
    await pool?.end();
    await drop?.();
  });

  it('takes at most 5 items per feed before the limit, newest first', async () => {
    const items = await briefingNews(db, AT);
    expect(items.map((i) => i.id)).toEqual(['busy_0', 'busy_1', 'busy_2', 'busy_3', 'busy_4', 'quiet_0', 'quiet_1']);
    expect(items.map((i) => i.feed)).toEqual(['busy.test', 'busy.test', 'busy.test', 'busy.test', 'busy.test', 'quiet.test', 'quiet.test']);
  });

  it('still applies the overall limit after the per-feed cap', async () => {
    expect((await briefingNews(db, AT, 72, 6)).map((i) => i.id)).toEqual(['busy_0', 'busy_1', 'busy_2', 'busy_3', 'busy_4', 'quiet_0']);
  });
});
