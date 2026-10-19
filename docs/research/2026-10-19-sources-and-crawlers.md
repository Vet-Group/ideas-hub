# Sources and crawler tools (research, 2026-10-19)

Input for the product interview and ADR 0001. Only the run-length convention below is decided.

## Summary

- **Toidispy:** its terms forbid automated collection (bots, Playwright, extensions, internal endpoints,
  building an external database). No Toidispy crawler unless the owner gets written permission or an
  API. Staff can still use it by hand and save ideas into Ideas Hub manually.
- **Facebook Ad Library is the first realistic source.** The official API only has political ads and
  ads delivered to the UK/EU, so US POD ads need the web UI.
- **Logged out is enough so far:** a fresh browser profile with no cookies showed the same first page
  as the owner's logged-in profile and scrolled to 59 ads with no login wall. Prefer logged-out workers
  (no Facebook account at risk). The search page answers its first request with 403 even in a real
  browser, and curl on the API landing page got 481 bytes; plain HTTP on the search page was not tried,
  but plan on a real browser.
- **Data shape is known:** first 30 ads embedded in the HTML, then `AdLibrarySearchPaginationQuery`
  pages of 10; fields listed below; `start_date`/`end_date` are Pacific midnights; run length counts
  both ends. The Vietmakers extension gives a trend score (`days_active × seen_count`) and a POD
  keyword list to start from, but its code has no HTML parsing, so it most likely misses the
  HTML-embedded first 30 ads (not run to confirm).
- **Still open:** logged-in vs logged-out beyond the first page; how much scrolling or how many keywords
  trigger blocking; whether result order follows impressions; UK coverage in the API; what the
  load-time GraphQL calls carry; legal review of collecting from the Ad Library web UI.
- **Tools:** one adapter per source; Crawlee (TypeScript) or Crawl4AI (Python) depending on ADR 0001;
  not Firecrawl first.
- **Crawler choice** is now in [ADR 0001](../adr/0001-stack.md) (proposed): Playwright directly;
  Crawlee and Crawl4AI rejected for phase 1.

## Toidispy (first source the owner asked for)

- Products: `app.toidispy.com` (Facebook posts, Ads Library ads, fan pages), `etsy.toidispy.com`
  (Etsy listings, shop tracking, trending tags), an Etsy browser extension.
- Terms of Service (toidispy.com/terms, §3 "Prohibited Automated Data Collection") forbid bots,
  crawlers, Playwright/Puppeteer/Selenium, extensions or scripts that collect data, automated requests to
  its app, APIs or internal endpoints, and systematic export to build an external database. §4 lets them
  suspend accounts on detected automated use.
- Consequence: an Ideas Hub worker that crawls Toidispy breaks these terms and puts the paid account at
  risk. The UI audit through the owner's logged-in browser was not done for the same reason.
- Allowed paths to evaluate: written permission or a data/API agreement from Toidispy; otherwise take the
  same data from the original sources below.

## Original sources

| Source | Official access | Notes |
|---|---|---|
| Facebook Ad Library | Meta Ad Library API (`ads_archive`) | See "Meta Ad Library API, checked against Meta docs" below. |
| Facebook Ad Library (web UI) | none | What the Vietmakers extension does (GraphQL response capture). Meta's terms restrict automated collection without permission; the extension's own README advises a secondary account. Logged-out collection of public pages carries less contract risk than logged-in (Meta v. Bright Data, N.D. Cal. 2024); get legal advice before relying on it. |
| Etsy | Etsy Open API v3 | Listings, shops, tags via an app key. |
| Google Trends | Trends API, restricted alpha (by application, since July 2025) | `pytrends` archived 2025-04-17. |
| News / blogs | RSS feeds + article extraction | For the "read the news, suggest trends" feature. |

### Meta Ad Library API, checked against Meta docs (2026-10-19)

