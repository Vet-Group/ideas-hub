import { readFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { testDatabaseAvailable } from '@ideas-hub/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { refreshFeeds } from '../src/news';
import { type Harness, all, harness } from './helpers';

const rss = (items: { title: string; link: string }[]) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items.map((i) => `<item><title>${i.title}</title><link>${i.link}</link><description>about ${i.title}</description><pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const HN_FEED = 'https://hn.algolia.com/api/v1/search_by_date?tags=story&query=etsy';

describe.skipIf(!testDatabaseAvailable())('RSS refresh', () => {
  let h: Harness;
  let server: Server;
  let base: string;
  let version = 1;
  // Only the local test server is reachable; the Algolia host is mapped onto it.
  const localFetch: typeof fetch = (input, init) => {
    const url = String(input).replace('https://hn.algolia.com', base).replace('https://trends.google.com', base);
    if (!url.startsWith('http://127.0.0.1:')) throw new Error(`test tried to reach ${String(input)}`);
    return fetch(url, init);
  };
  beforeAll(async () => {
    h = await harness();
    server = createServer((req, res) => {
      if (req.url === '/a') return void res.end(rss([{ title: `A one v${version}`, link: 'https://a.test/1' }, { title: 'A one dup', link: 'https://a.test/1' }, { title: 'A two', link: 'https://a.test/2' }]));
      if (req.url?.startsWith('/trending/rss')) return void res.end(fixture('trends-us.xml'));
      if (req.url === '/late') return void res.end(rss([{ title: 'Late', link: 'https://a.test/late' }]));
      if (req.url === '/selflink') return void res.end(rss([{ title: 'Not trends', link: `${base}/selflink` }]));
      if (req.url?.startsWith('/api/v1/search_by_date?')) {
        const file = req.url.includes('query=untrusted') ? 'hn-algolia-untrusted.json' : req.url.includes('query=nul') ? 'hn-algolia-nul.json' : 'hn-algolia.json';
        return void res.setHeader('content-type', 'application/json').end(fixture(file));
      }
      if (req.url === '/badlinks') return void res.end(rss([{ title: 'Script', link: 'javascript:alert(1)' }, { title: 'Huge', link: `https://a.test/${'x'.repeat(2000)}` }, { title: 'Fine', link: 'https://a.test/fine' }]));
      if (req.url === '/hang') return;
      res.writeHead(503).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await h.db.execute(sql`insert into news_feeds (id, url, enabled) values ('feed_a', ${`${base}/a`}, true), ('feed_down', ${`${base}/down`}, true),
      ('feed_hang', ${`${base}/hang`}, true), ('feed_off', 'https://disabled.example.test/rss', false)`);
  }, 60_000);
  afterAll(async () => {
    server?.closeAllConnections();
    server?.close();
    await h?.close();
  });

  it('upserts the items of enabled feeds; a failing or hanging feed fails alone; a second pass updates in place', async () => {
    expect(await refreshFeeds(h, { fetch: localFetch, timeoutMs: 300 })).toEqual({ feeds: 3, failed: 2, items: 2 });
    version = 2;
    await refreshFeeds(h, { fetch: localFetch, timeoutMs: 300 });
    const rows = await all<{ feed_id: string; title: string; link: string; summary: string }>(h, sql`select feed_id, title, link, summary from news_items order by link`);
    expect(rows).toEqual([
      { feed_id: 'feed_a', title: 'A one dup', link: 'https://a.test/1', summary: 'about A one dup' },
      { feed_id: 'feed_a', title: 'A two', link: 'https://a.test/2', summary: 'about A two' },
    ]);
  });

  it('gives Trends items their own explore link, whatever form the feed URL takes, with the feed geo', async () => {
    await h.db.execute(sql`insert into news_feeds (id, url, enabled) values ('feed_trends', 'https://trends.google.com/trending/rss?geo=US', true),
      ('feed_trends_gb', 'https://trends.google.com/trending/rss?hl=en&geo=GB', true), ('feed_trends_nogeo', 'https://trends.google.com/trending/rss', true)`);
    await refreshFeeds(h, { fetch: localFetch, timeoutMs: 300 });
    const rows = await all<{ feed_id: string; title: string; link: string }>(h, sql`select feed_id, title, link from news_items where feed_id like 'feed_trends%' order by feed_id, title`);
    const explore = (geo: string) => [
      { title: 'halloween costumes & ideas', link: `https://trends.google.com/trends/explore?q=halloween%20costumes%20%26%20ideas&geo=${geo}` },
      { title: 'maria timofeeva', link: `https://trends.google.com/trends/explore?q=maria%20timofeeva&geo=${geo}` },
    ];
    expect(rows).toEqual([
      ...explore('US').map((r) => ({ feed_id: 'feed_trends', ...r })),
      ...explore('GB').map((r) => ({ feed_id: 'feed_trends_gb', ...r })),
      ...explore('US').map((r) => ({ feed_id: 'feed_trends_nogeo', ...r })),
    ]);
  });

  it('does not rewrite the links of a feed that is not Google Trends, even when an item links to the feed itself', async () => {
    await h.db.execute(sql`insert into news_feeds (id, url, enabled) values ('feed_self', ${`${base}/selflink`}, true)`);
    await refreshFeeds(h, { fetch: localFetch, timeoutMs: 300 });
    const rows = await all<{ link: string }>(h, sql`select link from news_items where feed_id = 'feed_self'`);
    expect(rows).toEqual([{ link: `${base}/selflink` }]);
  });

  it('drops items whose link is not http(s) or longer than 2000 chars, from RSS and from Algolia', async () => {
    await h.db.execute(sql`insert into news_feeds (id, url, enabled) values ('feed_bad_rss', ${`${base}/badlinks`}, true),
      ('feed_bad_hn', 'https://hn.algolia.com/api/v1/search_by_date?tags=story&query=untrusted', true)`);
    await refreshFeeds(h, { fetch: localFetch, timeoutMs: 300 });
    const rows = await all<{ feed_id: string; link: string }>(h, sql`select feed_id, link from news_items where feed_id in ('feed_bad_rss', 'feed_bad_hn') order by feed_id`);
    expect(rows).toEqual([
      { feed_id: 'feed_bad_hn', link: 'https://example.test/good' },
      { feed_id: 'feed_bad_rss', link: 'https://a.test/fine' },
    ]);
  });

  it('one feed failing at insert or having a malformed URL does not stop the other feeds', async () => {
    await h.db.execute(sql`insert into news_feeds (id, url, enabled) values ('feed_nul', 'https://hn.algolia.com/api/v1/search_by_date?tags=story&query=nul', true),
      ('feed_malformed', 'not a url', true), ('feed_late', ${`${base}/late`}, true)`);
    const out = await refreshFeeds(h, { fetch: localFetch, timeoutMs: 300 });
    expect(out.failed).toBeGreaterThanOrEqual(2);
    expect(await all(h, sql`select 1 from news_items where feed_id = 'feed_nul'`)).toEqual([]);
    expect((await all(h, sql`select 1 from news_items where feed_id = 'feed_late'`)).length).toBe(1);
  });

  it('reads hn.algolia.com feeds as JSON: title, url or the HN item page, created_at; untitled hits are skipped', async () => {
    await h.db.execute(sql`insert into news_feeds (id, url, enabled) values ('feed_hn', ${HN_FEED}, true)`);
    await refreshFeeds(h, { fetch: localFetch, timeoutMs: 300 });
    const rows = await all<{ title: string; link: string; published_at: string }>(
      h,
      sql`select title, link, published_at::text from news_items where feed_id = 'feed_hn' order by published_at desc`,
    );
    expect(rows).toEqual([
      { title: 'Show HN: A print-on-demand mockup tool', link: 'https://example.test/mockups', published_at: '2026-10-28 15:30:00+00' },
      { title: 'Ask HN: How do you price Etsy listings?', link: 'https://news.ycombinator.com/item?id=1002', published_at: '2026-10-28 12:00:00+00' },
    ]);
  });
});
