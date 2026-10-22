# Ideas Hub phase 1 specification

Status: draft for owner review (2026-10-19). Source: product interview of 2026-10-19 (11 rounds) and
UI/UX interview of 2026-10-19 (8 rounds, §6) on top of
[docs/research/2026-10-19-sources-and-crawlers.md](../research/2026-10-19-sources-and-crawlers.md). The
stack is proposed separately in [ADR 0001](../adr/0001-stack.md).

## Goal

One internal web app where a daily crawl of the Facebook Ad Library (logged out) and a few news feeds
turns into a morning trend briefing with AI idea and keyword suggestions, and where store staff save the
ideas they want into their own store's list.

## Scope at a glance

| Component | Phase 1 | Later |
|---|---|---|
| Collection | Facebook Ad Library web UI adapter (logged out, real browser), RSS news adapter, static US holiday table | Etsy Open API (phase 1.5), Google Trends (when API access is granted), residential proxies by configuration, Facebook accounts only after an ADR |
| Data store | Shared research data, per-store ideas and keywords, thumbnails in S3 storage | |
| Trend briefing | Daily briefing and per-keyword report: rule-based sections plus two AI sections, in app and on Lark | Email |
| Accounts and stores | Admin and store staff with per-store permission ticks, save-idea flow | Approval step, more roles |
| Integration | Cross-app keys and a draft contract only, no calls to other apps | Push ideas to POD Studio, ERP Keycloak SSO, read API |

## 1. Collection

### Sources

Each source is one adapter behind a common interface (`plan searches → fetch → normalize → upsert`).
The adapter picks the lightest access that works: official API, then plain HTTP, then a real browser.

- **Facebook Ad Library (web UI).** Real browser (Playwright, system Chrome), fresh logged-out profile,
  in the mode the plan's Step 1 picks: headed, headed with the window off-screen, or headless.
  Reads both the 30 ads embedded in the HTML document and the `AdLibrarySearchPaginationQuery`
  responses while scrolling. Active ads only.
- **RSS news.** Admin manages 5–10 feeds (POD, e-commerce, US culture). Phase 1 keeps the title, link,
  date and feed summary only; it does not fetch article bodies.
- **US holidays.** A static table seeded from a file in the repo, edited by admin.

No Toidispy crawler. Staff who use Toidispy by hand can save what they find as a manual idea.

### Schedule and limits (defaults, editable by admin)

