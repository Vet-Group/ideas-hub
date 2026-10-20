import { readFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchFeed, fetchFeeds, parseFeed } from '../src/index';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('rss source', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/rss') return void res.writeHead(200, { 'content-type': 'application/rss+xml' }).end(fixture('rss.xml'));
      if (req.url === '/atom') return void res.writeHead(200, { 'content-type': 'application/atom+xml' }).end(fixture('atom.xml'));
      if (req.url === '/broken') return void res.writeHead(200).end('<rss><channel><item>');
      if (req.url === '/hang') return; // never answers
      res.writeHead(500).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it('keeps title, link, date and the feed summary as text, never the article body', async () => {
    const items = await fetchFeed(`${base}/rss`, { timeoutMs: 2000 });
    expect(items).toEqual([
      { title: 'Holiday shopping starts in October', link: 'https://news.example.test/holiday-shopping', publishedAt: new Date('2026-10-20T14:00:00Z'), summary: 'Shoppers start early this year.' },
      { title: 'Teacher gifts trend', link: 'https://news.example.test/teacher-gifts', publishedAt: null, summary: 'Teachers love mugs.' },
    ]);
    expect(JSON.stringify(items)).not.toContain('FULL ARTICLE');
  });

  it('reads Atom feeds', async () => {
    expect(await parseFeed(fixture('atom.xml'))).toEqual([
      { title: 'Etsy sellers and Halloween', link: 'https://atom.example.test/halloween', publishedAt: new Date('2026-10-19T08:00:00Z'), summary: 'Halloween sales are up.' },
    ]);
  });

  it('isolates each feed: an HTTP error, broken XML and a hang past the timeout fail alone', async () => {
    const started = Date.now();
    const results = await fetchFeeds(
      [{ url: `${base}/rss` }, { url: `${base}/missing` }, { url: `${base}/broken` }, { url: `${base}/hang` }, { url: `${base}/atom` }],
      { timeoutMs: 300 },
    );
    expect(Date.now() - started).toBeLessThan(3000);
    expect(results.map((r) => (r.error ? 'error' : r.items!.length))).toEqual([2, 'error', 'error', 'error', 1]);
    expect(results[1]!.error).toContain('HTTP 500');
    expect(results[3]!.error).toMatch(/timeout|abort/i);
  });
});
