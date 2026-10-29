// RSS refresh (spec §1 "Sources"): the global briefing.build fetches the enabled feeds right before it
// builds section 5, once a day, so news is fresh at 06:30 and feeds see one request a day each. Each feed
// has its own timeout and error; a failed feed keeps the items it had.
import { FEED_TIMEOUT_SECONDS } from '@ideas-hub/core';
import { newsFeeds, newsItems } from '@ideas-hub/db';
import { type FeedItem, type FeedResult, type FetchOptions, ITEMS_PER_FEED, fetchFeeds } from '@ideas-hub/rss';
import { eq, sql } from 'drizzle-orm';
import { type Ctx } from './context';

// validateSettings counts this timeout in the briefing job's expiry.
export const FEED_TIMEOUT_MS = FEED_TIMEOUT_SECONDS * 1000;

type Feed = { id: string; url: string };

const parse = (url: string) => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};
const isAlgolia = (url: string) => parse(url)?.hostname === 'hn.algolia.com';
const isTrendsPage = (url: string) => {
  const u = parse(url);
  return u?.hostname === 'trends.google.com' && u.pathname.startsWith('/trending/rss');
};
// Links are third-party input: keep only http(s) and what fits the (feed_id, link) btree index.
const isSafeLink = (link: string) => link.length <= 2000 && /^https?:\/\//i.test(link);

/** Algolia's search_by_date JSON for Hacker News: title, the story's url (or its HN page) and created_at. */
async function fetchAlgolia(feed: Feed, o: FetchOptions): Promise<FeedResult<Feed>> {
  try {
    const signal = o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(o.timeoutMs)]) : AbortSignal.timeout(o.timeoutMs);
    const res = await (o.fetch ?? fetch)(feed.url, { signal, headers: { 'user-agent': 'IdeasHub/1.0 (RSS reader)', accept: 'application/json' } });
    if (!res.ok) throw new Error(`feed ${feed.url} returned HTTP ${res.status}`);
    const { hits } = (await res.json()) as { hits: { title?: string | null; url?: string | null; created_at?: string | null; objectID: string }[] };
    const items: FeedItem[] = [];
    for (const h of hits) {
      const title = h.title?.replace(/\s+/g, ' ').trim();
      if (!title) continue;
      const date = h.created_at ? new Date(h.created_at) : null;
      items.push({ title: title.slice(0, 500), link: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, publishedAt: date && !Number.isNaN(date.getTime()) ? date : null, summary: null });
    }
    return { feed, items: items.slice(0, ITEMS_PER_FEED) };
  } catch (e) {
    return { feed, error: String(e) };
  }
}

/** Google Trends items all link to the feed itself; give each its own explore page so the (feed_id, link) dedupe keeps them. */
const trendsLink = (title: string, geo: string) => `https://trends.google.com/trends/explore?q=${encodeURIComponent(title)}&geo=${encodeURIComponent(geo)}`;

async function fetchAll(feeds: Feed[], o: FetchOptions): Promise<FeedResult<Feed>[]> {
  const [json, xml] = [feeds.filter((f) => isAlgolia(f.url)), feeds.filter((f) => !isAlgolia(f.url))];
  const [a, b] = await Promise.all([Promise.all(json.map((f) => fetchAlgolia(f, o))), fetchFeeds(xml, o)]);
  return [...a, ...b].map((r) => {
    if (r.error !== undefined) return r;
    const geo = isTrendsPage(r.feed.url) ? (parse(r.feed.url)?.searchParams.get('geo') ?? 'US') : null;
    const items = r.items.map((it) => (geo !== null && isTrendsPage(it.link) ? { ...it, link: trendsLink(it.title, geo) } : it));
    return { ...r, items: items.filter((it) => isSafeLink(it.link)) };
  });
}

export async function refreshFeeds(ctx: Pick<Ctx, 'db' | 'clock' | 'log'>, o: Partial<FetchOptions> = {}) {
  const feeds = await ctx.db.select({ id: newsFeeds.id, url: newsFeeds.url }).from(newsFeeds).where(eq(newsFeeds.enabled, true));
  const results = await fetchAll(feeds, { timeoutMs: FEED_TIMEOUT_MS, ...o });
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
    try {
      await ctx.db
        .insert(newsItems)
        .values(unique.map((it) => ({ feedId: r.feed.id, title: it.title, link: it.link, publishedAt: it.publishedAt, summary: it.summary, createdAt: now })))
        .onConflictDoUpdate({
          target: [newsItems.feedId, newsItems.link],
          set: { title: sql`excluded.title`, publishedAt: sql`excluded.published_at`, summary: sql`excluded.summary` },
        });
      items += unique.length;
    } catch (e) {
      failed += 1;
      ctx.log('feed failed', { url: r.feed.url, error: String(e) });
    }
  }
  return { feeds: feeds.length, failed, items };
}