Sources: facebook.com/ads/library/api, developers.facebook.com/docs/graph-api/reference/ads_archive
and .../marketing-api/reference/archived-ad (Graph API v26.0).

- Coverage: ads about social issues, elections or politics delivered anywhere in the past 7 years, and
  ads of any type delivered to the UK or EU in the past year. The `ads_archive` parameter note says ads
  that reached no EU location return only if political, and does not mention the UK; test UK coverage.
- So a POD ad that runs only in the US is not in the API. An ad delivered to the US and the EU is.
- Access: a Facebook account, identity and location confirmation at Facebook.com/ID (takes a few days),
  a Meta for Developers account (accept the Platform Policy), then an app and an access token.
- Search: `search_terms` (100 chars, `KEYWORD_UNORDERED` or `KEYWORD_EXACT_PHRASE`; matches text,
  images, audio from video and the CTA; not translated), `search_page_ids` (up to 10 Pages),
  `ad_reached_countries` (required), `ad_active_status`, `ad_delivery_date_min/max`, `media_type`,
  `publisher_platforms`, `languages`. Rate limit error 613.
- Fields for commercial ads: `page_id`, `page_name`, `ad_creative_bodies`, link titles, descriptions and
  captions, `ad_creation_time`, `ad_delivery_start_time`/`stop_time`, `publisher_platforms`,
  `ad_snapshot_url`; for UK/EU delivery also `eu_total_reach`, `total_reach_by_location`, targeting age,
  gender and locations. `impressions`, `spend`, `currency`, `bylines` exist only for political ads.
- Creative: no image or video URLs in the response; `ad_snapshot_url` renders the ad. Meta allows
  downloading creative of an individual ad for analysis under its Terms of Service; no batch download.

### Ad Library web UI, observed in the owner's logged-in browser (2026-10-19)

One search (`custom t-shirt`, country US, active ads) and one ad's details, read only.

