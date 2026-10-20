// Seed data for the briefing tests: three mornings of the 01:00 slot crawled through the fake Ad Library
// for 3 keywords, two stores that track them (A with a Lark chat), one RSS feed with items, the US holidays.
import { vietnamInstant } from '@ideas-hub/core';
import { seedHolidays } from '@ideas-hub/db/seed-data';
import { sql } from 'drizzle-orm';
import { runCrawl } from '../src/run';
import { type Harness, fakeSite, insertRun, runDeps, seedKeywords, setSettings } from './helpers';

export const DAYS = ['2026-10-19', '2026-10-20', '2026-10-21'];
/** 06:30 Asia/Ho_Chi_Minh on the last day: the default build time. */
export const BUILD = vietnamInstant('2026-10-21', '06:30');
export const SHARED_CHAT = 'oc_shared';

export async function seedBriefingData(h: Harness) {
  await seedKeywords(h, 3);
  await setSettings(h, { countries: ['US', 'GB'] });
  for (const [i, day] of DAYS.entries()) {
    const slot = vietnamInstant(day, '01:00');
    h.clock.t = slot.getTime();
    const id = await insertRun(h, { id: `run_${day}`, scheduledFor: slot, deadline: new Date(slot.getTime() + 4 * 3_600_000) });
    const site = fakeSite((q, c) => ({ kind: 'ok', ids: Array.from({ length: q === 'k0' ? 2 + i * 2 : 1 }, (_, n) => (n === 0 ? `${q}-0` : `${q}-${n}-${c}`)), domain: (id) => (id.startsWith('k0') ? 'rising.com' : 'flat.com') }));
    await runCrawl(h, id, runDeps(h, site));
  }
  // The `-0` ads run long enough for a trend score (section 1); the others started recently (section 2).
  await h.db.execute(sql`update ads set start_date = case when ad_archive_id like '%-0' then '2026-09-01'::date else '2026-10-19'::date end`);
  await h.db.execute(sql`
    insert into users (id, email, name, role) values ('user_admin', 'admin@test', 'Admin', 'admin'), ('user_member', 'm@test', 'Member', 'member');
    insert into stores (id, name, lark_chat_id) values ('store_A', 'A', 'oc_storeA'), ('store_B', 'B', null);
    insert into store_keywords (store_id, keyword_id) values ('store_A', 'kw_0'), ('store_A', 'kw_1'), ('store_B', 'kw_2');
    insert into news_feeds (id, url) values ('feed_1', 'https://www.news.example.test/rss');
    insert into news_items (id, feed_id, title, link, published_at, summary) values
      ('news_1', 'feed_1', 'Holiday shopping starts early', 'https://news.example.test/1', '2026-10-20T10:00:00Z', 'Retail note'),
      ('news_old', 'feed_1', 'Old news', 'https://news.example.test/old', '2026-10-01T10:00:00Z', null)`);
  await seedHolidays(h.db);
  h.clock.t = BUILD.getTime();
}

/** Clears what a build wrote, so each test starts from sections 1–4 data only. */
export async function resetBriefings(h: Harness) {
  await h.db.execute(sql`truncate briefings, alerts cascade`);
  await h.db.execute(sql`delete from pgboss.job where name in ('briefing.build', 'lark.send')`);
  await h.db.execute(sql`delete from settings where key in ('aiDailyCostCapUsd', 'llmCallTimeoutSeconds', 'briefingBuildTime', 'larkSendTimeoutSeconds')`);
  h.clock.t = BUILD.getTime();
}
