// RSS news source (spec §1 "Sources"): fetches a feed with a timeout and keeps the title, link, date and
// feed summary of each item; article bodies are never fetched or kept. Each feed fails on its own.
import Parser from 'rss-parser';

export interface FeedItem {
  title: string;
  link: string;
  publishedAt: Date | null;
  /** The feed's own summary, as plain text and clipped; never the article body. */
  summary: string | null;
}

export interface FetchOptions {
  fetch?: typeof fetch;
  timeoutMs: number;
  signal?: AbortSignal;
}

/** Newest items kept per feed and pass. */
export const ITEMS_PER_FEED = 30;
const SUMMARY_CHARS = 500;
const MAX_BYTES = 5_000_000;

const parser = new Parser();

/** Parses feed XML (RSS or Atom); items without a title or link are skipped. */
export async function parseFeed(xml: string): Promise<FeedItem[]> {
  const feed = await parser.parseString(xml);
  const items: FeedItem[] = [];
  for (const it of feed.items) {
    const title = it.title?.replace(/\s+/g, ' ').trim();
    const link = it.link?.trim();
    if (!title || !link) continue;
    const date = it.isoDate ? new Date(it.isoDate) : null;
    // `summary` is Atom's; `contentSnippet` is the RSS description as text. `content:encoded` is not read.
    const summary = (it.summary ?? it.contentSnippet)?.replace(/\s+/g, ' ').trim().slice(0, SUMMARY_CHARS) || null;
    items.push({ title: title.slice(0, 500), link, publishedAt: date && !Number.isNaN(date.getTime()) ? date : null, summary });
  }
  return items.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0)).slice(0, ITEMS_PER_FEED);
}

export async function fetchFeed(url: string, o: FetchOptions): Promise<FeedItem[]> {
  const signal = o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(o.timeoutMs)]) : AbortSignal.timeout(o.timeoutMs);
  const res = await (o.fetch ?? fetch)(url, { signal, headers: { 'user-agent': 'IdeasHub/1.0 (RSS reader)', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
  if (!res.ok) throw new Error(`feed ${url} returned HTTP ${res.status}`);
  const xml = await res.text();
  if (xml.length > MAX_BYTES) throw new Error(`feed ${url} is larger than ${MAX_BYTES} bytes`);
  return parseFeed(xml);
}

export type FeedResult<F> = { feed: F; items: FeedItem[]; error?: undefined } | { feed: F; items?: undefined; error: string };

/** Fetches every feed in parallel; one feed's error or timeout never affects another. */
export async function fetchFeeds<F extends { url: string }>(feeds: readonly F[], o: FetchOptions): Promise<FeedResult<F>[]> {
  const settled = await Promise.allSettled(feeds.map((f) => fetchFeed(f.url, o)));
  return settled.map((r, i) => (r.status === 'fulfilled' ? { feed: feeds[i]!, items: r.value } : { feed: feeds[i]!, error: String(r.reason) }));
}