- The UI lists commercial ads with no EU delivery (e.g. VistaPrint, Rush Order Tees cards carry no "EU
  transparency" label). Per Meta's docs the API would not return those; not tested against the API.
- After loading, the URL gains `sort_data[mode]=total_impressions&sort_data[direction]=desc`. If the
  result order really follows impressions (not verified), position is a trend signal even though
  impression numbers are hidden for commercial ads.
- Card fields: Library ID, status, start date, platforms, "has multiple versions" (1/6), page name,
  caption, landing headline/domain/CTA (`l.facebook.com` redirect), image or video.
- Ads delivered in the EU carry "EU transparency": targeting (location, age, gender) and EU reach
  (e.g. 309,414 people). Others show none of that.
- The page made 5 `POST /api/graphql/` calls while loading (payloads not inspected), which fits the
  extension's capture approach.

### Ad Library web UI, logged out (2026-10-19)

BrowserSkill cannot drive an incognito tab, even with "Allow in Incognito" on: borrowing fails with
"Tabs can only be moved between windows in the same profile". Tested instead with Playwright MCP
(system Chrome, fresh profile, no cookies), same search, read only.

| | Logged in (owner profile) | Logged out (fresh profile) |
|---|---|---|
| Result count | >50,000 | >50,000 |
| First three ads (Library ID) | 1522157642978244, 1348487279976503, 1310733247886764 | same IDs, same order |
| Sort parameter added to URL | `total_impressions` desc | same |
| Card fields, "EU transparency" label | present | same |
| Ad details, EU section | targeting (location list not read), age 18-65+, gender All, reach 309,414, "reach by location, age and gender" heading present (rows not read) | EU and UK tabs, targeting locations (Worldwide included, Martinique/Mayotte excluded), age 18-65+, gender All, reach 309,538, reach rows by country/age/gender |
| Infinite scroll | not tested | 30 → 59 ads after 3 scrolls, no login wall |
| First document response | 200 | HTTP 403, page still renders through client JS |
| UI language | Vietnamese (account locale) | English |

- No data difference showed up on the first page; the extension's claim that logging in shows more ads
  was not confirmed for this query (deeper pages not compared). The EU-section rows differ only in how
  much was read, not in what was shown. The reach changed by 124 between the two runs minutes apart, so
  it is a live estimate.
- Plain HTTP is unlikely to work: the search document itself came back 403 (twice), and curl on
  `/ads/library/api/` got a 481-byte page. Plan on a real browser.

### Ad Library data payloads, logged out (2026-10-19)

Read in the page with a temporary XHR hook (Playwright MCP, fresh profile), summaries only.

- The first 30 ads are embedded in one `<script>` of the HTML document (30 unique `ad_archive_id`,
  first three match the table above). The GraphQL calls made during page load were not inspected, so
  whether they repeat these ads is unknown.
- Scrolling loads more through XHR `POST /api/graphql/` with `fb_api_req_friendly_name =
  AdLibrarySearchPaginationQuery`: plain JSON (after an optional `for (;;);` prefix), 10 ads per page
  in the two pages counted by `ad_archive_id` (77,847 and 103,501 bytes), with `page_info`/`end_cursor`
  for pagination. A third page gave 9 objects that have both `ad_archive_id` and `snapshot`; that count
  used a stricter method, so it does not show a short page.
- Ad object keys: `ad_archive_id`, `ad_id`, `collation_id`, `collation_count`, `is_active`, `page_id`,
  `page_name`, `page_is_deleted`, `start_date`/`end_date` (Unix seconds), `publisher_platform`,
  `categories`, `targeted_or_reached_countries`, `impressions_with_index`, `reach_estimate`, `spend`,
  `currency`, `total_active_time`, `regional_regulation_data`, `contains_digital_created_media`,
  `gated_type`, `snapshot`.
- `snapshot` keys include `page_name`, `page_profile_uri`, `page_profile_picture_url`,
  `page_like_count`, `page_categories`, `body`, `caption`, `title`, `link_url`, `link_description`,
  `cta_text`, `cta_type`, `display_format` (e.g. `DPA`), `cards`, `images`, `videos` (with
  `original_image_url`, `resized_image_url`, `video_hd_url`, `video_sd_url`, `video_preview_image_url`),
  `extra_links`/`extra_texts`/`extra_images`/`extra_videos`, `country_iso_code`.
- Sample commercial ad: `impressions_with_index = {impressions_text: null, impressions_index: -1}`,
  `reach_estimate`, `spend`, `total_active_time` null. So impression rank is not exposed per ad; whether
  result order follows impressions is still unverified.
- Unlike the API, the web payload carries direct image/video URLs and `page_like_count`.
- `start_date` and `end_date` are midnight US Pacific in Unix seconds (07:00 UTC in PDT). For the first
  three ads (all active), `start_date` matches the card's "Started running on" (29 Jul, 8 Jul,
  29 May 2026), and `end_date` is 2026-10-18 for all three, the current day in Pacific time when read
  (2026-10-19 02:02 UTC). The pagination sample (also active) had `start_date` 2026-07-06 and `end_date`
  2026-10-13.
- Inactive ads (`active_status=inactive`, same search, first 8 embedded ads, `is_active: false`): the
  card shows a range "start - end", and `start_date`/`end_date` match it on all 8, e.g. Alibaba.com
  2 Mar - 2 Jun 2026, SHEIN 20 Aug - 10 Oct 2026, KyrieTee 29 May - 10 Oct 2026, Crocoblock
  9 Oct - 27 Oct 2025. All 16 raw values of these 8 ads were converted to UTC: dates in standard time
  (`start_date` 2 Mar 2026, before DST began on 8 Mar; `end_date` 13 Jan 2026) are 08:00 UTC (PST), the
  other 14 are 07:00 UTC (PDT). Every value is midnight in `America/Los_Angeles`.