| Setting | Default |
|---|---|
| Runs per day | 2, at admin-set times (Asia/Ho_Chi_Minh); default 01:00 and 13:00. The scheduler keeps scheduled run rows written at least 14 days ahead; changing run times, the search budget, countries or keywords rewrites only future `scheduled` rows with `trigger = schedule`; the worker's scheduler writes the RunTimeChange row when it applies a change of run times, with the time it takes effect, so each past slot is judged by the run times in force then. The scheduler and the watchdog backfill insert slot rows with `ON CONFLICT DO NOTHING` on the unique (source, `scheduled_for`) key of scheduled rows, so a slot never gets two rows |
| Run deadline | 4 h 30 min per run. The morning run, the last scheduled slot before the briefing build time, also stops at the hard stop (default 06:05) so the briefing has fresh data. Settings are rejected when the hard stop plus the watchdog grace plus the 5 min watchdog period is not before the briefing build time (defaults: 06:05 + 15 + 5 min = 06:25, before 06:30). Settings are also rejected when the morning run's slot is at or after the hard stop, or when two slots, the gap across midnight included, are closer than the run deadline plus the watchdog grace plus 5 min (defaults: 01:00 and 13:00, 12 h apart, against 4 h 50 min). The crawl job's expiry is the run deadline plus the watchdog grace plus the 5 min watchdog period (4 h 50 min by default), so the queue cannot free the next run before the watchdog closes a hung one; settings that would make it exceed 24 h, the queue's maximum, are rejected |
| Countries | US, GB, CA, AU (admin list) |
| Keywords | ~40 POD seed keywords (Vietmakers list as a starting point) + keywords tracked by stores, max 80 |
| Search budget per run | 160 keyword × country searches; the rest rotate into the next run |
| Ads per search | max 100 unique ads: the 30 embedded, then scroll pages until the end of results, the cap, or 2 non-empty scroll pages in a row whose ads were all read already (the 2-page rule). An empty payload neither counts toward nor resets the 2-page rule; it counts toward block detection. No page cap, because a page may repeat ads already read (not measured yet); the 2-page rule keeps one search from using up the run deadline |
| Concurrency | 1 browser, 1 tab |
| Delay between searches | random 20–60 s |
| Delays inside a search | random 400–1300 ms after the search page loads, random 900–1700 ms before each scroll |
| Block detection | captcha, login wall, embedded data that is empty without the "no results" marker, or 3 empty scroll payloads in a row (a non-empty page resets the count); a page that says "no results" is not a block |
| On block | the search is `blocked` (ads kept, reason logged, one `blocked` Alert per run) |
| Backoff | each search sends the backoff a resistance signal, kept apart from its status: `ok`, neutral (`no_results`, `parse_error`), blocked (`blocked`), captcha (sent for a captcha or a login wall), or network (`network_error`). The **block streak** is the number of searches with a blocked signal since the last `ok` signal, or since 30 min passed without a blocked signal; neutral and network signals are skipped and do not reset it. The 30 min are wall time, so a network cool-down counts toward them: with the 10 min default it cannot reset the streak on its own, a longer one can, and that is intended, since time away from the site is quiet time whatever the reason. An `ok` search that stopped by the 2-page rule while `last_has_next` is still true keeps its ads and stays `ok`; until Step 1 measures whether scroll pages repeat ads normally, its signal is neutral and it is counted per run outside the stop thresholds, so normal repeats cannot stop a run. Step 1 decides whether it should signal blocked. After a blocked search the run pauses before the next search for 45 s × 2^(block streak − 1), ±15% jitter. A captcha, a login wall, a block streak of 3, or 6 blocked searches in the run stop the run, cool down 6 h and write the run's block reason and `blocked` Alert. Starting values for Step 1 to measure |
| On parse error | mark the search `parse_error`, alert admin, no cool-down |
| Missed run | a watchdog, a short-lived process started every 5 min by the OS timer and separate from the worker, marks a run row still `scheduled` 15 min after its slot as `missed` and cancels its `crawl.run` job (unless `blocked_until` covered its slot, see "Blocked slot"), writes a `missed` row for any past slot of the run times then in force that has no row (or, when a run's cool-down covered that slot, a row closed as in "Blocked slot"), checks the worker heartbeat (30 min), and alerts admin. Two watchdog passes never overlap (a Postgres advisory lock taken with `pg_try_advisory_lock`; a pass that does not get it exits); each pass first does its closes, marks, backfill and heartbeat check, then sends Alerts within a 60 s budget, leaving the rest for the next pass, so a pass ends well within 5 min. The backfill looks back at most 14 days and never before the first RunTimeChange; a backfilled row gets `planned_searches` from the settings at the time it is written |
| Interrupted search | a search stopped part-way by the run deadline or a crash is `interrupted`; a search that hits a block is `blocked`. Both keep the ads they read and count as failures |
| Failed run | a run that ends with an unexpected run error, or that the watchdog or worker startup closes because it hung or the worker crashed ("Hung run", "Crash recovery"), is `stopped` with a `run_failed` Alert. An unexpected run error is one outside a search: the database, settings, worker code outside the search loop, or a browser that does not start within its limit when the run starts |
| Crash recovery | when the worker starts, before it takes any job, it closes every run still `running` (left by a crash) as `stopped` with a `run_failed` Alert, its `running` search `interrupted` and its `pending` searches `skipped`, and fails its `crawl.run` job. A row still `scheduled` whose `crawl.run` job is active (the crash came between taking the job and starting the run) has that job failed; before the row's deadline a new job is sent to start at once and its id stored, after it a scheduled row becomes `missed` with a `missed_run` Alert and a manual or `cli` row `stopped` with reason `not_started`. The `briefing.build` jobs still active are cancelled, which frees their key on the `exclusive` queue so they can be sent again; the `lark.send` jobs still active are failed, so pg-boss retries them (that `standard` queue has no key to free) |
| Hung run | the watchdog closes a `running` run when the worker heartbeat is older than the heartbeat threshold (30 min) or when the run's deadline plus a grace (default 15 min) has passed: the run becomes `stopped` with a `run_failed` Alert (its `running` search `interrupted`, its `pending` searches `skipped`), its `crawl.run` job is ended in pg-boss so the singleton is free, and the worker service is restarted. When the heartbeat is older than the threshold while no run is `running`, the worker hung while idle: the watchdog opens the `heartbeat_lost` incident as usual and also restarts the worker service. While the incident stays open, later passes restart the worker again, at most once per 5 min, so a restart that failed or did not help is retried; a failed restart is logged and does not stop the pass |
| Run status | a run ends `done` when it has run all its planned searches or stopped at its deadline (the searches cut by the deadline are `interrupted` or `skipped`); it ends `stopped` when a block stops it (captcha, login wall, block streak or blocked searches per run), on a `run_failed` error, or when the watchdog or worker startup closes it ("Hung run", "Crash recovery", "Blocked slot"). A run starts with one update from `scheduled` to `running` that applies only while the row is `scheduled`, before its deadline and while CrawlerState holds no `blocked_until` in the future (an empty `blocked_until` blocks nothing); when it changes no row, the job ends as a no-op and inserts no searches, so a job that comes late cannot revive a closed row. After a run starts, every worker update of the run and its searches applies only while the run is still `running`; Alerts and `blocked_until` are written in the transaction of the guarded update that causes them, and KeywordDay and ShopDay in the transaction of the final run update, so a late write cannot undo a close or add a snapshot. Each watchdog close is likewise one update that applies only while the row is in the status it expects (`scheduled` or `running`) |
| Transient errors | inside a search, a timeout, a navigation that destroyed the page context, a `net::err_` error, a closed browser, or a browser that does not restart within its limit ends that attempt. A search gets up to 3 attempts (2 retries, after 5 s and then 15 s), and the browser is restarted before each retry. A search still transient after its last attempt is `network_error` and sends a network signal: neutral to the block streak and not counted toward the blocked thresholds. The **network streak** is the number of `network_error` searches in a row; any other search resets it to 0. When it reaches 3, the run pauses for a network cool-down (default 10 min, for Step 1 to tune), writes one `network_error` Alert for that cool-down, resets the network streak and goes on within its deadline, with no 6 h cool-down. These retries sit below the job-level "no automatic retry" of a run |
| Permanent search error | an error tied to one search's page or payload that is not transient makes the search `parse_error` with the error text and a `parse_error` Alert, like any other parse error; it is neutral and the run goes on |
| Bounded waits | browser start 60 s, page load 60 s, embedded data 15 s after the load, each scroll response 15 s. A wait that runs out is a transient error that ends the attempt, so a slow page is told apart from a block; only a browser that does not start when the run starts is an unexpected run error ("Failed run"). Outside the attempts: each thumbnail download 15 s, within a total for the search's thumbnails equal to the gap before the next search (after the last search of a run, the shortest gap, 20 s; never past the run deadline), so thumbnails never lengthen a run; a thumbnail not downloaded when either limit runs out is left missing and downloaded again at its next sighting; and browser close 15 s (a browser that does not close in time is killed). Each limit hit is counted on the run. Starting values; Step 1 records how often each limit is hit and tunes them |
| Heartbeat | while a crawl job runs, the worker writes its heartbeat only from the search loop and from its waits: at every step (each search, attempt, page load and scroll), between thumbnail downloads, and at least once a minute while it waits: during pauses and the network cool-down. Between runs a one-minute timer writes it, the one exception, because pg-boss `work()` has no idle loop of its own: the timer runs only while no crawl job is running, stops when one starts, and writes only while pg-boss still polls (the `crawl.run` worker fetched within the last 2 min), so a worker whose queue polling died stops the heartbeat and the watchdog restarts it. The 6 h cool-down is not a wait inside the run: the run ends at once with `blocked_until` set, and the cool-down is spent idle, with the timer writing the heartbeat. Only the worker writes it (the crawl loop, or the idle timer while no crawl job runs); the briefing and Lark jobs do not, and are bounded instead by the LLM call timeout, the Lark send timeout and their job's abort signal (a job's expiry does not stop its handler, so the handler passes the job's signal to the LLM client and the Lark request and runs its database statements under a `statement_timeout` shorter than the expiry), and a global briefing that is not ready in time raises `briefing_late`. A step that hangs therefore stops the heartbeat ("Hung run"). While nothing hangs, the longest stretch without a heartbeat is one bounded wait (browser start or page load, 60 s) or one minute of waiting, far shorter than the 30 min threshold; settings that would make a wait limit reach the threshold are rejected. The watchdog raises `heartbeat_lost` only from a missing heartbeat, never from the absence of a run |
| Run now | admin for any keyword; store staff with the `keywords` tick for their store's keywords; same limits and cool-down apply, but a run's own cool-down reaching the next slot is never a reason to refuse it. Run now and `pnpm crawl:run` insert a `scheduled` row with the requested keyword × country pairs and send its job to start at once, in one transaction. At start, the run plans the requested pairs that are still active, capped by the search budget. A manual or `cli` run's deadline is the earlier of the run deadline (4 h 30 min) after the request and a margin (default 25 min) before the next scheduled slot; settings with a margin no longer than the watchdog grace plus the 5 min watchdog period are rejected, so a hung manual run is closed before the slot. Run now and `pnpm crawl:run` are refused while `blocked_until` is in the future, while another run is `running`, while another manual or `cli` row is `scheduled` or `running` (a partial unique index), or when that deadline has already passed. A manual or `cli` row whose start is a no-op is closed as `stopped` with reason `not_started`; crash recovery and the watchdog close one still `scheduled` after its deadline the same way |
| Blocked slot | a scheduled slot that comes before `blocked_until` (set by a block in any run, manual and `cli` runs included) is not started; the watchdog closes its row as `stopped` with all its planned searches `skipped` and a `blocked` Alert, instead of `missed`, and cancels its `crawl.run` job. The backfill applies the same rule to a past slot with no row that fell inside a cool-down (from the end of the run that set it to the `blocked_until` that run set). AC 1 counts those searches as failures |

Run-time estimate, with the Step 1 measurements (`docs/research/2026-10-20-fb-probe.md`). A search
that stores 100 ads reads the 30 embedded ads and 7 scroll pages of 10 ads each. Measured: page load
p50 about 1.5 s and p95 2.9 s, scroll response p50 about 1.0 s and p95 2.0 s, embedded data p95 1.9 s
(the assumptions were 5 s and 1.5 s); the delays above; thumbnails downloaded during the gap before the
next search within a total capped at that gap ("Bounded waits"), so they add no time except up to 20 s
after the last search; and every search reaching 100 ads.

- Mean delays and p50 times: about 61 s per search, so 160 searches take about 2 h 43 min, leaving
  about 1 h 47 min under the 4 h 30 min deadline.
- Longest delays (60 s gap, 1.3 s page delay, 1.7 s scroll delay) and p95 times: about 92 s per search,
  4 h 5 min in all, leaving about 25 min.
- Backoff: a run that reaches its last search has at most 5 blocked searches (the 6th stops it) and a
  block streak of at most 2 (3 stops it), so its longest total pause is 45 + 90 + 45 + 90 + 45 s plus
  15% jitter, about 6 min. That leaves about 1 h 41 min at mean delays and 19 min at the longest.
- Searches with fewer ads, `no_results` or an early stop take less. A slower page load or scroll
  response than assumed uses up the margin first, and the searches cut by the deadline count as
  failures in AC 1.
- Network errors, page-load case: a `network_error` search whose 3 attempts all fail at the page load
  takes 3 × 60 s page-load timeouts plus the 5 s and 15 s retry waits = 200 s, plus two browser
  restarts assumed at 5 s each: 210 s. The whole 210 s is added to the run, without subtracting the
  normal search it replaces. Rounded down, the margin left after the backoff holds 28 such searches at
  mean delays, or 26 with one 10 min network cool-down (the 3 that trigger it included), and 5 at the
  longest delays, or 2 with one 10 min network cool-down (fewer than the 3 that trigger it).
- Network errors, 7-scroll-page case: an attempt can instead fail at the last scroll after every earlier
  wait ran close to its limit (60 + 1.3 + 15 + 6 × (1.7 + 15) + 1.7 + 15 ≈ 193 s), and each of the two
  restarts can take the 15 s browser close limit plus the 60 s browser start limit, so one
  `network_error` search can take about 750 s (3 × 193 + 5 + 15 + 2 × (15 + 60)). In that case the
  margin after the backoff (about 1 h 41 min at mean delays, 19 min at the longest) holds only 1 such
  search at the longest delays and 8 at mean delays. This is not an upper bound: there is no page cap
  ("Ads per search"), so an attempt can read more pages, and only the run deadline bounds a run.
- A 30 min network cool-down is worth about 20 searches at the longest delays; after the margin, with
  the worst backoff and the 3 searches that trigger it, it would still push about 9 searches past the
  deadline as `skipped` failures in AC 1. Hence the 10 min default.

The adapter keeps slots for a named browser profile and a proxy, both off in phase 1, so they can be
switched on by configuration. Using Facebook accounts needs measured evidence that logged-out access is
not enough, plus its own ADR. Residential proxies come before accounts.

### Measures

- `days_active` follows the run-length convention in the research doc: calendar days from `start_date`
  to `end_date` counting both ends, both in `America/Los_Angeles`.
- Crawl day: the `America/Los_Angeles` date on which a run started. The default 13:00
  Asia/Ho_Chi_Minh run starts at 23:00 Pacific (22:00 in winter) and crosses Pacific midnight; its
  sightings still belong to the start date, while `days_active` always uses the payload's `end_date`,
  which can already be the next Pacific day for ads read after midnight.
- Ad status: the crawl reads active ads only, so `is_active` from the payload never turns false. Status
  is computed, not stored. Only a search that read to the end of results (`no_results`, or `ok` with
  `last_has_next` false) proves an ad is gone; a search stopped at the 100-ad cap or by the 2-page rule
  saw only the top of a result list that can exceed 50,000 ads. When an ad's `last_seen_date` is more
  than N days ago (stale-after days in settings, default 3), it is:
  - "stopped or unknown" if an end-of-results search on one of the (keyword, country) pairs it was
    seen under ran after `last_seen_date`, or if all those pairs are now inactive (keyword or country
    turned off);
  - otherwise "out of top results" if an `ok` search on one of those pairs ran after
    `last_seen_date` but stopped with a next page left;
  - otherwise "running": an ad that was only missed because its searches did not run (rotation,
    blocks) stays running.

  An ad seen within N days is "running". The ads grid shows all three labels and filters on "running"
  by default; shop counts and briefing sections 1–4 use "running" ads only.
- `seen_runs`: number of runs in which the ad appeared. `seen_days`: number of distinct crawl days in
  which it appeared. Both are kept on the ad as it is upserted.
- Trend score: `days_active × seen_days`, only for ads active 5+ days with a landing domain. Using
  `seen_days` keeps the score stable when admin changes the number of runs per day.

- Running ads of a run (`running_ads` on CrawlRun): every ad in the database whose status is "running"
  by the rule above right after the run's upserts, not only the ads under the run's keywords. KeywordDay
  applies the same rule per keyword.

## 2. Data store

- **Shared** (every signed-in user can search and read): ads, shops and landing domains, keywords, run
  history, sightings, trend scores, news items, holidays, the daily global briefing and its suggestions.
  Run history shows a manual run as "manual" without who triggered it, so it does not reveal which
  store tracks a keyword; only admins see the trigger.
- **Per store** (only members of that store and admins): saved ideas with status and notes, which
  keywords the store tracks, the store's Lark chat. The AI sections of keyword reports follow the
  visibility rule in §4; sections 1–4 of keyword reports are shared.
- A keyword tracked by a store is crawled into the shared data. Keyword text is shared: it appears in
  keyword lists and ad filters for everyone. Only which store tracks a keyword is hidden.
- Ads are deduplicated by `ad_archive_id`; a new sighting updates `end_date`, `is_active` and the stored
  JSON. Each run that sees an ad adds one sighting per (run, keyword, country) with position, crawl
  day and the ad's `collation_count` at that sighting (so a rising variant count shows over time).
  Sightings are kept 180 days; the counts on the ad stay. Each crawl day also keeps every seen page's
  `page_like_count` (`page_days`, the last value read that day), so a page's growth shows over time.
- **Momentum** (`momentumScore`, the ads grid's "Trending" sort): 10 per variant gained (`collation_count`)
  plus the page's like growth in % (capped at 100) plus days running (capped at 30), each series compared
  between its first and last crawl day from 3 days before today to today. It is 0, and the grid says there is not enough
  data yet, until either series has two crawl days in that window.
- The adapter keeps the parsed ad object as JSON so it can be re-parsed later. Raw HTML pages are not
  stored.
- Thumbnails (`resized_image_url`, `video_preview_image_url`) are downloaded at capture time. This rests
  on an assumption that the CDN URLs expire, which the Step 1 probe of the plan checks. Videos are not
  downloaded. The web app serves thumbnails through signed URLs, `/thumbs/[sig]/[key]`: `key` is one
  path segment matching `^[A-Za-z0-9_-]+\.(jpg|webp)$`, read only under the thumbnail prefix of the S3
  storage, and `sig` is the HMAC-SHA256 of the decoded key with an app secret. The worker stores every
  thumbnail under the `thumbs/` prefix with a key of that form, its extension taken from the magic
  bytes: JPEG `.jpg`, WebP `.webp`, anything else re-encoded to WebP and named `.webp`. The signature
  does not expire, so the `/_next/image` cache keeps one entry per image. The route checks only the key
  pattern and the signature and streams the file; a bad key or signature gets 404. It does not check the
  session, because Next's image optimizer fetches the source image without the user's headers or
  cookies; pages and `/_next/image` itself still require a session (the proxy's `matcher` leaves out
  only `/_next/static/**`, `/api/ideas/manual`, which checks the session itself, and paths ending in
  `css|js|map|woff2?|ico|png|svg|webp|jpg|txt|webmanifest`, and the proxy lets only `/login`,
  `/api/auth/**` and `/thumbs/**` through without a session, so a page such as `/shops/example.com` is
  still checked). SavedIdea snapshots keep the key, never a signed URL; pages sign keys when they
  render. `next/image` serves the thumbnails as WebP, 320 px wide at 1x and at most 640 px wide at 2x
  (§6).
- Images uploaded for manual ideas are per-store data, not shared research data. The manual idea form
  posts to a route handler, `POST /api/ideas/manual`, which the proxy leaves out and which checks the
  session (401 without one) and `save` on every chosen store itself; it answers 403 unless `Origin` is
  the app's or `Sec-Fetch-Site` is `same-origin`, the app origin coming from the configured public URL,
  never `request.nextUrl`, because the app runs behind the tunnel, and answers every size refusal, a
  body over 5 MB + 64 KB (by `Content-Length` or while counting bytes) or a file part over 5 MB, with
  status 413 and "Ảnh lớn hơn 5 MB"; it accepts JPEG, PNG or WebP only (checked by magic bytes,
  otherwise "Chỉ nhận ảnh JPEG, PNG hoặc WebP"), decodes with a 50-megapixel limit ("Ảnh quá lớn (trên
  50 megapixel)") and refuses an image it cannot decode ("Không đọc được ảnh này"), turns the image
  upright from its EXIF orientation and re-encodes it to WebP within 640 × 1920 px. A save to several
  stores stores one copy per store under that store's key prefix, with nanoid keys, never the file name;
  the objects are written before the rows and deleted if a later step fails, and each idea keeps its key
  in `image_key`; "Hoàn tác" deletes the objects of the ideas it deletes. `/ideas/[id]/image` serves the
  image after checking the session and the idea's store scope (404 otherwise), with
  `Cache-Control: private, no-store`, never through `/thumbs`. Both routes send a Content-Type from an
  allow list (`image/jpeg`, `image/webp`) and `X-Content-Type-Options: nosniff`.

### Main entities

| Entity | Key fields |
|---|---|
| User | id, email, name, role (`admin` or `member`), disabled |
| Store | id, name, `erp_store_code` (nullable), `pod_studio_store_id` (nullable), `lark_chat_id` (nullable) |
| StoreMember | store_id, user_id, permissions (`view`, `save`, `keywords`) |
| Keyword | id, text, origin (`seed` or `store`), active; shared, with the store link only in StoreKeyword |
| StoreKeyword | store_id, keyword_id |
| CrawlRun | id, source, trigger (`schedule`, `manual` or `cli`), `scheduled_for` (slot time for scheduled runs), `triggered_by` (the user for `manual` runs, null for `cli` runs; admin-only), status (`scheduled`, `running`, `done`, `stopped`, `missed`), `requested_pairs` (jsonb, the keyword × country pairs asked for; `manual` and `cli` rows only), `planned_searches` (min(search budget, active keyword × country pairs), or for `manual` and `cli` rows the requested pairs still active, capped by the budget; set when the row is written, rewritten on future `schedule` rows when run times, budget, countries or keywords change, and recomputed when the run starts, which then inserts that many search rows), started/finished, deadline (stored when the row is inserted as `scheduled`, before its job is sent: for a scheduled row the earlier of slot plus run deadline and, for the morning run, the hard stop; for a manual or `cli` row the earlier of request time plus run deadline and the next slot minus the margin; rewritten on future rows when run times, run deadline, grace, hard stop, build time or margin change), `job_id` (the id of its `crawl.run` job, returned by the queue when the job is sent), the `blocked_until` it set when a block stopped it, counts (including 2-page stops with a next page left, transient retries, browser restarts, wait-limit hits per wait, and `network_cooldowns`, the number of network cool-downs), `running_ads` (the number of ads whose status is running under §1 "Measures" right after the run's upserts, counted as KeywordDay counts them) and `ok_searches` (its `ok` and `no_results` searches), both written in the transaction of the run's final update, block reason, close reason (`not_started` for a manual or `cli` row closed before it started). Unique per (source, `scheduled_for`) where `trigger = schedule`; at most one `manual` or `cli` row `scheduled` or `running` (partial unique index on source) |
| CrawlSearch | run_id, keyword_id, country, status (`pending`, `running`, then `ok`, `no_results`, `blocked`, `network_error`, `parse_error`, `interrupted` or `skipped`; all rows are inserted as `pending` when the run starts), embedded count, `embedded_has_next`, total result count (if the payload has one), ads found, pages read, `last_has_next`, `stop_reason` (`end_of_results`, `cap` or `no_new_ads`, for `ok` searches); one row per planned search. `ok` means it read to the end of results, to the 100-unique-ad cap, or until 2 non-empty scroll pages in a row brought no new unique ad (empty payloads go to block detection, so a block never ends as `ok`). Has-next comes from `page_info` when present, otherwise from total result count > ads read; `last_has_next` equals `embedded_has_next` when no scroll page was read |
| Ad | `ad_archive_id`, `collation_id`, `collation_count`, page id and name, caption, title, link, landing domain, CTA, media type, start/end date (Pacific), active, `seen_runs`, `seen_days`, `first_seen_date`, `last_seen_date` (crawl days), thumbnail key, parsed JSON |
| AdSighting | ad, run, keyword, country, position, crawl day; unique per (ad, run, keyword, country) |
| Shop | landing domain, page ids, first/last seen, running ad count (ads whose status is "running") |
| NewsFeed / NewsItem | feed URL, enabled / title, link, published at, summary |
| Holiday | date, name, notes |
| Briefing | date, scope (`global` or `keyword`), keyword_id, sections JSON, AI cost, LLM calls made, `ready_at` |
| Suggestion | briefing_id, kind (`idea` or `keyword`), text, reason, evidence links (ads, news) |
| SavedIdea | store_id, source (`ad`, `suggestion`, `manual`), source ref, `via` (`briefing`, `ads`, `manual`), snapshot JSON (with the thumbnail key, never a signed URL), `image_key` (an uploaded image, manual ideas only), title, notes, tags, status, assignee, created_by, created_at, updated_at; unique per (store, source, source ref). A save to several stores creates one row per store |
| Setting | countries, run times, run deadline (morning hard stop, margin before the next slot for manual and `cli` runs, default 25 min, grace before the watchdog closes an overrun run), search budget, max keywords, ads-per-search cap, scroll pages without new ads before a search stops, delays between and inside searches, backoff (base, jitter, quiet time that resets the block streak, block streak and blocked searches per run that stop the run), attempts per search and retry delays, network cool-down (network streak that triggers it, minutes), wait limits (browser start, page load, embedded data, scroll response, thumbnail download, browser close), block threshold (empty payloads in a row), cool-down hours, stale-after days, heartbeat threshold, missed-run grace, briefing build and ready times, briefing job expiry (default 900 s), LLM call timeout, Lark send timeout, profile/proxy slots, AI cap, LLM model |
| RunTimeChange | run times (Asia/Ho_Chi_Minh), effective from, changed by; one row per change, so a past slot is judged by the run times in force then. The first migration seeds the first row with the default run times, effective from install, together with the default settings |
| KeywordDay | keyword_id, crawl day, slot (the `scheduled_for` timestamptz of the run), running ad count; unique per (keyword, crawl day, slot); written by the worker at the end of a scheduled run that ran at least one search and ended without a `run_failed` Alert (manual and `cli` runs, and runs closed by the watchdog or at worker startup, write none), so section 3 compares the same slot and reads past counts instead of recomputing past status |
| ShopDay | landing domain, crawl day, slot (the `scheduled_for` timestamptz of the run, as in KeywordDay), running ad count; unique per (domain, crawl day, slot); written with KeywordDay, for section 4 |
| CrawlerState | rotation cursor, `blocked_until`, last worker heartbeat, the watchdog's last worker restart attempt (`worker_restart_at`) |
| LarkMessage | briefing_id, chat, `uuid`, message id (null until Lark accepts the post), created at; unique per (briefing, chat); the row is inserted before the post is sent |
| Alert | id, kind (`blocked`, `network_error`, `parse_error`, `missed_run`, `run_failed`, `heartbeat_lost`, `briefing_late`, `lark_send_failed`, `settings_invalid`), run_id (nullable), briefing_id (nullable), affected searches, created at, resolved at, Lark message id, sent at, not sent to Lark at (unsent past the 24 h cut-off, §3 "Delivery"). Dedupe: run kinds one per (run, kind), except `network_error`, one per network cool-down, written in the same transaction that increments the run's `network_cooldowns`; `heartbeat_lost` one open incident until a fresh heartbeat resolves it; briefing kinds one per (briefing, kind); `settings_invalid` one per Asia/Ho_Chi_Minh day |

IDs are prefixed nanoids (`store_…`, `idea_…`) and never change. All timestamps are stored in UTC. The
full schema is recorded in ADR 0002 (data model) after the first migration.

## 3. Trend briefing

One briefing per day, ready by 07:00 Asia/Ho_Chi_Minh, built from the data of the last completed
scheduled run: the last scheduled run that wrote its KeywordDay and ShopDay snapshots, so a run stopped
by a block counts and a failed one does not. Every keyword has its own report page with the same
sections filtered to that keyword. The six sections are a starting template, to be adjusted after the
owner reads real briefings.

Sections 1–4 use only ads whose status is "running" (§1 "Measures").

1. **Top trending ads** by trend score, with thumbnail, Ad Library link, page and shop.
2. **Rising new ads**: `first_seen_date` and `start_date` both within the last 3 crawl days (Pacific),
   so an old ad found through a newly tracked keyword does not count as new; ranked by how often they
   appear, then by momentum (below), then by how high.
3. **Hot keywords**: running ads per keyword and the change against the same slot 7 crawl days
   earlier, from KeywordDay.
4. **Rising shops and domains**: running ads per landing domain and the change against the same slot
   7 crawl days earlier, from ShopDay, ranked by that change.
5. **News and upcoming holidays**, with a short AI summary.
6. **AI suggestions**: 5–10 ideas and keywords, each with a reason and links to the ads or news behind
   it, and a "Lưu" button (§6).

Changes in sections 3 and 4 compare snapshots of the same slot, so the 06:30 briefing compares the 01:00
run with an earlier 01:00 run. The latest value is the snapshot of the run the briefing is built from.
The baseline is the last snapshot of that slot on or before 7 crawl days earlier: if that day's run
wrote no snapshot (missed, failed or closed by the watchdog), an earlier day of the slot is used and the
label shows its date. With no such snapshot, the earliest one of the slot is used, shown as "since
<date> (less than 7 days of data)"; with fewer than 2 snapshots of the slot, no change is shown. After a
change of run times, a new slot starts with no history.

Sections 1–4 are SQL and rules, with no AI. Section 5's summary and section 6 come from one LLM call per
briefing, using the aggregated data as input, with at most one retry when validation fails. LLM calls
are counted per briefing in the database: at most 2 per briefing, including calls made before a job ran
again, which does not reset the count. Before each call the count and the estimated cost are written and
committed on their own, so a call cut by a crash still counts. When both calls fail, the briefing is
still made ready (`ready_at`) with sections 1–4, and sections 5 and 6 are stored as "failed: AI" and
shown as in §6. Each briefing (the global one and each keyword report) is built by its own job, the
global one at a higher queue priority; a job expires after 900 s by default (settings). Each call has a
timeout (settings, default 120 s); a call that runs out counts as a failed attempt under the same
one-retry rule, and settings reject a timeout whose two attempts would not fit in one build job's
expiry. Building a briefing is idempotent: sections already stored are kept, so a rerun spends no AI
cost twice, and after a worker restart the build runs again if that day's briefing is not finished. The
call returns JSON that is validated before it is stored. The prompts are in Vietnamese. The call goes to
an OpenAI-compatible endpoint whose base URL and key come from the environment (OmniRoute in
development, a real provider in production); the model name comes only from settings, default Claude
Sonnet 5.5. The global briefing gets its AI sections first, then store-tracked keywords until a daily
cost cap (default USD 3, set by admin), checked with an estimate before every call, retries included. A
skipped AI section is stored as "skipped: cost cap" and shown as in §6 "Special states". Evidence links
must point to ads or news that were in the call's input. Phase 1 has no embeddings, vector database,
chat or image analysis.

### Delivery

- **In app**: briefing page with history by day and by keyword.
- **Lark**: a dedicated Ideas Hub bot app (not the `lark-workspace` app). Each morning it posts a
  summary to the shared group: 3 key points, the top 5, and a link to the app. A store with its own Lark
  chat also gets its per-keyword summary. Each post has a timeout (settings, default 30 s) and carries
  Lark's `uuid` dedupe field (the first 32 hex characters of the SHA-256 of the briefing id and the
  chat; Lark allows 50 characters and sends at most one message per `uuid` within 1 hour), so a retried
  post is not sent twice. The LarkMessage row (with its `uuid` and no message id) is inserted before the
  post; a retry finding that row older than 1 hour without a message id does not post again and writes
  `lark_send_failed`. Alerts sent to Lark carry a `uuid` derived the same way from the Alert id. The
  watchdog also writes `lark_send_failed` when the global briefing has `ready_at` but the shared group
  has no message id by the ready time, which covers retries run out, expired jobs and cancelled ones.
  The bot alerts admin on every Alert (§2): blocks, network cool-downs, parse errors, missed runs,
  failed runs, a lost worker heartbeat, a global briefing not ready by its ready time (`briefing_late`),
  a briefing post that Lark rejected after retries (`lark_send_failed`), and stored settings that fail
  validation, so the scheduler stops scheduling (`settings_invalid`, the problem codes in its detail).
  Alerts are sent by the watchdog (§1), not by the worker, so a dead worker cannot silence them; an
  alert that Lark itself cannot deliver stays visible on the admin alerts page. The watchdog sends only Alerts created in the
  last 24 h; an older unsent one (a backlog written before Lark was configured, or one Lark kept
  rejecting) is marked as not sent to Lark, is never sent later, and stays on the admin alerts page.
- No email in phase 1.

## 4. Accounts, stores and saved ideas

- **Admin**: manages users, stores, memberships, keywords, countries, feeds, holidays, schedule, AI
  budget, and sees every store.
- **Member** (store staff): sees shared research. A member sees only the stores they are assigned to,
  and within each store has ticks:
  - `view`: see that store's ideas and tracked keywords, and the AI sections of reports for the
    keywords the store tracks.
  - `save`: create and edit ideas and change their status.
  - `keywords`: manage the store's tracked keywords and use "Run now" on them.
  - `save` and `keywords` each imply `view`.
- Keyword reports: sections 1–4 come from shared data and anyone can read them. The AI sections of a
  keyword report are visible to admins, for seed keywords to everyone, and otherwise to users with
  `view` on a store that tracks the keyword.
- Admin creates accounts with email and password; no public sign-up and no SSO in phase 1.

### Save-idea flow

1. "Lưu" (save) on an ad card, a grid or briefing row, the ad detail pane or an AI suggestion, or `S` on
   the focused card; or "Ý tưởng mới" (new idea) by hand in the ideas screen: paste a link and/or upload
   an image (JPEG, PNG or WebP, at most 5 MB, §2; a larger file gets "Ảnh lớn hơn 5 MB"), pick stores,
   save.
2. A user with `save` on one store saves at once (1 action). A user with `save` on several stores picks
   them in a popover, pre-checked with the stores in which their last save created an idea, and Enter
   saves (2 actions). Users without `save` on any store do not see "Lưu".
3. Nothing else is asked at save time. The idea keeps a snapshot of its source (thumbnail, caption,
   link, keyword, trend score at save time) and who saved it; its title comes from the ad caption or the
   suggestion text, and notes and tags are added later in the ideas list.
4. After a save, a toast shows "Đã lưu vào {store}" with "Hoàn tác"; for a user with `save` on 2 or more
   stores it also shows "Thêm store khác", which reopens the store popover. "Hoàn tác" within 10 s (the
   server accepts it up to 15 s after the save and then answers "Đã quá thời gian hoàn tác") deletes the
   ideas this save created, never one the store already had; afterwards a "Đã có sẵn · Mở" link that
   pointed to an undone idea opens a 404 page.
5. Saving a source that the store already has creates no copy: the result per store is "Đã lưu"
   (created) or "Đã có sẵn · Mở" (already saved, with a link that opens it). Manual ideas with only an
   image are not deduplicated. Each idea records whether it was saved from a briefing, from the ad
   views, or by hand.
6. Status: New → Picked → Done, or Dropped, changed by users with `save` on the store, from the table's
   status menu (2 actions) or on the Kanban board (§6); optional assignee (a member of that store).
7. The list filters by status, tag, keyword, assignee and text, and exports CSV.

## 5. Integration (design only in phase 1)

- Cross-app keys: email for users; `erp_store_code` and `pod_studio_store_id` for stores.
- Draft contract `docs/contracts/ideas-hub-v1.md` (written during phase 1, agreed with both sides
  before phase 2) covers: (1) Ideas Hub pushes a saved idea to POD Studio through POD Studio's REST tool
  API with a personal access token; (2) other apps read briefings and ideas through Ideas Hub
  `/api/v1` with scoped personal tokens.
- Phase 2: sign-in through the ERP's Keycloak SSO, with store scope from `store-<code>` groups matched
  to `erp_store_code`. Existing email/password accounts are linked by email.
- Phase 1 does not share a database with POD Studio or the ERP. Changing that later needs a new ADR.

## 6. UI and UX

The UI design comes from the owner's UI/UX interview of 2026-10-19 (8 rounds). The UI calls the product
VET Ideas. It is a dense, desktop-first workbench with the look of POD Studio, built for one morning
flow: open the Lark link, read today's briefing, scan ads, save ideas to a store in one or two actions.
When looks and ease of use conflict, ease of use wins.

### Principles

1. The morning flow first: Lark link → briefing → ads → save. Every other screen supports it.
2. Fewest actions, an action being one mouse click, one drag or one key press: a Lark link opens the
   briefing with 0; a save takes 1 with one store and 2 with several; opening an ad's detail takes 1;
   changing an idea's status from its menu takes 2, and a keyboard move on the Kanban board at most 2
   plus the columns it crosses; title, notes and tags are edited later, never asked at save time.
3. Dense but calm: a workbench, not a magazine. Numbers are tabular, labels short, and color is kept for
   state; the primary action is ink.
4. Never color alone: every state, change and status pairs its color with text, an arrow or an icon.
5. Same family as POD Studio: its `tokens.css` copied unchanged and Geist, so both apps can later share
   one design system.
6. Honest data: every change shows its baseline; missing data says why and when it will come.

### Users, devices and language

- Users: admin, and members with the per-store ticks of §4. They open the app every morning after 07:00
  Asia/Ho_Chi_Minh from the Lark post, and now and then for deeper research during the day.
- Desktop and laptop first (≥ 1280 px). On a phone opened from Lark, reading the briefing and saving
  ideas work fully; admin pages only need to stay usable (tables may scroll sideways).
- One UI language, Vietnamese, with no switcher. Seller terms stay in English: Ads, Shop, Keyword, Trend
  score, Run, Briefing, POD, CTA and the country codes. Ad status labels are Vietnamese ("Đang chạy",
  "Ngoài top", "Đã dừng hoặc chưa rõ"); stored values stay English. Every UI string lives in one
  dictionary module, `apps/web/src/lib/strings.vi.ts`; there is no i18n library.

### Visual direction

Direction B, the workbench, chosen by the owner from three mock-ups (A editorial, B workbench, C dark
keyboard feed), without an editorial lede: the briefing opens straight on KPI tiles and panels.

- Layout: a dark left sidebar 248 px wide, collapsed to 60 px by a toggle button whose state the browser
  remembers, as in POD Studio, with nav groups; content on the warm app background, panels on white
  surfaces. The sidebar background is `--ih-sidebar-bg` (ink `#1c1917`), its text `--ih-sidebar-fg`
  `#e7e5e1` (13.9:1) and its group labels `--ih-sidebar-fg-muted` `#a8a29e` (6.9:1); the active item has
  the surface background with ink text (17.5:1), and the focus ring inside the sidebar is
  `--ih-sidebar-focus` `#ffffff` (17.5:1), since an ink ring would not show on ink. Everything inside
  the sidebar, the store switcher, badges and hover included, uses only `--ih-sidebar-*` tokens: hover
  `--ih-sidebar-hover-bg` `#292524` (sidebar text 12.1:1 and labels 6.0:1 on it), badges
  `--ih-sidebar-badge-bg` `#44403c` with white text (10.3:1). On a phone the sidebar becomes a bottom
  tab bar.
- Light theme only in phase 1, as in POD Studio.
- Tokens: POD Studio's `apps/web/src/styles/tokens.css`, copied unchanged (names, values and media
  queries; POD Studio is only read) and mapped to Tailwind v4 `@theme` names as in POD Studio's
  `theme.css`. Values this section relies on: app background `#f7f6f4`, surface `#ffffff`, selected
  `#f1efec`, border `#e7e5e1`; text `#1c1917`, secondary text `#44403c` (10.3:1 on white), muted text
  `#75706a` (4.9:1 on white, 4.5:1 on the app background, only 4.3:1 on selected, so text on a selected
  row uses secondary text, and muted text in a menu item highlighted with shadcn's `accent` uses
  `--vet-text`), faint `#a8a29e` for decoration only; ink `#1c1917` (hover `#44403c`, white text on
  ink); success `#15803d` on `#dcfce7`, warn `#8a5300` on `#fef3dc`, neutral `#44403c` on `#f1efec`;
  radius 6 px for controls, 12 px for cards and panels, 999 px for pills; focus ring in ink (white
  inside the dark sidebar). Spacing on a 4 px base, 12 px panel padding, 10–12 px grid gap.
- Action color: brand red `#dc2626` only for the logo, by POD Studio's rule ("not a status and not an
  action colour"); "Lưu" and the selected card outline use ink, and the active nav item ink text on the
  surface background.
- Ideas Hub tokens live in their own file, `apps/web/src/styles/ih-tokens.css`, with the `--ih-` prefix,
  never a `--vet-` name: `--ih-chip-running-fg` and `-bg` (POD's success pair),
  `--ih-chip-out-of-top-fg` and `-bg` (POD's warn pair, `#8a5300` on `#fef3dc`), `--ih-chip-stopped-fg`
  and `-bg` (POD's neutral pair), each pointing at the `--vet-` value; `--ih-series-1` `#2a78d6`,
  `--ih-series-2` `#eb6834` and `--ih-series-3` `#c2369b` for chart series; the sidebar tokens above;
  `--ih-field-border` `#8a847d` (3.70:1 on white, 3.42:1 on the app background, 3.22:1 on selected) for
  inputs whose border is their only edge, since POD's borders (`#e7e5e1`, `#d6d3d1`) are below the 3:1
  of WCAG 1.4.11.
- Type: Geist, and Geist Mono for ids and numbers in tables, from the `geist` package through
  `next/font/local`; its variable fonts cover Vietnamese. Sizes from POD Studio's tokens: body 14 px,
  table 13 px, mono 12.5 px, label 12 px, small label 10.5 px, page title 24 px, KPI value 28 px, line
  height 1.45; at 820 px and below, page title 20 px and KPI value 22 px; tabular numbers.
- Motion: CSS transitions only, with POD Studio's durations: 220 ms ease-out for hover, popovers, sheets
  and panels, 180 ms for the sidebar, never over 220 ms; all 0 s under `prefers-reduced-motion`, as POD
  Studio's tokens set them. shadcn's Sheet and sonner, whose own defaults are longer, are overridden in
  `components/ui` to stay within 220 ms. Icons: lucide-react at 16 px, always with a text label or an
  `aria-label`.

### Screens and navigation

After sign-in the default page is today's briefing. A Lark link opens exactly the page it names.
Sessions keep better-auth's defaults: a session expires 7 days after it was last extended and is
extended at most once a day while in use, so someone who opens the app every morning is not asked to
sign in again. A full page load passes through `proxy.ts`, whose session check extends the session and
writes the cookie; soft navigations (requests with `RSC: 1`) do not extend it (`nextCookies()`), and
server components read the session without extending it. Filters and sort live in the URL query, so a
pasted link shows the same view.

| Nav group | Screen | Route | Who |
|---|---|---|---|
| none | Sign in | `/login` | everyone |
| Main | Briefing today and history by day | `/briefing`, `/briefing/[date]` | all |
| Main | Ads grid with filters and detail pane | `/ads`, `/ads/[id]` (a direct link opens the pane) | all |
| Main | Shops: list, and shop page with chart | `/shops`, `/shops/[domain]` | all |
| Main | Keywords: list, and keyword report (sections 1–4, AI sections as §4 allows) with chart and Run now | `/keywords`, `/keywords/[id]`, `/keywords/[id]/[date]` | all; Run now with the `keywords` tick |
| Main | Ideas per store, as a table or a Kanban board | `/ideas?store=…&view=table\|board` | members with `view` on the store; admins |
| Main | Run log (manual runs shown as "manual" to non-admins) | `/runs` | all |
| "Quản trị" | Alerts | `/admin/alerts` | admin |
| "Quản trị" | Users, stores and members (ticks), seed keywords, feeds, holidays, settings | `/admin/…` | admin |

- Sidebar: Briefing (with a date badge), Ads, Shop, Keyword, "Ý tưởng" (with the count of New ideas in
  the selected store) and Run log; the "Quản trị" group for admins only; a store switcher at the bottom
  that lists only the user's stores (admins: all).
- Global search: a Ctrl+K (⌘K on a Mac) command menu over ads (caption, page, domain), shops, keywords
  and screens. It matches with case-insensitive `ILIKE` on the ad caption, page name and landing domain,
  with `%`, `_` and `\` in the input escaped (`ESCAPE '\'`), backed by `pg_trgm` GIN indexes; it starts
  at 3 characters, sorts by `similarity()` descending and then by last seen, and shows at most 5 results
  per group; the screens group lists only screens the user may open.

### Core interactions

- Save: "Lưu" on any ad card, row, detail pane or AI suggestion, and `S` on the focused card. A card is
  one link that covers it, with "Lưu" a separate button above the link, never inside it, so no control
  is nested in another. With `save` on one store it saves at once (1 action) and shows a toast "Đã lưu
  vào {store}" with "Hoàn tác" (undo within 10 s; the server accepts it up to 15 s after the save, then
  answers "Đã quá thời gian hoàn tác"); with `save` on several stores a popover lists them, pre-checked
  with the stores in which the user's last save created an idea, and Enter saves (2 actions), with a
  result per store: "Đã lưu" or "Đã có sẵn · Mở". The toast after a save from the popover also offers
  "Thêm store khác", which a user with `save` on one store never sees. Users without `save` on any store
  do not see "Lưu". The rules are in §4 "Save-idea flow".
- Ads: three columns, a filter rail (200 px), the card grid and a sticky detail pane (360 px). Click or
  Enter on a card fills the pane (1 action); arrow keys move the selection, and while a card has focus
  `S` saves and `O` opens the Ad Library link in a new tab; neither key acts while typing in a filter
  field (WCAG 2.1.4). Below 1280 px the pane becomes a right sheet, on a phone a bottom sheet.
- Briefing: a KPI row from the briefing's source run: running ads (the source run's `running_ads`: ads
  running under §1 "Measures" after its upserts), their change against the `running_ads` of the same
  slot 7 crawl days earlier under the baseline rule of §3, the baseline being the run of that slot that
  wrote KeywordDay, searches ok in the run (`ok_searches` ÷ `planned_searches` as a percentage, the
  success of AC 1) and days to the next US holiday; then panels: top trending ads, rising new ads and AI
  suggestions on the left; hot keywords, rising shops, and news and holidays on the right. Rows show the
  thumbnail, page · keyword, domain · country · days, the score and "Lưu"; clicking a row opens the ad
  pane as a sheet, and a save from that sheet sets `via = briefing`. Each briefing names its source run
  ("Từ run 01:00 ngày 19/10"). Before today's global briefing is ready, `/briefing` shows the latest
  ready briefing with its date ("Đang hiển thị briefing ngày 18/10; bản hôm nay sẽ có trước 07:00");
  after the ready time the Briefing late state applies.
- Ideas: one screen with a toggle between a table (tabs New / Picked / Done / Dropped, an inline status
  menu, the filters and CSV export of §4) and a Kanban board with the same four columns. Cards in a
  column are sorted by `updated_at`, newest first; there is no position field, so a drop sets only the
  status. Dragging a card to any column sets that status, backwards included (Done back to New), the
  same moves the status menu allows; every card also has a status menu (2 actions: open it, pick a
  status) and keyboard moves (with a card focused, Space picks it up, ← or → moves it one column, Space
  drops it: at most 2 actions plus the columns crossed; the card keeps its vertical position (y),
  clamped inside the column's visible area, so the page never scrolls, and ↑ and ↓ do nothing), so
  dragging is never the only way (WCAG 2.2 SC 2.5.7). A member with only `view` on the store sees the
  table and the board without status menus and the board without drag (§4: changing a status needs
  `save`). The toggle is remembered per user in local storage, table by default. "Ý tưởng mới" adds a
  manual idea.
- Run now: on a keyword page, for admins and for users with the `keywords` tick on a store that tracks
  the keyword. When §1 refuses a run, the button stays visible but disabled, with the reason ("Đang có
  run khác", "Crawler đang nghỉ đến 14:20", "Không còn đủ thời gian trước ca 13:00").
- Keyword and shop tables sort by any column on the server, with the sort in the URL.

### Charts

- Changes are signed numbers with an arrow: a rise in POD's success color (`--vet-success`, "+71% ▲"), a
  fall in secondary text (`--vet-text-secondary`, "−6% ▼"), never red; always next to the baseline label
  of §3.
- Each keyword page (from KeywordDay) and shop page (from ShopDay) has a line chart of running ads per
  day, one series per slot. The x-axis is the slot's date in Asia/Ho_Chi_Minh, the date of the run's
  `scheduled_for` (not the Pacific crawl day of §1). A day without a snapshot is a gap in the line,
  never a zero or an interpolated point. Series colors are fixed by slot order: slot 1 `--ih-series-1`
  `#2a78d6`, slot 2 `--ih-series-2` `#eb6834` (checked for color-vision deficiency), and a third slot
  after a change of run times the next one, `--ih-series-3` `#c2369b`, never a cycled hue. Color-vision
  check of the three (Machado simulation, ΔE76): protanopia series 1–3 about 20, tritanopia series 2–3
  about 24, every other pair at least 41; the legend and line-end labels carry the rest. Brand red and
  status colors are never series colors; axis labels and values are in ink.
- 2 px lines, markers of at least 8 px on hover, one y-axis from 0, a recessive grid, a legend plus
  labels at the line ends, and a crosshair tooltip with date, slot and count; "7 ngày trước" is a dashed
  vertical rule, not a series. Range 30 days by default (14 / 30 / 90 / all); a "Bảng" toggle shows the
  same data as a table. Built with the shadcn chart component (Recharts).

### Special states

| State | Display | When |
|---|---|---|
| No data yet | an empty panel with one sentence and the next run time, e.g. "Chưa có run nào xong. Run kế tiếp: 13:00" | no completed scheduled run |
| Less than 7 days | baseline label "từ 15/10 (chưa đủ 7 ngày dữ liệu)"; with fewer than 2 snapshots "—", and the chart shows "Cần thêm dữ liệu" | §3 baseline rule |
| Briefing late | amber banner "Briefing hôm nay chưa sẵn sàng, đang hiển thị bản 18/10" with "Xem lại" | today's global briefing has no `ready_at` after the ready time |
| Before the ready time | the latest ready briefing with "Đang hiển thị briefing ngày 18/10; bản hôm nay sẽ có trước 07:00" | today's global briefing not ready yet, before the ready time |
| AI section skipped | "Bỏ qua: đã hết hạn mức AI hôm nay"; sections 1–4 still shown | §3 "skipped: cost cap" |
| AI section failed | "Chưa tạo được phần AI hôm nay"; sections 1–4 still shown | §3 "failed: AI" after 2 failed LLM calls |
| Ad status | chips "Đang chạy" (green), "Ngoài top" (amber), "Đã dừng hoặc chưa rõ" (gray), each with a tooltip that explains the rule | §1 "Measures" |
| Missing thumbnail | a gray tile with the media-type icon and "Chưa có ảnh", never a broken image | thumbnail not downloaded, or the image fails to load (`onError`) |
| Loading | skeletons with the real layout, no spinners | route `loading.tsx` |
| No permission | 404, the same as a page that does not exist, so a member cannot probe other stores; a disabled action states its reason | §4, AC 4 |
| Crawler attention (admin only) | a bar in POD's warn colors (`--vet-warn` on `--vet-warn-bg`) linking to Alerts | `blocked_until` in the future or an Alert not marked "Đã xử lý" (`resolved_at` empty) |

### Roles

- Admin: everything, the "Quản trị" group, the crawler attention bar, and who triggered manual runs.
- Member: shared research (briefing, ads, shops, keywords, sections 1–4 of every keyword report, the run
  log without triggers); ideas, tracked keywords and AI sections only as §4 allows; "Lưu" only with
  `save`; Run now only with `keywords`. Any other page returns 404.

### Phones (≤ 820 px, POD Studio's mobile breakpoint)

- Bottom tab bar (Briefing, Ads, Shop, Keyword, "Ý tưởng", "Khác"); "Khác" leads to the Run log and, for
  admins only, "Quản trị"; the store switcher moves to the header of the "Ý tưởng" screen.
- Briefing: KPI tiles 2 × 2 and panels stacked in the desktop order; rows at least 44 px high and
  targets at least 24 px, so "Lưu" stays reachable.
- Ads: a two-column grid, filters in a sheet, and the detail as a bottom sheet with "Lưu" pinned at the
  bottom.
- Ideas: the table becomes cards; the board becomes one column per status with a status menu and no
  drag.
- Admin pages stay usable; tables scroll sideways.

### Libraries

A UI library is added only where a requirement in this section needs it. The list, and the libraries
left out, are in ADR 0001 ("UI libraries"); thumbnails reach the browser through the signed URLs of §2,
as WebP from `next/image`. Strings that libraries show in English by default (shadcn's screen-reader
"Close", dnd-kit's announcements, sonner's close button) come from the string dictionary, and the page
is `<html lang="vi">`.

## Hosting

- Development: everything on the owner's Windows machine (residential IP). Postgres and MinIO run in
  Docker; the app and the worker run natively.
- Internal production: moves to the Linux desktop that already hosts POD Studio once phase 1 is ready
  for real users. Ideas Hub gets its own ports, database, services and Cloudflare tunnel hostname. A trial
  run on that machine comes before the switch.
- The worker is a separate process that takes jobs from the database queue, so it can later move to
  another machine or behind a proxy without changes to the web app. It works the crawl, the briefing
  build and the Lark posts as three queues in parallel, one job at a time in each, so a manual run never
  holds up the briefing. Its scheduler keeps the run rows and their jobs 14 days ahead, sends each day's
  briefing jobs to start at the build time, and applies a settings change within 1 minute by rewriting
  future rows and sending their jobs again; the web app writes settings and Run now rows.
- The watchdog runs from the OS timer (systemd timer on Linux, Task Scheduler on Windows), not from the
  worker, and restarts the worker service when it closes a hung run or finds the worker hung while idle.
  A host that is fully down is noticed only when it comes back.

## Acceptance criteria

Phase 1 is done when all of these hold:

1. 14 consecutive days of scheduled runs on the internal production machine, with ≥ 90% of planned
   keyword × country searches succeeding (`ok` or `no_results`). Planned searches are summed over the
   scheduled run rows of the 14 days (`trigger = schedule`). The scheduler writes them at least 14 days
   ahead, and the watchdog writes a `missed` row, or a `stopped` row when the slot fell inside a
   cool-down, for any slot of the run times then in force that has none, so every slot has a row even
   when the worker is down. A row that never started (`missed`, or still `scheduled` after its slot)
   counts all its `planned_searches` as failed, and so does a slot closed because `blocked_until`
   covered it (all its searches `skipped`). `interrupted`, `blocked`, `network_error`, `parse_error` and
   `skipped` searches are failures. Every run with a `blocked` or `parse_error` search has an Alert of
   that kind with a Lark message id, and every run has as many `network_error` Alerts as its
   `network_cooldowns` count, each with a Lark message id.
2. Every search reads both the embedded ads and the scroll pages. In production data (`interrupted`
   searches excluded, since AC 1 already counts them), every `ok` search has embedded ads; every `ok`
   search whose embedded data signals a next page read at least one scroll page; and every `ok`
   search that stored fewer than 100 unique ads ended with no next page, or stopped by the 2-page rule
   with `stop_reason = no_new_ads`. The plan's Step 1 probe confirms that the embedded data carries
   such a signal; if it does not, this criterion is revised before the crawler is built. Ads are
   deduplicated by `ad_archive_id`. Tests check `days_active` against the verified examples
   (Crocoblock 9–27 Oct 2025 = 19, Alibaba.com
   2 Mar–2 Jun 2026 = 93).
3. The global briefing is ready before 07:00 Asia/Ho_Chi_Minh on at least 13 of the 14 days, with all 6
   sections generated (none skipped or failed), and posted to Lark. Every AI suggestion links to its
   evidence. AI spend stays under the daily cap. Keyword reports have no deadline.
4. Permission tests pass: a member of store A cannot see store B's ideas, which keywords B tracks, or
   the AI sections of reports for keywords that only B tracks; an admin sees all of them. Keyword text
   and sections 1–4 of keyword reports stay visible to everyone.
5. Saving an idea works from an ad, from a suggestion and by hand. Saves are deduplicated per store,
   and the list exports to CSV.
6. Usage: during those 14 days (by `created_at`), non-admin staff save at least 30 ideas from briefings,
   at least 10 in each of at least 2 stores. Ideas are counted per store row, so one save to two stores
   counts once in each.
7. UX (§6). `@axe-core/playwright` reports no serious or critical violation on every main screen (sign
   in, briefing, ads with the detail pane, shop, keyword report with chart, ideas table and board, run
   log, admin settings); every flow works by keyboard alone, focus is always visible, text and UI
   contrast meet WCAG 2.2 AA, targets are at least 24 × 24 px, and ideas can change status without
   dragging. Counted in e2e tests, one action being one mouse click, one drag or one key press: a Lark
   link opens the briefing with 0 actions on a valid session; a save from the briefing or the ads grid
   takes 1 action with one store and 2 with several; opening an ad's detail takes 1; changing an idea's
   status from its menu takes 2, and a keyboard move on the board at most 2 plus the columns crossed.
   The briefing's median LCP over 5 loads with a warm cache in one browser context, at 1440 px from a
   client on the development PC through the Cloudflare tunnel of the Linux trial, is under 2.5 s;
   thumbnails are WebP, 320 px wide and at most 40 KB at 1x, at most 640 px wide and 90 KB at 2x
   (`w=640` requested), each lazy-loaded below the first viewport. Playwright screenshots of 6 screens
   (briefing, ads with the pane, keyword report with chart, ideas table, ideas board, sign in) at 1440
   and 390 px, from fixed seed data with a frozen clock, match baselines the owner approved, with at
   most 1% of pixels different (`maxDiffPixelRatio` 0.01); each special state of §6 has a seeded fixture
   and at least one screenshot. No UI string is hard-coded outside the string dictionary (lint check).

## Out of scope for phase 1

Toidispy crawling; Facebook accounts and proxies (slots only); Etsy and Google Trends adapters; email;
idea approval step; SSO; calls to POD Studio or the ERP; embeddings, chat, image analysis; video
download; storing raw HTML; a dark theme, a second UI language, a native app or PWA install.

## Open items

- Legal review of collecting from the Ad Library web UI (research doc, "Still open"), including
  downloading and storing ad thumbnails.
- Owner creates the Ideas Hub Lark bot app and the shared group; the credentials go into the secret
  store, not the repo.
- Initial RSS feed list and the seed keyword list.
- Block rate with 4 countries and 2 runs a day is unknown; the budget and delays above are starting
  values to tune from run logs.
- Whether Ad Library result order follows impressions (research doc): if confirmed, position becomes a
  trend signal.
- Owner decision with legal review: solving captchas by hand, as ttwatch does (show the browser
  window, wait a few minutes for a person, then a cool-down after giving up). It needs a persistent
  browser profile, which goes against the fresh-profile decision; phase 1 treats a captcha as a block.
- Owner decision, not in phase 1 yet: threshold-based trend alerts. Sparklines are not built in
  phase 1 either. Time-series charts of running ads per keyword and per shop are in phase 1 (§6
  "Charts").

## Delivery order

Riskiest first, as in the reviewed plan [docs/plans/ideas-hub-phase-1.md](../plans/ideas-hub-phase-1.md)
(2026-10-19; approved at Gate 0, 2026-10-20):

1. A throwaway probe measures the Facebook block rate while the repo skeleton, schema and core rules
   (days_active, crawl day, trend score, permissions) are built.
2. Facebook Ad Library adapter and worker: schedule, limits, block handling, thumbnails.
3. A 3–5 day measurement, the crawler ADR, and a SQL-only preview of briefing sections 1–4 for the
   owner.
4. Web app, auth and admin screens.
5. Research views, keyword reports, save-idea from ads and by hand.
6. RSS, holidays, AI sections, Lark delivery, save from suggestions.
7. Contract draft, Linux desktop trial, staff onboarding, then the 14-day acceptance run.
