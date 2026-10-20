# Seed news feeds check

Checked 2026-10-21 at 04:32 VN (2026-10-20T21:32Z). Each URL in `packages/db/seed/news-feeds.json`
got exactly one GET, with a 15 s timeout and the headers of `fetchFeed`. An OK body was then parsed with
`parseFeed` from `packages/sources/rss`. "Items" is what the app keeps: items with a title and a link,
capped at `ITEMS_PER_FEED` (30). "Newest" is the newest item date, in UTC.

| Feed | Status | Content type | Items | Newest item | Result |
| --- | --- | --- | --- | --- | --- |
| `https://www.retaildive.com/feeds/news/` | 200 | `application/rss+xml` | 10 | 2026-10-20 16:26 | kept |
| `https://www.marketingdive.com/feeds/news/` | 200 | `application/rss+xml` | 10 | 2026-10-20 19:40 | kept |
| `https://www.modernretail.co/feed/` | 200 | `application/rss+xml` | 10 | 2026-10-20 14:00 | kept |
| `https://www.practicalecommerce.com/feed` | 200 | `application/rss+xml` | 30 | 2026-10-20 14:09 | kept |
| `https://www.printful.com/blog/feed` | 200 | `application/rss+xml` | 5 | 2026-10-19 07:29 | kept |
| `https://printify.com/blog/feed/` | 404 | `text/html` | – | – | removed |
| `https://feeds.npr.org/1008/rss.xml` | 200 | `text/xml` | 10 | 2026-10-20 15:53 | kept |

No request was redirected, and every item had a date.

## Removed

- `https://printify.com/blog/feed/`: HTTP 404 with an HTML page, so the briefing job would log a
  feed error every day. It is removed from the seed. The seed only inserts missing URLs, so a database
  seeded earlier still has the feed: remove it at `/admin/feeds`.

Six feeds are left. The seed test needs between 5 and 10.

## Notes

- The Printful feed returns 257 KB for 5 items, because it carries full article bodies. The parser does
  not keep them (`content:encoded` is not read).
- No replacement feed was added. A replacement for Printify's blog, if it has a feed under another
  URL, needs the owner's choice.
