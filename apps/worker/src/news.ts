// RSS refresh (spec §1 "Sources"): the global briefing.build fetches the enabled feeds right before it
// builds section 5, once a day, so news is fresh at 06:30 and feeds see one request a day each. Each feed
// has its own timeout and error; a failed feed keeps the items it had.
import { FEED_TIMEOUT_SECONDS } from '@ideas-hub/core';
import { newsFeeds, newsItems } from '@ideas-hub/db';
import { type FetchOptions, fetchFeeds } from '@ideas-hub/rss';
import { eq, sql } from 'drizzle-orm';
import { type Ctx } from './context';

// validateSettings counts this timeout in the briefing job's expiry.
export const FEED_TIMEOUT_MS = FEED_TIMEOUT_SECONDS * 1000;

export async function refreshFeeds(ctx: Pick<Ctx, 'db' | 'clock' | 'log'>, o: Partial<FetchOptions> = {}) {
  const feeds = await ctx.db.select({ id: newsFeeds.id, url: newsFeeds.url }).from(newsFeeds).where(eq(newsFeeds.enabled, true));
  const results = await fetchFeeds(feeds, { timeoutMs: FEED_TIMEOUT_MS, ...o });
  const now = ctx.clock.now();
  let items = 0;
  let failed = 0;
  for (const r of results) {
    if (r.error !== undefined) {
      failed += 1;
      ctx.log('feed failed', { url: r.feed.url, error: r.error });
      continue;
    }
    // One row per link, or the upsert would touch the same row twice.
    const unique = [...new Map(r.items.map((it) => [it.link, it])).values()];
    if (unique.length === 0) continue;
    await ctx.db
      .insert(newsItems)
      .values(unique.map((it) => ({ feedId: r.feed.id, title: it.title, link: it.link, publishedAt: it.publishedAt, summary: it.summary, createdAt: now })))
      .onConflictDoUpdate({
        target: [newsItems.feedId, newsItems.link],
        set: { title: sql`excluded.title`, publishedAt: sql`excluded.published_at`, summary: sql`excluded.summary` },
      });
    items += unique.length;
  }
  return { feeds: feeds.length, failed, items };
}