- So `end_date` is the last day of delivery: the stop date for an inactive ad, and for an active ad the
  latest delivery day (today in Pacific time for 3 of the 4 active ads read). `total_active_time` was
  null in all 12 ads checked (4 active, 8 inactive).
- The Vietmakers extension only hooks fetch/XHR and has no HTML parsing, so it most likely misses the
  first 30 ads of every search. Ideas Hub should read both the embedded HTML data and the pagination.

### Run-length convention (chosen 2026-10-19)

`days_active` = calendar days from `start_date` to `end_date` **counting both ends**, with both dates
taken in `America/Los_Angeles`: `days_active = (end_date_pacific − start_date_pacific).days + 1`.

- Both ends are days on which the ad delivered (`end_date` is the last delivery day), so an ad that ran
  on 9–27 Oct ran on 19 days, and an ad that started and stopped on the same day counts 1, not 0.
- Do not divide raw seconds by 86,400: across a DST change the gap is 1 hour short or long (Alibaba.com
  2 Mar 08:00 UTC → 2 Jun 07:00 UTC is 91.96 × 86,400 s), so flooring gives a 91-day gap instead of
  92, and 92 instead of 93 days counting both ends.
- Examples (checked with a script): Crocoblock 9–27 Oct 2025 = 19; Alibaba.com 2 Mar–2 Jun 2026 = 93;
  VistaPrint active 29 Jul–18 Oct 2026 = 82 (when read on 18 Oct Pacific).

## Reference: Vietmakers FB Crawler extension (`C:\huuhungn\Vietmakers-FB-Crawler-v1.0.0`)

MV3 extension, no server, data in the browser's IndexedDB only. Worth keeping:

- Capture by hooking `fetch`/XHR on Ad Library GraphQL responses and walking the JSON for objects with
  `ad_archive_id`, instead of scraping the DOM.
- Ad record: `ad_archive_id` (key), `page_id`, `page_name`, caption, `landing_url` (FB redirect
  unwrapped), `landing_domain`, image/video URLs, `media_type`, `started_at`, `cta_text`,
  `first_seen_at`, `last_seen_at`, `seen_count`, `days_active`, `keyword`.
- Trending score: `days_active × seen_count`, only ads active 5+ days with a landing domain.
- Views: ads grid, shops (unique domains + ad count), trending, keywords, run log, CSV export.
- Schedule 1–4 runs/day, per-country, max ads per keyword, skip recently crawled keywords, cool-down
  when blocked, parallel windows, ~40 POD seed keywords (`lib/keywords.js`).

Limits that a web app fixes: data stays in one browser (no sharing between staff, no per-store lists),
no history across machines, no reports. It also spoofs page visibility to keep FB fetching in the
background.

## Crawler tools (GitHub, checked 2026-10-19)

| Tool | Stars | License | Lang | Fit for Ideas Hub |
|---|---|---|---|---|
| firecrawl/firecrawl | 193k | AGPL-3.0 | TS | Public pages to LLM-ready markdown. Heavy self-host; weak for logged-in sessions. Not first choice. |
| unclecode/crawl4ai | 86k | Apache-2.0 | Python | Playwright-based, persistent profiles, LLM extraction. Good for news/article reading. |
| apify/crawlee | 26k | Apache-2.0 | TS | Queues, sessions, retries, proxy rotation, Playwright or HTTP crawlers. Best fit for scheduled workers in a TypeScript stack. |
| apify/crawlee-python | 10k | Apache-2.0 | Python | Same, for a Python worker. |
| scrapy/scrapy | 65k | BSD-3 | Python | Fast HTTP crawling; no JS. |
| browser-use, stagehand | 118k / 26k | MIT | Py / TS | LLM-driven browsing: costly per page, for ad-hoc research rather than daily batches. |

Working idea: one adapter per source behind a common interface, choosing the lightest access that works
(official API, then HTTP, then a real browser). The crawler framework follows the stack chosen in ADR 0001.
