# Spike plan: engagement of public page posts, logged out (1 day)

Status: **planned, not run.** Running it needs the owner's go (see "Gate").

## Question

The Ad Library shows no likes, comments or shares, so Ideas Hub cannot see how an ad's post performs or
how that changes from day to day. Tools such as Toidispy show those counts per post with a daily change
(`+2.3K`), most likely by reading the public posts of pages that run ads and counting again later. This
spike answers whether Ideas Hub can do the same for the pages it already finds, without signing in:

1. **Readable:** does a logged-out page view expose each post's reaction, comment and share counts?
2. **Blocked:** how often does Facebook answer with a login wall, a checkpoint or an error?
3. **Matched:** what share of a page's active ads in Ideas Hub can be tied to a post on that page? Dark
   posts (ads that never appear on the page) cannot be.
4. **Agrees:** are the counts close to what Toidispy shows for the same posts?
5. **Moves:** do the counts change between two passes a few hours apart, so a delta is worth storing?

## Pages

The 20 shop pages with the most active ads. Only ads whose landing domain is a shop count (`shops`
already leaves out marketplaces and other non-shop domains). The list is taken again on the day of the
run with:

```sql
select a.page_id, max(a.page_name) as page_name, count(*) as active_ads,
  string_agg(distinct a.landing_domain, ' ') as domains
from ads a join shops s on s.landing_domain = a.landing_domain
where a.page_id is not null and a.is_active
group by a.page_id order by count(*) desc, a.page_id limit 20;
```

On 2026-10-22 production had 565 distinct pages over 1556 ads, all from one crawl (2026-10-19). The top
of that list included Personalized Family Gifts, Alma Gems Store, Custom Ink, The Pawfect House Store,
Wander Prints, Happary gift, Sheown, Macorner and Pawpowpet. It also included five health "community"
pages that sell through `auniva.co` and `shop.pipitea.com`. Those stay in, as a check on ads that point
to funnels rather than stores.

## Where and how

- **Not on the production host, and not from the office network.** The development PC and the host share
  the public IP 117.2.18.239. A block there could also hit the scheduled Ad Library crawl, the pilot's
  only data source. The probe runs on the home PC (`ssh home`, a different public IP) with its own
  Chrome profile, logged out, through Playwright like the crawler.
- **Volume:** 20 pages per pass. Each page: one load of `https://www.facebook.com/<page_id>` and at most
  3 scrolls, then stop. Wait 60–120 s (random) between pages. One pass takes about 40 minutes.
- **Two passes** on the same day, about 6 hours apart (for example 10:00 and 16:00 Asia/Ho_Chi_Minh),
  over the posts found in pass 1. Both passes are outside the 01:00 and 13:00 crawl slots.
- **Stop rule:** after 3 consecutive login walls or checkpoints, the pass stops and records where.
- **What it reads:** the counts from the page's embedded data or GraphQL responses (the crawler's
  approach), with the visible text as a cross-check:
  - post id and created time;
  - reaction, comment and share counts;
  - the first 200 characters of the post text and its image URL, used only for matching.

  It reads no comments, names or profiles of other users.

## Matching posts to ads

For each page, every active ad in Ideas Hub is compared with the page's posts read in pass 1:

1. Text: the ad caption and the post text, lowercased, whitespace collapsed, first 120 characters equal.
2. Image: a perceptual hash (aHash 8×8) of the ad's stored thumbnail and the post's image, Hamming
   distance ≤ 6.

An ad is matched when either holds. The share of matched ads is computed per page and in total. Ads not
matched are counted as "no public post found" (dark posts, or posts older than 3 scrolls).

## Comparison with Toidispy

The owner opens 5 of the matched posts in Toidispy ("Posts") in their own browser and notes the like,
comment and share counts by hand, within an hour of pass 2. Toidispy is never scraped (its terms forbid
it); the session only compares the five hand-noted rows.

## Output

- Code under `spikes/fb-page-posts-probe/` (like `spikes/fb-ad-library-probe/`), in its own branch.
- Raw results stay on the home PC and the development PC. They hold counts, post ids, matched ad ids and
  short texts only. Nothing is written to the production database.
- A report `docs/research/<date>-page-posts-engagement.md`. For each question it gives the measure and
  the per-page table: posts read, counts present, blocks, ads matched, change between passes.

## Decision after the spike

| Result | Next |
|---|---|
| Counts readable on ≥ 80% of page loads, ≤ 1 block in 20 loads, ≥ 30% of active ads matched | Plan a worker job: re-read the posts tied to tracked ads once a day, store counts per post and day (like `page_days`), show the change in the briefing |
| Counts readable but match < 30% | Most ads are dark posts. Price a data service (Apify, Bright Data) for the matched share only, or stop at the Ad Library signals (`collation_count`, `page_days`, ad age) |
| Blocked often or counts not readable logged out | Option B (paid data service) or option C (Meta's Page Public Content Access, needs business verification and app review) |

## Gate and risks

- Facebook's terms restrict automated collection; the scheduled Ad Library crawl already runs on the
  same basis. The owner decides before the spike runs, and again before any worker job is planned.
- A block on the home PC's IP affects only that PC's Facebook use while it lasts. The probe uses its
  own logged-out profile, so the owner's accounts are never used.
- Nothing here changes the pilot: no worker change, no production write, no run during crawl slots.

Estimate: 1 session to write the probe (with a dry run against one page), 1 day for the two passes,
30 minutes of the owner's time for the gate and the Toidispy rows.
