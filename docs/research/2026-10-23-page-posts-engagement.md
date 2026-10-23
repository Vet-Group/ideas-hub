# Page-post engagement, logged out: pass 1 results

Date: 2026-10-23. Spike plan: [`docs/plans/spike-page-posts-engagement.md`](../plans/spike-page-posts-engagement.md).
Code: `spikes/fb-page-posts-probe/` (merged in #63). Nothing was written to production.

**Scope note.** The plan calls for two passes about 6 hours apart. Only pass 1 is reported here. Pass 2
was scheduled on the home PC for 2026-10-23 05:30, but the PC went offline at about 05:00, so it is not
known whether pass 2 ran. On 2026-10-23 the owner chose to close the spike on pass 1 alone. Pass 1
already decides the outcome (see "Decision"). Question 5 is therefore left open, and the home PC's
probe tasks and folder are to be removed.

## Method

- Where: the home PC (`ssh home`, not the office IP that the production crawl uses).
  Chrome ran headless through Playwright 1.63.0, with a fresh logged-out context for each page.
  No account was used.
- Pass 1: 2026-10-22 from 22:53 Asia/Ho_Chi_Minh, outside the crawl slots. It covered the 20 shop pages
  with the most active ads, using the plan's query on production read-only.
  - Each page got one load and at most 3 scrolls, with a 60–120 s wait between pages.
  - The pass stopped after page 19 under the stop rule (3 loads in a row with no post read).
- Reading: post id, created time, reaction, comment and share counts, the first 200 characters of the
  text and the image URL. These came from the page's embedded data and GraphQL responses. Post images
  were then downloaded for matching: 25 saved, 0 failed.
- Ads: the active ads of those pages were exported read-only with their stored thumbnails, using
  `export-ads.sh`: 385 ads, of which 372 are on the 19 loaded pages.
- Matching, as in the plan: an ad matches a post when the first 120 normalized characters of the
  caption equal those of the post text, or when the aHash 8×8 distance between the ad thumbnail and the
  post image is at most 6.

## Results

| Question | Measure | Plan's bar |
|---|---|---|
| 1. Readable | 11 of 19 loads (58%) read at least one post with all three counts. All 27 posts read had all three. | ≥ 80% of loads |
| 2. Blocked | No login wall, checkpoint or error. 8 of 19 loads read no post; 6 of those were titled just "Facebook", with no page name: a logged-out soft wall. | ≤ 1 block in 20 loads |
| 3. Matched | 0 of 372 active ads matched (0%). On the 11 pages whose load read posts: 0 of 215. No text match and no image match. | ≥ 30% of active ads |
| 4. Agrees | Not measured: there is no matched post to compare (see below). | |
| 5. Moves | Not measured: pass 2 is not available. | |

- **Near misses (image).** The closest pair between an ad thumbnail and a post image was at aHash
  distance 10. Viewed side by side, it is a different image. Loosening the threshold would add false
  matches, not real ones.
- **Why so few posts.** Logged out, a page shows only its first few posts: 1 to 3 per page here, even
  after 3 scrolls. The ads, by contrast, are mostly dark posts, or posts older than what a logged-out
  view shows.
- **Soft walls.** These are not counted by a login-URL check: the page returns HTTP 200 on its own URL.
  `analyze.mjs` reports them separately.

### Per page (pass 1)

The 6 rows titled "Facebook" are soft walls (no page name shown).

| Page | Posts | With counts | Empty load | Active ads | Matched (text / image) |
|---|---:|---:|---:|---:|---|
| Nerve Support Community | 0 | 0 | 1 | 45 | 0 (0 / 0) |
| Cholesterol Relief Community | 1 | 1 | 0 | 26 | 0 (0 / 0) |
| Personalized Family Gifts | 3 | 3 | 0 | 24 | 0 (0 / 0) |
| Facebook (soft wall) | 0 | 0 | 1 | 23 | 0 (0 / 0) |
| Custom Ink, Tysons Corner VA | 3 | 3 | 0 | 22 | 0 (0 / 0) |
| Arthritis Support Community | 1 | 1 | 0 | 21 | 0 (0 / 0) |
| Wellness Insider | 1 | 1 | 0 | 20 | 0 (0 / 0) |
| The Pawfect House Store | 3 | 3 | 0 | 20 | 0 (0 / 0) |
| Facebook (soft wall) | 0 | 0 | 1 | 18 | 0 (0 / 0) |
| Happary gift | 3 | 3 | 0 | 18 | 0 (0 / 0) |
| Sheown | 3 | 3 | 0 | 17 | 0 (0 / 0) |
| AlmaGems - Cultural Customized Gifts, Boulder CO | 3 | 3 | 0 | 17 | 0 (0 / 0) |
| Facebook (soft wall) | 0 | 0 | 1 | 16 | 0 (0 / 0) |
| Facebook (soft wall) | 0 | 0 | 1 | 16 | 0 (0 / 0) |
| Trending Custom Home Decor, San Francisco CA | 3 | 3 | 0 | 15 | 0 (0 / 0) |
| PawPow Personalized Memory Gifts | 3 | 3 | 0 | 15 | 0 (0 / 0) |
| Facebook (soft wall) | 0 | 0 | 1 | 13 | 0 (0 / 0) |
| Facebook (soft wall) | 0 | 0 | 1 | 13 | 0 (0 / 0) |
| Shawncraft.com, Eldorado Springs CO | 0 | 0 | 1 | 13 | 0 (0 / 0) |

### Question 4 (Toidispy)

The plan compares Toidispy with 5 *matched* posts, and none matched. If the owner still wants a
spot check of the counts themselves, the table below is for 5 of the 27 posts read. The owner fills it
by hand from Toidispy in their own browser. Toidispy is never scraped.

| Page | Post (open on Facebook) | Probe: reactions / comments / shares | Toidispy: likes / comments / shares |
|---|---|---|---|
| | | | |
| | | | |
| | | | |
| | | | |
| | | | |

## Decision

On the plan's decision table, two rows apply:
- **Counts readable but match < 30%** (0%): the active ads are almost all dark posts, or posts beyond the
  logged-out view.
- **Blocked often / counts not readable logged out**: 6 soft walls in 19 loads and 58% readable, against
  ≤ 1 and ≥ 80%.

**Next step.** No worker job for page posts. Ideas Hub stays with the Ad Library signals it already
stores: variants (`collation_count`), page like counts per day (`page_days`) and ad age. These already
feed the Trending sort since #60/#61.

Per-post engagement would need one of the plan's other options, and each is an owner decision for after
the pilot:
- B, a paid data service, priced for the matched share only.
- C, Meta's Page Public Content Access, which needs business verification and app review.

The raw results (`pass1.jsonl`, the images, the ads export) are only on the home PC. They are copied to
the development PC and then removed from the home PC together with the probe, the next time it is online.
