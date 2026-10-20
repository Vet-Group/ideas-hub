# Plan: Ideas Hub phase 1 implementation

Status: **approved at Gate 0 (2026-10-20), v18g** (v2 consensus of Architect SOUND WITH CHANGES and
Critic APPROVE WITH
IMPROVEMENTS, the owner's review of 2026-10-19, a spec–plan consistency pass, the MAJOR and selected
MINOR findings of the v4 Critic review, the rest under "Open items", and the owner's follow-up on run
rows, staleness and pagination; v8: empty payloads vs the 2-page rule, run-row upkeep, backoff and
delays, browser modes, keyword snapshots; v9: backoff limits, resistance signals, per-slot keyword and
shop snapshots; v10: transient retries, bounded waits, heartbeat cadence, neutral 2-page stops; v11:
`network_error`, idle heartbeat, search vs run errors; v12: block and network streaks, 10 min network
cool-down, browser start limit; v13: per-cool-down Alert test, Playwright launch timeout; v14: v13
Critic findings: Run now vs slots, `network_cooldowns`, hung runs, run status, timeline; v15: thumbnail
cap, idle-hang restart, 750 s bound, `cli` trigger; v16: v15 Critic findings: crash recovery, 25 min
margin, guarded writes, briefing heartbeat, scheduled-run briefing; v17: v16 Critic findings: guarded
run start, queue model, crawl-only heartbeat, 06:05 hard stop; v17b: start condition on CrawlerState,
queue policies, retry limits, `crawl.run` expiry; v17c: stored deadlines, startup job cleanup, Lark
`uuid`, per-briefing jobs, scheduler owns re-sends; v18: UI and UX from the owner's UI/UX interview,
spec §6 and AC 7; v18b: signed thumbnail URLs, save toast, Kanban moves, Ctrl+K search, better-auth
session defaults, `react-is`; v18c: v17c Critic findings: manual and `cli` rows, slot key, crash
recovery, settings checks, briefing keys and priority, job signals, LLM failure, Lark dedupe, watchdog
lock; v18d: v18b Critic findings and owner decisions D1–D5: POD tokens, ink actions, action count,
session refresh, image sizes, idea uploads, Run now placement, KPI counters; v18e: v18d Critic findings
and owner decisions O1–O5: upload route, keyboard Kanban, font and color wiring, dark sidebar,
Playwright 1.63.0 pin; v18f: v18e Critic findings: proxy matcher, shadcn color names, upload route
rules, chart dates, and owner decisions on `running_ads` and the keyboard drop point; v18g: v18f narrow
Critic findings: shadcn `white` and `black`, one size-refusal message, the `(app)` route group, upload
route details, notify polling, KeywordDay `slot`). Planning only: no code, no commit.
Inputs: `docs/specs/phase-1.md` (canonical spec), `docs/adr/0001-stack.md` (accepted),
`docs/research/2026-10-19-sources-and-crawlers.md`.

## Requirements summary

Phase 1 delivers a logged-out Facebook Ad Library browser crawler on a schedule with limits and block
handling (spec §1); RSS and holiday sources; shared vs per-store data (§2); a daily 6-section briefing
and per-keyword reports with LLM sections and Lark delivery (§3); admin/member accounts with per-store
ticks and the save-idea flow (§4); cross-app keys and a draft contract (§5); a desktop-first Vietnamese
UI built for the morning flow Lark link → briefing → ads → save (§6). Everything runs on one
residential-IP machine. Done = the 7 acceptance criteria in the spec.

## RALPLAN-DR summary

### Principles
1. Riskiest unknown first, at the lowest cost that answers it.
2. One vertical slice at a time; each step ends in an automated check, and from Step 4 on in something
   the owner can read.
3. Domain rules (days_active, crawl day, trend score, permissions) live once in `packages/core`, unit
   tested; store-scoped queries cannot be called without an access scope.
4. No shared database or calls to other apps in phase 1; keys and contract only.
5. Smallest stack that meets the spec; every deferral is named.

### Decision drivers (top 3)
1. Unknown Facebook blocking at 4 countries × 2 runs/day, measured on the IP and browser mode that
   production will use.
2. The 14-day acceptance run needs the whole system on the Linux desktop, so calendar time matters.
3. Adoption risk: staff use (AC 6) and the owner's reading of real briefings must start early.

### Options
- **A. Spike first, then crawler-first slice (chosen).** A throwaway probe measures block rate in 2–3
  days while the skeleton is built; then the real adapter, a SQL-only briefing preview, web/auth, views,
  AI/Lark.
  - Pros: cheapest answer to driver 1; real data for every screen; the owner reads briefing sections
    1–4 from week 3.
  - Cons: the probe is thrown away; no login screen for about two weeks.
- **B. Crawler-first without a spike (plan v1).** Build pg-boss/MinIO/upsert before measuring.
  - Cons: production plumbing before the cheapest test; the first briefing comes late (Architect
    antithesis).
- **C. Platform-first (spec v1 delivery order).** Auth and admin first.
  - Cons: UI on fake data, and weeks lost if logged-out crawling fails.
- Stack alternatives (Python worker, Crawlee, Frappe) are settled in ADR 0001, not here.

## Gate 0 (owner, before any code)

1. Approve ADR 0001 (status → accepted) or request changes. Decided 2026-10-20: approved, ADR 0001
   accepted.
2. Approve this delivery order (it replaces spec v1 "Delivery order"; the spec is already updated).
   Decided 2026-10-20: approved.
3. Git remote: private GitHub repo name; whether the current docs become the first commit. Decided
   2026-10-20: private repo `anhtahaylove/ideas-hub`; the current docs are the first commit (c687ad8).
4. Legal review: decide whether it must finish before the 14-day run (recommended: yes). Decided
   2026-10-20: yes, it must finish before the 14-day run starts.

Owner inputs needed later, as step prerequisites: seed keyword list (Step 1, the Vietmakers list as a
draft), RSS feed list (Step 7), Lark bot app, shared group and test group (Step 7), staff names for
onboarding (Step 8).

## Implementation steps

Every step ends with `pnpm -r typecheck && pnpm -r lint && pnpm -r test` green and one or more English
commits. Paths are planned (greenfield). Estimated calendar from Gate 0 approval: about 11 weeks to the
end of the 14-day run. The UI work of spec §6 adds about 16.25 days to Steps 5–7: 5 in Step 5 (tokens,
theme and fonts 0.5, shell and Ctrl+K menu 1.5, sign-in and the test harness 1; from v18d: session
refresh and its test 0.5, `proxy.ts` and callback checks 0.25, Ctrl+K escaping, order and screen filter
0.25, library strings and lint 0.25, focus, non-text contrast and target checks 0.5, resolving Alerts
0.25), 8.25 in Step 6 (three-column ads 1, thumbnail route 0.5, charts 1, Kanban with keyboard moves 1,
save popover and undo 0.5, states and baselines 1; from v18d: idea image upload and route 0.75, Run now
with its three reasons 0.5, thumbnail key checks 0.25, server undo check and view-only board 0.5; from
v18e: Kanban keyboard `coordinateGetter` 0.25; from v18f: the upload route's limits, origin checks and
cleanup, shadcn color and font checks, sidebar and chart-date tests 1) and 3 in Step 7 (briefing layout
1, its states and baselines 1; from v18d: KPI from the run counters 0.5, latest ready briefing and
source-run label 0.5). Step 5 ends around day 33 (28 + 5), Step 6 around day 49 (35 + 5 + 8.25 = 48.25,
rounded up) and Step 7 around day 59 (42 + 16.25 = 58.25, rounded up), in week 9; one day reserved to
fix the briefing LCP, the 2-day Linux re-check and the 14-day run add 17 days, so the run ends around
day 76 (59 + 17), in week 11, instead of day 75 (v18e), day 74 (v18d), day 68 in week 10 (v18c) and day
58 in week 9 before the UI work.

### Step 1. Block-rate probe (throwaway, days 1–3)
- `spikes/fb-ad-library-probe/probe.ts`: plain Playwright script, system Chrome, fresh profile; reads the
  embedded 30 ads and `AdLibrarySearchPaginationQuery` pages; spec delays (between and inside
  searches), backoff and limits; writes JSONL per search (keyword, country, embedded_count, pages_read,
  ads, outcome, empty payloads, backoff waits, attempts and wait-limit hits, and timings: page load,
  each scroll response, total), and whether timeouts come together with other block signs (empty
  payloads, captcha, login wall) in the same run, so the `network_error` rule can be revisited.
- Runs in three browser modes on 10 keywords × 4 countries for a small sample: headed, headed with the
  window off-screen (`--window-position=-32000,-32000`, with `--disable-background-timer-throttling`,
  `--disable-renderer-backgrounding` and `--disable-backgrounding-occluded-windows` so the hidden
  window is not throttled), and headless. Then twice a day in the mode production will use. Saves 4
  anonymised fixtures (embedded script excerpt, two GraphQL pages, a "no results" page) for parser
  tests.
- Verifies two assumptions and records the answer in the JSONL and the Step 4 report:
  - The embedded HTML data carries a has-next-page signal (`page_info`/`end_cursor`), or a total result
    count from which has-next is derived (total > ads read). AC 2 depends on one of them; if neither
    exists, stop and revise AC 2 before Step 3. Also record whether scroll pages repeat ads already read
    and how often a search would stop by the 2-page rule with a next page left; this decides whether
    that stop signals blocked to the backoff (spec §1 "Backoff").
  - Thumbnail CDN URLs expire: re-fetch the image URLs of one run after 24 h and 72 h, and note any
    expiry parameter in the URL.
- Exit: JSONL from ≥ 4 runs and both answers recorded; the browser mode chosen for production recorded
  with the blocks seen in each mode; the measured page-load and scroll times replace the assumptions of
  the run-time estimate in spec §1, the wait limits are tuned from the observed hits, and the backoff
  starting values are kept or changed from the observed blocks. Deleted after Step 4's crawler ADR.
- Progress (2026-10-20): sample done in all three modes, 4 runs and 122 searches, 0 blocks; results,
  the payload findings and the schedule in `docs/research/2026-10-20-fb-probe.md`. Decisions, with
  reasons:
  - Both assumptions answered: the embedded connection carries `page_info.has_next_page` and a total
    `count`, so AC 2 stands; thumbnail URLs carry `oe=<hex Unix seconds>`, about 4 days ahead. No scroll
    page repeated an ad and no search stopped by the 2-page rule, so that stop stays neutral.
  - Production mode: headed with the window off-screen (0 blocks in every mode; off-screen is the real
    headed browser without a visible window, and its 3 scroll timeouts were all recovered; headless
    had 6 and the only 2 failed searches, a truncated embedded script). Recorded with the blocks per
    mode in the research doc; the worker's default `IDEAS_HUB_BROWSER_MODE` is `offscreen`.
  - Measured page-load and scroll times replace the spec §1 run-time assumptions (spec and risk row
    updated); wait limits and backoff starting values kept, since no hit was a slow answer and no
    block was seen (reasons in the research doc).
  - The off-screen sample's first run was ended from outside after 29 searches (exit `0x40010004`); its
    remaining 11 ran with a new `--skip` option, and every later run goes through `keep-awake.ps1`.
  - 41 seed keywords in `packages/db/seed/seed-keywords.json` ("anniversary gift" became "anniversary
    gift shirt").
  - Twice-daily runs (01:00 and 13:00 to 2026-10-22) and the 24 h and 72 h thumbnail re-fetches run as
    the Windows tasks `IdeasHub-Probe-*` from the worktree `C:\Users\User\dev\wt\ideas-hub-probe`.
  - Exit: JSONL from 4 runs and both answers recorded, the mode choice, the measured times and the
    tuning decisions are done; the 3 days of data at the production mode (6 scheduled runs) and the
    re-fetch results are pending: scheduled runs.

### Step 2. Skeleton, schema and core rules (days 1–5, parallel with Step 1)
- `package.json` (pnpm, `engines.node` `^22.12.0 || ^24 || >=26`, run on Node 24, exact versions
  pinned per ADR 0001; when pinning better-auth, re-check the telemetry gating in the pinned
  `@better-auth/telemetry` and `@better-auth/core` as ADR 0001 describes; `pg` and `zod` declared
  directly and pinned, since Drizzle's `node-postgres` driver calls `pg` and the app validates LLM
  output with `zod`),
  `pnpm-workspace.yaml`, `tsconfig.base.json`, `docker-compose.yml` (Postgres 5433, MinIO 9300/9301),
  `.env.example`.
- `packages/db/src/schema/*.ts` + first migration: every entity and field in spec §2 "Main entities",
  including Setting, RunTimeChange, KeywordDay, ShopDay, CrawlerState, LarkMessage and Alert, the run
  and search statuses, the CrawlRun counters `running_ads` and `ok_searches`, and the unique keys listed
  there. The first migration seeds the default settings and the first `run_time_changes` row (default
  run times, effective from install), and creates the `pg_trgm` extension with GIN trigram indexes
  (`gin_trgm_ops`) on the ad caption, page name and landing domain for the Ctrl+K search.
- `packages/core/src/measures.ts`: `daysActive`, `crawlDay` (Pacific date of run start), `trendScore`
  (5+ days, landing domain required), `adStatus` (staleness rule, spec §1 "Measures"), `isRisingNew`
  (`first_seen_date` and `start_date` both within the last 3 crawl days, Pacific), `deltaAt` (change
  from the last value on or before a cutoff, else from the earliest value marked partial; none with
  fewer than 2 values).
- `packages/core/src/pacing.ts`: random gap between searches, random delays inside a search, and the
  backoff, which takes a resistance signal per search (`ok`, neutral, blocked, captcha (also sent for a
  login wall), network) kept apart from the search status. Block streak (spec §1 "Backoff"): blocked
  searches since the last `ok` signal or 30 quiet min of wall time; neutral and network signals are
  skipped. Pause 45 s × 2^(block streak − 1) with jitter; stop at a block streak of 3, 6 blocked
  searches in a run, or a captcha signal. Network streak: `network_error` searches in a row, reset by
  any other search and after a network cool-down; at 3 it starts a network cool-down. Clock and random
  source injected; every value from settings.
- `packages/core/src/access.ts`: tick rules (`save` and `keywords` imply `view`), keyword-briefing
  visibility (spec §4), and a branded `StoreScope` type that store-scoped queries require.
- Tests: `measures.test.ts` with the verified examples (Crocoblock 19, Alibaba.com 93, VistaPrint 82
  with "today" injected as 2026-10-18 Pacific, same day 1), a DST case, two runs on one Pacific date, a
  13:00 Asia/Ho_Chi_Minh run that crosses Pacific midnight (crawl day from run start, `days_active` from
  the payload's `end_date`), trend-score gating, staleness (not seen for N days and an end-of-results
  search on one of its pairs, `no_results` or `ok` with `last_has_next` false, ran after
  `last_seen_date` → stopped/unknown; only `ok` searches that stopped with a next page left (cap or
  2-page rule) since → out of top results; not searched since because of rotation → running; all its
  pairs inactive → stopped/unknown; seen again → running), and rising-new (an old ad first seen today
  under a newly tracked keyword is not rising); `deltaAt` (same slot only, baseline on or before the
  cutoff, an earlier day when the cutoff day is missing, partial baseline when the history is shorter,
  none with one value); `pacing.test.ts` without real sleeps (pause doubling with the block streak,
  jitter within ±15%, neutral and network signals neither count nor reset the block streak, reset after
  `ok` and after 30 quiet min including a network cool-down that long, stop at a block streak of 3, at 6
  blocked searches in a run or at a captcha, blocked, `no_results`, blocked, blocked stops the run,
  worst total pause of a run that reaches its last search ≤ 362.25 s (45 + 90 + 45 + 90 + 45 s plus
  15%), network streak of 3 → one network cool-down, `network_error`, `no_results`, `network_error`,
  `network_error` → no network cool-down, network streak reset after a cool-down, delays within their
  ranges); `access.test.ts` table-driven over admin / member × ticks × seed vs tracked keyword.
- Write `docs/adr/0002-data-model.md` after the first migration.
- Exit: `docker compose up -d && pnpm db:migrate` work on Windows; tests green.
- Progress (2026-10-20): done on branch `step-2-skeleton`. Pins follow ADR 0001's rule with releases
  at least 14 days old on 2026-10-20: next 16.4.0, better-auth 1.7.7 (telemetry gating re-checked in
  `@better-auth/telemetry@1.7.7` and `@better-auth/core@1.7.7`: same as ADR 0001), pg-boss 12.37.0,
  openai 7.30.0, zod 4.6.5, drizzle-orm 0.45.3, react, react-dom and react-is 19.3.0, playwright and
  @playwright/test 1.63.0, geist 1.7.2; `engines` unchanged. Deviations, with reasons:
  - The UI libraries, Tailwind and the S3 client are not pinned yet: `shadcn add` brings its own
    dependencies, so they are pinned and checked against ADR 0001 in Step 5, when the components are
    generated. `apps/web` and `apps/worker` hold only their `package.json` until Steps 5 and 3.
  - ADR 0001 cites code in next 16.4.2 and pg-boss 12.38.0; the pins are 16.4.0 and 12.37.0, so Step 3
    (pg-boss) and Step 5 (image optimizer, Server Action body cap) re-check those citations.
  - Dev tools follow POD Studio's pins, except eslint 10.12.0 and @eslint/js 10.0.1, since eslint
    9.39.5 is deprecated on npm.
  - CI (`.github/workflows/ci.yml`) runs the step checks against a Postgres service, plus
    `migration.test.ts` and a check that the schema generates no new migration.

### Step 3. Facebook Ad Library adapter and worker (week 2)
- `packages/sources/fb-ad-library/src/{search,parse-embedded,parse-graphql,normalize,detect}.ts`,
  `apps/worker/src/{main,run,schedule,thumbnails,heartbeat}.ts`, `scripts/acceptance.sql`.
- Scheduler: keeps the run rows of the next 14 days written (`trigger = schedule`, status `scheduled`,
  `scheduled_for`, `planned_searches` = min(budget, active keyword × country pairs), and `deadline` =
  the earlier of slot plus run deadline and, for the morning run, the hard stop, stored before the row's
  job is sent). The scheduler runs in the worker: it also sends each day's `briefing.build` jobs with
  `startAfter` = the build time, and checks settings every minute, so a change of run times, run
  deadline, deadline grace, hard stop, build time or margin rewrites the `deadline` of future rows and
  sends their jobs again within 1 minute, cancelling the old job and sending the new one in one
  transaction (`cancel()` and `send()` with `{ db }`); the web app writes settings and Run now rows.
  Changing run times (the scheduler writes the `run_time_changes` row when it applies the change, with
  its effective time), the budget, countries or keywords rewrites only future `scheduled` rows with
  `trigger = schedule`. Slot rows are inserted with `ON CONFLICT DO NOTHING` on the partial unique index
  `(source, scheduled_for) WHERE trigger = 'schedule'`, by the scheduler and by the watchdog backfill.
  Each minute pass also sends the `briefing.build` jobs of the next build time not yet reached: the
  global briefing and one per keyword active at that pass; `send()` returns null for those already
  queued, a keyword activated later gets its job on the next pass, and one deactivated before the build
  makes its job a no-op. A change of build time cancels those jobs and sends them again with the new
  `startAfter`, in one transaction. Queues: the worker creates three pg-boss queues with `createQueue`
  and works them in parallel, each with `localConcurrency: 1`. `crawl.run`: policy `singleton` (one
  active job, any number queued) with no per-row `singletonKey`; `retryLimit: 0`, since the pg-boss
  default of 2 would run an expired job again; `expireInSeconds` = run deadline + deadline grace + 5 min
  watchdog period (17400 s by default), so pg-boss does not free the singleton before the watchdog
  closes a hung run, and settings validation rejects values that make it exceed 24 h, the pg-boss
  maximum. Each row gets its own job, sent ahead with `startAfter` = its slot, and the id that `send()`
  returns is stored as the row's `job_id`; rewriting a future row cancels its job and sends a new one.
  `briefing.build`: policy `exclusive` (one job queued or active per `singletonKey`; `send()` returns
  null while one exists), one job per briefing with `singletonKey` = `${date}:global` for the global one
  and `${date}:kw:${keyword_id}` for each keyword report, the global one at a higher `priority` (pg-boss
  fetches by `priority` desc, then `created_on`, so jobs sent in one transaction would otherwise tie),
  `retryLimit: 1` (the build is idempotent), `expireInSeconds` 900 by default (settings); a
  `singletonKey` alone does nothing on a `standard` queue. `lark.send`: policy `standard`, `retryLimit:
  3` with `retryDelay: 30`, idempotent per briefing and chat: each post carries Lark's `uuid` dedupe
  field (the first 32 hex characters of the SHA-256 of the briefing id and the chat; Lark allows 50
  characters and sends at most one message per `uuid` within 1 hour), the `lark_messages` row (`uuid`,
  `message_id` null) is inserted before the call, and a retry that finds it older than 1 hour without a
  message id does not post again and writes `lark_send_failed`. pg-boss expiry does not stop a running
  handler (`dist/manager.js`: "The timeout only stops the wait for a handler, not the handler"), so the
  `briefing.build` and `lark.send` handlers pass `job.signal` to the openai client and the Lark `fetch`,
  and run their queries under `SET LOCAL statement_timeout` of 60 s, below the job's expiry. At start
  the run moves its row to `running` in one update `WHERE status = 'scheduled' AND now() < deadline AND
  NOT EXISTS (SELECT 1 FROM crawler_state WHERE blocked_until > now())`, so a NULL `blocked_until`
  blocks nothing; when that changes no row, the job completes as a no-op and inserts no searches, and a
  `manual` or `cli` row still `scheduled` is closed in the same path as `stopped` with close reason
  `not_started`. Otherwise it recomputes `planned_searches` from current settings (for `manual` and
  `cli` rows, `requested_pairs` intersected with the active keywords and countries, capped by the
  budget), writes it to its row, and inserts that many `crawl_searches` rows as `pending`; it then moves
  each through `running` to its result: a search that hits a block is `blocked` and keeps the ads it
  read; the search in progress at the run deadline is `interrupted` and keeps its ads; the ones not
  started are `skipped`. An unexpected run error, one outside a search (database, settings, worker code
  outside the search loop, a browser that does not start within its limit when the run starts), ends the
  run as `stopped` with a `run_failed` Alert; an error tied to one search's page or payload never does
  (see "Search errors" below). The worker writes `keyword_days` and `shop_days` for the slot (running
  ads per keyword and per landing domain) at the end of a scheduled run that ran at least one search and
  ended without `run_failed`; manual and `cli` runs and runs closed by the watchdog or at worker startup
  write none. Every run's final update, manual and `cli` runs included, also writes `running_ads` (the
  ads whose status is running under spec §1 "Measures" right after the run's upserts, the rule
  `keyword_days` counts with) and `ok_searches` (`ok` plus `no_results` searches), which the briefing
  KPI row reads (spec §6). A run ends `done` when it ran all its planned searches or stopped at its
  deadline, and `stopped` when a block stops it, on `run_failed`, or when the watchdog or worker startup
  closes it. After a run starts, every worker update of the run and its searches carries `status =
  'running'` on the run (searches through their run), so a write after a close changes no row and the
  worker drops that run. Alerts and `blocked_until` are written in the transaction of the guarded update
  that causes them, and `keyword_days`, `shop_days`, `running_ads` and `ok_searches` in the transaction
  of the final run update, so a late finish writes none of them. Checked in pg-boss 12.38.0:
  `dist/types.d.ts` (queue policies, `singleton` = one active and unlimited queued; `localConcurrency`;
  `startAfter`; `expireInSeconds`), `dist/index.d.ts` (`send()` returns the job id; `cancel()` and
  `fail()` take it), `dist/plans.js` (`QUEUE_DEFAULTS`: `retry_limit` 2, `expire_seconds` 900),
  `dist/attorney.js` (`MAX_EXPIRATION_HOURS` 24) and `dist/migrationStore.js` (per-policy partial unique
  indexes on `singleton_key`, `job_i6` for `exclusive`, none for `standard`); a Step 3 test confirms the
  `singleton` behaviour.
- Scheduler and "Run now" both check `blocked_until` and the budget; a run stops at its deadline
  (default: 01:00 and 13:00 Asia/Ho_Chi_Minh, 4 h 30 min max; the morning run, the last scheduled slot
  before the briefing build time, hard-stops at 06:05). Run now and `pnpm crawl:run` insert a
  `scheduled` row with its `deadline`, the earlier of the run deadline after the request and the margin
  before the next scheduled slot (default 25 min; settings validation rejects a margin no longer than
  the deadline grace plus the 5 min watchdog period); Run now and `pnpm crawl:run` are refused while
  `blocked_until` is in the future, while another run is `running`, while another `manual` or `cli` row
  is `scheduled` or `running` (partial unique index `(source) WHERE trigger IN ('manual', 'cli') AND
  status IN ('scheduled', 'running')`, so two requests at once cannot both pass), or when that deadline
  has already passed, never because their own cool-down could reach the next slot; the row, with
  `requested_pairs`, and its job, sent with `startAfter` = now, are written in one transaction
  (`send(..., { db })`, pg-boss 12.38.0 `dist/types.d.ts` `ConnectionOptions` and `SendOptions`), and
  the returned id is stored as `job_id`. Settings validation also rejects a hard stop that, plus the
  deadline grace plus 5 min, is not before the briefing build time (defaults: 06:05 + 15 + 5 min =
  06:25, before 06:30), a morning slot at or after the hard stop, and two slots, the gap across midnight
  included, closer than run deadline + deadline grace + 5 min. A scheduled slot that comes before
  `blocked_until` is not started; the watchdog closes it (below).
- `pnpm crawl:run --keywords <k1,k2,…> --countries <US,GB,…>` (`apps/worker/src/cli.ts`): starts a run
  with `trigger = cli` and `triggered_by` null for those keyword × country pairs, stored as
  `requested_pairs`, through the same path as Run now (same limits, deadline and refusals); Step 3's
  exit uses it, since the Run now control lands in Step 6.
- Crash recovery (`main.ts`, at worker startup, before it takes any job): every run still `running`
  becomes `stopped` with a `run_failed` Alert, its `running` search `interrupted` and its `pending`
  searches `skipped`, and its `crawl.run` job is failed in pg-boss so the singleton is free. Then a row
  still `scheduled` whose `crawl.run` job is active (a crash between taking the job and the guarded
  start) has that job failed; while `now() < deadline` a new job is sent with `startAfter` = now and its
  id stored as `job_id`, in the same transaction; after the deadline a `schedule` row becomes `missed`
  with a `missed_run` Alert and a `manual` or `cli` row `stopped` with close reason `not_started`. Every
  `briefing.build` job still active is cancelled, not failed: `fail()` would move it to `retry`, which
  stays inside `job_i6`, so sending it again would return null. Every `lark.send` job still active is
  failed, so it returns to `retry` and posts again with the same `uuid` (the `standard` queue has no
  singleton index to free). Only then does the worker take jobs.
- `scripts/acceptance.sql`: the AC 1 ratio over `trigger = schedule` rows, counting all planned searches
  of rows that never started and the `skipped` searches of blocked slots as failed; and AC 2's checks on
  `ok` searches (`embedded_count` > 0; `pages_read` ≥ 1 when `embedded_has_next`; fewer than 100 ads
  only with `last_has_next` false or `stop_reason = no_new_ads`). Step 7 adds AC 1's Alert checks, AC 3
  and AC 6; Step 8 runs it daily.
- Watchdog `apps/worker/src/watchdog.ts`, a separate short-lived entry point (`pnpm watchdog`) started
  every 5 min by the OS timer (Task Scheduler on Windows from Step 4, systemd timer on Linux in Step 8),
  never by the worker. A pass takes `pg_try_advisory_lock` and exits if another pass holds it; it does
  its closes, marks, backfill and heartbeat check first, then sends Alerts (each with a Lark `uuid` from
  the first 32 hex characters of the SHA-256 of the Alert id) within a 60 s budget, the rest left for
  the next pass; an unsent Alert older than 24 h is marked not sent to Lark instead (ADR 0004). It closes `manual` and `cli` rows still `scheduled` after their deadline as `stopped`
  with close reason `not_started`; marks rows still `scheduled` 15 min after their slot, and not covered
  by `blocked_until`, as `missed` with a `missed_run` Alert and cancels its job by `job_id`; closes a
  scheduled row whose slot came before `blocked_until` as `stopped`, with its planned searches inserted
  as `skipped` and a `blocked` Alert, and cancels its job; writes a `missed` row (same Alert) for any
  past slot of the run times in force then, per `run_time_changes`, that has no row, or a `stopped` row
  with all its planned searches `skipped` and a `blocked` Alert when the slot fell inside a cool-down
  (from the end of the run that stopped on a block to the `blocked_until` it set, kept on that run),
  looking back at most 14 days and never before the first `run_time_changes` row, with
  `planned_searches` from the settings at that moment; closes a `running` run when the worker heartbeat
  is older than 30 min or the run's deadline plus the deadline grace (default 15 min) has passed, as
  `stopped` (its `running` search becomes `interrupted`, its `pending` searches `skipped`) with a
  `run_failed` Alert, then fails its `crawl.run` job in pg-boss so the singleton is free and restarts
  the worker service (its Task Scheduler task on Windows, `systemctl --user restart ideashub-worker` on
  Linux); opens one `heartbeat_lost` incident when the worker heartbeat is older than 30 min, only from
  a missing heartbeat and never from the absence of a run, and resolves it on the next fresh heartbeat;
  when the heartbeat is that old while no run is `running` (the worker hung while idle), it also
  restarts the worker service; from Step 7, writes `briefing_late` when the global briefing misses its
  ready time, and `lark_send_failed` when the global briefing has `ready_at` but no `lark_messages`
  message id for the shared group by the ready time (retries run out, an expired job or a cancelled
  one). Each close is one update that applies only while the row is in the status it expects
  (`scheduled` or `running`). Grace, thresholds and times come from settings.
- Detection: the "no results" marker → `no_results`, not a block; captcha, login wall, embedded data
  empty without the "no results" marker, or 3 empty scroll payloads in a row (a non-empty page resets
  the count) → `blocked` and Alert; unparseable payload → `parse_error`, Alert, no cool-down. Each
  search then sends its resistance signal to `pacing.ts` (spec §1 "Backoff"); a captcha, a login wall, a
  block streak of 3 or 6 blocked searches in the run stop the run with the 6 h cool-down and a `blocked`
  Alert; a login wall sends the same captcha signal as a captcha. Alerts are written to `alerts` from
  this step; the watchdog sends them to Lark from Step 7.
- Pagination: wait the random page delay after the search page loads and the random scroll delay
  before each scroll (`pacing.ts`); record `embedded_has_next` (from `page_info`, or total count > ads
  read) and `total_count` if present; keep scrolling while there is a next page and fewer than 100
  unique ads are stored, with no page cap, because a page may repeat ads already read; stop after 2
  non-empty scroll pages in a row whose ads were all read already, so one search cannot use up the run
  deadline (such a stop with `last_has_next` still true stays `ok`, is neutral to the backoff until
  Step 1 decides otherwise, and is counted on the run outside the stop thresholds); an empty
  payload goes to the block counter and neither counts toward nor resets this rule; record
  `last_has_next` (equal to `embedded_has_next` when no scroll page was read) and `stop_reason`
  (`end_of_results`, `cap`, `no_new_ads`).
- Upsert: insert-or-update `end_date`, `is_active`, `collation_id`, `collation_count`, parsed JSON,
  rollups; shops upserted by landing domain; sightings unique; thumbnails downloaded in the same job
  during the gap before the next search, missing ones downloaded again at the next sighting (assumes CDN
  URLs expire; Step 1 checks it); each is stored under the `thumbs/` prefix with a key matching
  `^[A-Za-z0-9_-]+\.(jpg|webp)$`: `<ad_archive_id>_image` or `<ad_archive_id>_video` plus an extension
  taken from the magic bytes, JPEG `.jpg`, WebP `.webp`, anything else re-encoded to WebP with sharp and
  named `.webp`, so `/thumbs` (Step 6) can serve every key.
- Search errors (`search.ts`): a timeout, a navigation that destroyed the page context, `net::err_`, a
  closed browser, or a browser that does not restart within its limit ends the attempt; a search gets up
  to 3 attempts (retries after 5 s and 15 s), with a browser restart before each retry, and the run
  counts its retries and browser restarts. Still transient after the last attempt → `network_error`,
  which sends a network signal: neutral to the block streak and outside the blocked thresholds. A
  network streak of 3 → a network cool-down (default 10 min, settings, tuned in Step 1) with one
  `network_error` Alert per cool-down, written in the same transaction that increments the run's
  `network_cooldowns`, then the network streak resets and the run goes on within its deadline. A
  permanent error tied to the search's page or payload → `parse_error` with a `parse_error` Alert like
  any other parse error; neutral; the run goes on. None of this is a job retry: `crawl.run` itself is
  never retried.
- Bounded waits: browser start 60 s, page load 60 s, embedded data 15 s after the load, each scroll
  response 15 s, thumbnail download 15 s per image within a total per search equal to the gap before the
  next search (the shortest gap, 20 s, after the last search; never past the run deadline), and browser
  close 15 s, from settings; a page wait that runs out is a transient error that ends the attempt, a
  thumbnail not downloaded when either thumbnail limit runs out is left missing and downloaded again at
  its next sighting, and a browser that does not close in time is killed; each hit is counted on the run
  per wait. A browser that does not start when the run starts is a run error (`stopped`, `run_failed`).
  The browser start limit from settings is passed as the `timeout` option of `launch` and
  `launchPersistentContext`, because Playwright otherwise waits 180000 ms: in the pinned 1.63.0,
  `_launchTimeout` falls back to `DEFAULT_PLAYWRIGHT_LAUNCH_TIMEOUT` = 3 × 60 × 1000 (playwright-core
  1.63.0 `lib/coreBundle.js`), although its `types.d.ts` still documents 30000; 1.64.1 has the same code
  and documents 180000.
- Heartbeat (`heartbeat.ts`): while a `crawl.run` job is active, written only from the search loop and
  its waits: at every step (each search, attempt, page load and scroll), between thumbnail downloads,
  and at least once a minute while waiting, including pauses and the network cool-down. Between runs
  pg-boss `work()` has no idle loop of its own, so a one-minute timer writes it, started when no
  `crawl.run` job is active and stopped when one starts, the one exception to writing from the loop; it
  writes only while pg-boss still polls, judged by the `crawl.run` worker's `lastFetchedOn` from
  `getWipData()` being under 2 min old (pg-boss 12.38.0 `dist/worker.js` line 71), a missing `crawl.run`
  entry or a null `lastFetchedOn` counting as not polling, with `pollingIntervalSeconds` and
  `notifyPollingIntervalSeconds` left at pg-boss's defaults (2 s and 30 s, `dist/attorney.js` lines
  638–656) and worker startup refusing a configured value of 120 s or more for either, so a worker whose
  polling died stops the heartbeat and the watchdog restarts it; the 6 h cool-down is not a wait inside
  the job: the run ends at once with `blocked_until` set and the timer writes the heartbeat during it;
  since the timer is stopped while a job is active, a step that hangs stops the heartbeat; settings
  validation rejects a wait limit that would reach the heartbeat threshold.
- Profile/proxy slots read from settings, off by default.
- Tests: parser tests on the Step 1 fixtures, including the has-next-page signal; upsert test (same ad
  twice → 1 ad, rollups updated, `end_date` moved; same search retried → no duplicate sighting);
  detection tests (no results vs block vs parse error); a block mid-scroll leaves one `blocked` search
  with its ads kept and an Alert, then a backoff and the next search; a block streak of 3, 6 blocked
  searches in a run, or a captcha, stop the run as `stopped` with the rest `skipped`, the cool-down and
  a `blocked` Alert; a login wall sends the captcha signal and stops the run the same way; empty
  embedded data without the "no results" marker → `blocked`; a 2-page stop with `last_has_next` true
  stays `ok` with its ads, is neutral, and is counted on the run; six such stops in a run do not stop
  it; `no_results`, `parse_error` and `network_error` leave the block streak as is; a first attempt that
  times out and a second that succeeds → `ok` with one retry and one browser restart recorded on the
  run; 3 failed attempts of one search → `network_error`; a network streak of 3 → one network cool-down
  and one `network_error` Alert, then the run goes on, with no 6 h cool-down; a browser that does not
  start in time mid-run → transient error of that attempt, at run start → run `stopped` with
  `run_failed`; 6 `network_error` searches spread over a run do not stop it; a permanent error tied to a
  search → `parse_error` with a `parse_error` Alert, no retry, run goes on; a database error outside the
  search loop → run `stopped` with `run_failed`; the `crawl.run` job is not retried after a failed run;
  embedded data that never arrives within its limit is a transient error, a slow page within the limits
  is `ok`; with an injected clock, the heartbeat is written at every step and at least once a minute
  during a pause and the network cool-down, and by the idle timer between runs, a 6 h cool-down
  included, which ends the run at once; the idle timer stops while a crawl job is active, so a step that
  hangs writes none; with pg-boss polling stopped (no fetch for 2 min) the idle timer writes no
  heartbeat, and the watchdog restarts the worker once the heartbeat is 30 min old; the watchdog opens
  no `heartbeat_lost` between runs while heartbeats arrive; a wait limit that reaches the heartbeat
  threshold is rejected; a deadline mid-scroll leaves one `interrupted` search; pagination keeps
  scrolling past a page with some repeated ads until 100 unique; 2 non-empty scroll pages in a row with
  no new unique ad stop the search as `ok` with `stop_reason = no_new_ads`; empty scroll payloads never
  stop a search as `ok`: 2 of them leave it scrolling, a third makes it `blocked` with an Alert and a
  backoff, so its ads are not labelled "out of top results"; repeat, empty, repeat stops with
  `no_new_ads`; has-next derived from a total count; watchdog marks an overdue `scheduled` row `missed`,
  writes a `missed` row for a past slot with no row (judged by the run times in force then, at most 14
  days back, never before the first `run_time_changes` row), and closes a run with a stale heartbeat;
  the scheduler keeps 14 days of rows written; changing run times rewrites only future rows and records
  the change; changing the budget, countries or keywords rewrites future rows; a run whose settings
  changed after its row was written recomputes `planned_searches` at start and inserts that many search
  rows; `keyword_days` and `shop_days` written per slot by scheduled runs that ran at least one search
  and ended without `run_failed`, block stops included, none by manual or `cli` runs, `run_failed` runs
  or runs the watchdog closed; the final update writes `running_ads` and `ok_searches` in the same
  transaction, and a late finish after a close writes neither; `running_ads` of a run whose searches
  return overlapping ads counts each ad once, leaves out out-of-top and stopped ads, and includes
  running ads outside the run's keywords; every stored thumbnail key, including one from a PNG and one
  from WebP bytes behind a `.jpg` URL, matches the `/thumbs` pattern; crash recovery at worker startup
  turns the left `running` run into `stopped` with `run_failed`, its `running` search into `interrupted`
  and `pending` into `skipped`, and fails its job; for a row still `scheduled` with an active job, fails
  that job and, before the deadline, sends a new one with `startAfter` = now and the new `job_id`
  stored, after it marks a `schedule` row `missed` and closes a `manual` row as `stopped` `not_started`;
  cancels an active `briefing.build` job so that sending it again is accepted, and fails an active
  `lark.send` job so that it retries; every new row (scheduled, manual, `cli`) has its `deadline` before
  its job is sent; with a 02:00 slot (02:00 + 4 h 30 = 06:30, so the 06:05 hard stop applies), changing
  the hard stop to 06:00 rewrites the `deadline` of future morning rows from 06:05 to 06:00 and sends
  their jobs again; a settings change is applied by the scheduler within 1 minute; a manual run that
  crashes before a slot is closed by the crash recovery function, called directly in the test rather
  than through an OS restart policy, and one that hangs is closed by the watchdog by its deadline plus
  grace plus 5 min, in both cases before the slot, and the scheduled run then starts on time and runs
  normally; settings validation rejects a margin of 20 min with a 15 min grace and accepts 25 min, and
  rejects a 06:10 hard stop with a 15 min grace and a 06:30 build time while the default 06:05 passes;
  rejects a morning slot of 06:05 with a 06:05 hard stop and accepts 02:00; rejects slots 01:00 and
  05:00 (4 h apart, under 4 h 50 min) and accepts 01:00 and 13:00; a late job of a `missed` row, of a
  blocked slot, and a manual job that starts after its deadline are each a no-op that inserts no
  searches; the watchdog cancels the job of a row it marks `missed` or closes as a blocked slot, and its
  closes change no row whose status moved on; a late finish after a watchdog close writes no
  `keyword_days`, `shop_days`, Alert or `blocked_until`; a second `crawl.run` job waits while one is
  active (queue policy `singleton`); a run starts normally when `blocked_until` is NULL; `crawl.run`
  jobs carry `retryLimit: 0` and `expireInSeconds` 17400 with the defaults, and an expired job is not
  run again; settings whose run deadline + grace + 5 min exceeds 24 h are rejected; changing the run
  deadline re-sends the jobs of future rows with the new expiry; rewriting a future row's slot cancels
  its job and sends one with the new `startAfter`; Run now and `pnpm crawl:run` are refused while
  another run is `running`; after the watchdog closes a run, a late worker update of the run or a search
  changes no row and the worker drops the run; a past slot with no row inside a cool-down is backfilled
  as `stopped` with its searches `skipped` and a `blocked` Alert, not `missed`; one Alert per (run,
  kind), except `network_error`, one per network cool-down; two network cool-downs in one run give
  `network_cooldowns` = 2 and two `network_error` Alerts (their Lark message ids are checked in Step 7);
  a failure injected after the counter update in that transaction leaves neither the increment nor the
  Alert; a launch that exceeds the browser start limit from settings fails at that limit, because the
  limit reaches Playwright's `timeout` option instead of the 180000 ms default; repeated heartbeat
  checks keep one open `heartbeat_lost` incident; budget rotation test; run-now respects `blocked_until`
  but is not refused because its own cool-down could reach the next slot; a manual run's deadline is the
  earlier of the run deadline after the request time and 25 min before the next slot, and Run now is
  refused when that time is past; a scheduled slot that comes before `blocked_until` is closed by the
  watchdog as `stopped`, all its planned searches `skipped`, with a `blocked` Alert and no `missed_run`
  Alert, and `acceptance.sql` counts those searches as failed; the watchdog closes a `running` run whose
  heartbeat is fresh once its deadline plus grace has passed, as `stopped` with `run_failed`, fails its
  pg-boss job and calls the injected worker restart; a stale heartbeat with no run `running` opens one
  `heartbeat_lost` incident and calls the injected worker restart; a thumbnail download over its limit
  leaves the thumbnail missing and is downloaded again at the next sighting; thumbnails of one search
  that need longer than the gap before the next search stop at that total, the rest are left missing and
  downloaded at their next sighting, the next search starts on time, and the heartbeat is written
  between downloads; a browser close over its limit kills the browser; browser restarts and wait-limit
  hits are counted on the run; a run that ends at its deadline is `done`, one stopped by a block is
  `stopped`; `pnpm crawl:run` with 2 keywords × 2 countries plans 4 searches, writes `trigger = cli`
  with `triggered_by` null, and gets the same deadline rule as a manual run; a `cli` run for 2 keywords
  × 2 countries with one keyword deactivated before it starts plans 2 searches, never a full crawl; a
  second Run now or `cli` request while a `manual` or `cli` row is `scheduled` or `running` is refused,
  also when both arrive at once (the partial unique index rejects the second insert); a failure injected
  between inserting a Run now row and sending its job leaves neither; a manual row whose start is a
  no-op (deadline passed, `blocked_until` set) ends `stopped` with `not_started`, and the watchdog
  closes a manual row still `scheduled` after its deadline the same way; the scheduler and the watchdog
  backfill writing the same slot twice leave one row; the scheduler rewrites no `manual` or `cli` row;
  changing run times writes one `run_time_changes` row from the scheduler; a failure injected between
  the scheduler's `cancel()` and `send()` leaves the old job in place; a second watchdog pass started
  while one holds the advisory lock exits at once, and Alert sending stops at its 60 s budget with the
  rest sent by the next pass.
- Exit: `pnpm crawl:run` with 10 seed keywords × 2 countries (US, GB) stores ads, sightings, thumbnails,
  a run row with its counts, and `crawl_searches` rows whose counts add up to the planned total.
- Progress (2026-10-20): merged as PR #3 (bdc9303). Built on branch `step-3-fb-adapter`. The adapter is `packages/sources/fb-ad-library`
  (`parse-embedded`, `parse-graphql`, `normalize`, `detect`, `search`, and `playwright.ts` behind a
  `BrowserSession` interface so the search rules are tested with a scripted page); the worker is
  `apps/worker/src/{main,run,schedule,thumbnails,heartbeat,manual,recovery,watchdog,watchdog-pass,cli}.ts`;
  `scripts/acceptance.sql` holds AC 1 and AC 2. Each test creates its own database
  (`packages/db/src/testing.ts`) with pg-boss on it and a settable clock, so every SQL statement takes
  the clock's time as a parameter instead of `now()`. Decisions, with reasons:
  - Re-checked at the pins: pg-boss 12.37.0 (not 12.38.0) has the same queue policies and indexes
    (`singleton` = `job_i2`, one active job; `exclusive` = `job_i6`, `state <= 'active'`;
    `dist/migrationStore.js`), `QUEUE_DEFAULTS` `retry_limit` 2 and `expire_seconds` 900
    (`dist/plans.js`), `MAX_EXPIRATION_HOURS` 24 and polling defaults 2 s and 30 s
    (`dist/attorney.js`), and `lastFetchedOn` set after each fetch (`dist/worker.js` line 65, not 71).
    The 12.38.0 comment "The timeout only stops the wait for a handler" is not in 12.37.0's
    `manager.js`: there `job.signal` is aborted when the worker's claim is lost or it stops, never on
    expiry, so the plan's rule (handlers pass `job.signal` and run under `statement_timeout`) stands.
  - Playwright 1.63.0: `launch()` honours `timeout` (test with a 1 ms limit), but `launchServer()`,
    which the worker uses so that a browser that does not close in time can be killed
    (`BrowserServer.kill()`), resolved with a 1 ms `timeout`; the session therefore also races the start
    against the limit and kills a late browser. Both are tested with real Chrome (skipped where none).
  - The Step 1 headless sample showed an embedded script read while it was still streaming (truncated
    JSON, `parse_error`). The adapter polls until the script parses; one that never does within the
    embedded-data limit is a transient error, not a parse error.
  - `@aws-sdk/client-s3` pinned to 3.1142.0 (POD Studio's pin, published 2026-09-28).
  - Budget rotation: `crawler_state.rotation_cursor` is an index into the active pairs in a stable order
    (keyword creation, then the settings' country order).
  - The watchdog's blocked-slot check for a row still `scheduled` also uses the current
    `blocked_until`, because that slot's job can have waited behind the run that set it (its slot then
    falls before that run's `finished_at`); the backfill uses only the "end of the blocking run to its
    `blocked_until`" window of spec §1.
  - The scheduler deletes the future `scheduled` rows (and cancels the jobs) of slots that a run-time
    change removed, and inserts the new slots; rows of slots that stay are updated in place.
  - The browser mode is the environment variable `IDEAS_HUB_BROWSER_MODE` (default: the Step 1 choice),
    not a Setting, so the first migration's settings seed is unchanged.
  - Left for later steps, as the plan has them: the `briefing.build` jobs sent by the scheduler and their
    handler (Step 7), Alert sending to Lark (the watchdog takes an injected sender; Step 7 wires it), the
    Windows tasks for the worker and the watchdog (Step 4). pg-boss polling intervals are not
    configurable in the worker, so there is no configured value of 120 s or more to refuse; the defaults
    apply. The `browserProfile` setting stays off (a fresh profile per start); only `proxy` is wired.
  - A code review of the branch found no blocking issue; fixed from it, each with a test: a search
    could stay `running` on a run the watchdog had just stopped (the search is now marked inside a
    transaction that locks the run row); an unreadable scroll payload counted as empty (now
    `parse_error`, as plan "Detection" says; an empty body or a payload of only `errors` still counts as
    empty), a captcha flag in a scroll payload was ignored, a failed heartbeat write became a
    `parse_error` (it now propagates and fails the run), a failed bucket check was cached until restart,
    an empty `runTimes` looped, the watchdog restarted the worker at every pass of one stale-heartbeat
    incident (now once, when the incident opens), the final browser close was not counted, a close
    error counted as a close over its limit, thumbnail keys were written after a close, a cap reached
    inside one scroll stopped as `no_new_ads`, two scheduler passes could overlap, and a connection that
    failed to roll back went back to the pool. The concurrent Run now test also showed that drizzle
    wraps the pg error, so a unique violation was not read as `manual_pending`; fixed. AC 2's check
    reads the cap from `settings` instead of 100.
  - Exit: done on 2026-10-20 against the dev database, with the worker running and no probe run in
    progress: `pnpm crawl:run` with the first 10 seed keywords × US, GB (run `run_0bfae41144ba455cabf48`,
    `cli`, off-screen, 04:30–04:50 UTC) ended `done` with 20 planned and 20 `ok` searches (each stopped at
    the 100-ad cap), 1556 ads, 2000 sightings, 400 shops and 1555 thumbnails in MinIO (one ad has no thumbnail; not
    investigated), 1 transient retry and no wait-limit hit. The worker was stopped afterwards and the 28
    scheduled rows its scheduler had written were removed, so it could not start the 13:00 slot over the
    probe's run.

### Step 4. Measurement, crawler ADR, briefing preview (week 3; runs while Step 5 starts)
- Scheduler runs twice a day on Windows (PC kept awake) for 3–5 days; the watchdog is registered in Task
  Scheduler every 5 min, and the worker runs as a Task Scheduler task whose action is a wrapper loop
  that starts the worker again after it exits; that loop is the main restart, since the watchdog
  restarts the worker only after a 30 min stale heartbeat or a hung run.
- `docs/research/2026-10-xx-block-rate.md`: success rate by AC 1's definition, block events, ads per
  search, run duration against the spec §1 run-time estimate, backoff waits; tuned defaults written
  back to `settings`.
- `docs/adr/0003-crawler-design.md`: browser mode, limits, detection, job model.
- `scripts/briefing-preview.ts`: sections 1–4 from SQL rendered as Markdown for the owner to read;
  sections 3 and 4 use `keyword_days` and `shop_days` with `deltaAt` on the same slot, so with 3–5
  days of data they show "since <date> (less than 7 days of data)" instead of nothing.
- Decision point: success < 90% after tuning → stop and bring options to the owner (fewer countries,
  longer delays, residential proxy). Step 5 work at risk at that point: about one week.
- Exit: the block-rate report and ADR 0003 committed, with the success rate by AC 1's definition, block
  events and duration of every measurement run; tuned defaults written to `settings`;
  `scripts/briefing-preview.ts` renders sections 1–4 from the measurement runs; the decision point
  recorded as success ≥ 90% or as the options brought to the owner; the worker process, killed, is
  started again by the wrapper loop within 2 min, and ending the Task Scheduler task leaves no orphan
  node or Chrome process; the result is recorded in the block-rate report.
- Progress (2026-10-20): built on branch `step-4-measurement`. Done: `docs/research/2026-10-20-block-rate.md`
  (interim: 142 searches so far, 98.6% by AC 1's definition, 100.0% for the off-screen mode, 0 blocks, no
  backoff wait; the Step 3 Exit run took 59 s per search against the spec §1 estimate of 61 s);
  `docs/adr/0003-crawler-design.md`; `scripts/briefing-preview.ts` (`pnpm briefing:preview`, sections 1–4,
  with "since <date> (less than 7 days of data)" when the baseline is short, tested on three days of
  fake-site runs); `scripts/windows/worker-loop.ps1`, `register-worker-tasks.ps1` and
  `check-worker-loop.ps1`. Wrapper check: the killed worker was back after 6 s, and ending the task left
  no node or Chrome process. Decisions, with reasons:
  - Ending a Task Scheduler task stops only its own process, and pnpm 12 runs scripts through Git Bash,
    whose processes lose their parent links: the first check left the worker's node processes and 8
    `chrome.exe` running. The loop now joins a job object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`;
    with it the check passes, without it the same check fails (both runs in the report).
  - The loop logs through `cmd.exe` with the paths in environment variables: Windows PowerShell 5.1's
    `*>>` wrote UTF-16 and wrapped stderr lines as errors.
  - The check runs a copy of the task (`IdeasHub-Worker-Check`) against a disposable database with no run
    times and no keywords, so it can never crawl and never touches the dev data; it removes both.
  - Tuned defaults: none. No block in 142 searches gives nothing to tune on; the spec §1 defaults stay
    and no `settings` row is written (closest reading of "tuned defaults written back to settings").
  - The worker tasks are not registered yet: the probe's twice-daily runs use the same slots until
    2026-10-22, and two crawls must never overlap. The measurement starts after the probe with
    `register-worker-tasks.ps1 -StartAt '2026-10-23 00:30'`.
  - Pending: scheduled runs — the 3–5 day measurement at the production schedule, its success rate, block
    events, durations and backoff waits, the decision point (so far ≥ 90%), and the briefing preview of
    those runs (today `pnpm briefing:preview` answers "No completed scheduled run yet", as the dev
    database has only the `cli` run).

### Step 5. Web app, auth and admin (weeks 3–5)
- `apps/web` (Next.js), `apps/web/src/lib/auth.ts` (better-auth, email+password, admin plugin, sign-up
  disabled, disable user, `telemetry: { enabled: false }`, session settings left at better-auth's
  defaults: `expiresIn` 7 days, `updateAge` 1 day, extended while in use
  (`dist/context/create-context.mjs` in 1.7.11; re-checked at the pinned version), so a user who opens
  the app every morning stays signed in), `pnpm auth:create-user`. A full page load passes through
  `proxy.ts`, whose `getSession()` extends the session and writes the cookie on the response;
  `nextCookies()` skips the extension only for soft navigations, requests with `RSC: 1` and no
  `next-action` (1.7.11 `dist/integrations/next-js.mjs` lines 67–69), and server components call
  `getSession()` with `query: { disableRefresh: true }`, so they never extend the database row without
  the cookie. No browser-side `getSession()` call is needed.
- `apps/web/src/proxy.ts`: requires a session for pages and `/_next/image` through a full
  `auth.api.getSession()`, one database lookup per request (accepted: a cookie-only check would let a
  disabled user's session keep loading pages and thumbnails), and lets `/login`, `/api/auth/**` and
  `/thumbs/**` through. Its `matcher` leaves out `/_next/static/**`, `/api/ideas/manual` (which checks
  the session itself, so the proxy does not buffer its body) and paths ending in an extension from an
  explicit list, `css|js|map|woff2?|ico|png|svg|webp|jpg|txt|webmanifest`, never any path with a dot,
  since `/shops/example.com` is a page; it keeps `/_next/image`, so the sign-in page gets its CSS, JS
  and fonts without a session. As defense in depth, `apps/web/src/app/(app)/layout.tsx`, a route group
  that does not change URLs, calls `getSession()` with `disableRefresh` and redirects to `/login` when
  there is none; every signed-in page lives under `(app)/`, `/login` stays outside it, and the root
  layout makes no session check.
- Look and shell (spec §6): `apps/web/src/styles/tokens.css` (POD Studio's `tokens.css` copied
  unchanged; POD Studio is only read), `apps/web/src/styles/ih-tokens.css` (the `--ih-*` tokens of spec
  §6) and `apps/web/src/styles/theme.css` (Tailwind v4 `@theme` mapping, light only), which also wires
  the fonts and shadcn's color names, because `next/font/local` gives the font a family name other than
  POD's `'Geist'` and POD's `theme.css` resets `--color-*` while shadcn's components use their own
  names: `--font-sans: var(--font-geist-sans), var(--vet-font-sans)` and
  `--font-mono: var(--font-geist-mono), var(--vet-font-mono)`; `primary` → `--vet-ink`,
  `primary-foreground` → `--vet-on-ink`, `input` → `--ih-field-border`, `ring` → `--vet-focus-ring`,
  `popover` and `card` → `--vet-bg-surface`, `muted-foreground` → `--vet-text-muted`, `accent` →
  `--vet-bg-selected`, `destructive` → `--vet-critical`, `border` → `--vet-border`, `background` →
  `--vet-bg-surface`, `foreground`, `card-foreground`, `popover-foreground`, `accent-foreground` and
  `secondary-foreground` → `--vet-text`, `secondary` and `muted` → `--vet-bg-selected`, and
  `--color-white: #ffffff` and `--color-black: #000000`, since shadcn's Sheet and Dialog overlays use
  `bg-black/50` and its destructive Button and Badge use `text-white`; `ih-tokens.css` also defines the
  raw `--popover`, `--popover-foreground`, `--border` and `--radius` that sonner reads as plain CSS
  variables; Ideas Hub's base layer sets `body { font-family: var(--font-sans) }`, because POD's
  `theme.css` (line 145) sets it from `--vet-font-sans`, whose first family is `'Geist'`; muted text in
  a menu item highlighted with `accent` uses `--vet-text`; `apps/web/src/app/layout.tsx` with
  `<html lang="vi">` carrying the `variable` classes of `GeistSans` and `GeistMono`, and Geist and Geist
  Mono from the `geist` package (`geist/font/sans` and `geist/font/mono`, built on `next/font/local`);
  shadcn components generated with `pnpm dlx shadcn` into `apps/web/src/components/ui/`, with the Sheet
  and sonner durations set to at most 220 ms and `components/ui/sonner.tsx` using `theme="light"`
  without `useTheme`, so next-themes stays out of `package.json`; after every `shadcn add`,
  `package.json` is checked against the ADR 0001 pins and restored, since registry dependencies bring
  next-themes (sonner) and recharts 3.8.0 (chart);
  `apps/web/src/components/shell/{sidebar,bottom-tabs,store-switcher,command-menu}.tsx`: the dark
  sidebar (248 px, `--ih-sidebar-bg`, collapsed to 60 px by a toggle kept in local storage; everything
  in it, the store switcher, badges and hover included, on `--ih-sidebar-*` tokens only) with its nav
  groups and the "Quản trị" group for admins only, the phone bottom tab bar with "Khác" (Run log, and
  "Quản trị" for admins), the store switcher listing only the user's stores, and the Ctrl+K (⌘K) command
  menu (cmdk) over ads, shops, keywords and screens, matching with `ILIKE` on the ad caption, page name
  and landing domain (the `pg_trgm` indexes of Step 2) with `%`, `_` and `\` escaped (`ESCAPE '\'`),
  from 3 characters, ordered by `similarity()` descending and then by last seen, at most 5 results per
  group, screens filtered by the user's permissions. "Lưu" and the selected card outline use ink, the
  active nav item ink text on the surface background; brand red appears only in the logo.
- `apps/web/src/app/login/page.tsx`: sign in, then the page a link named, or today's briefing by default
  (`/briefing`, a placeholder until Step 7); the callback is accepted only when it has no control
  characters and `new URL(cb, origin).origin === origin`; anything else goes to `/briefing`.
- `apps/web/src/lib/strings.vi.ts`: every UI string, Vietnamese, with the copy of spec §6 as written,
  including library defaults that would otherwise be English (shadcn's sr-only "Close", dnd-kit's screen
  reader instructions and announcements, sonner's close button label); a lint rule in
  `eslint.config.mjs` fails on a UI string outside it, `apps/web/src/components/ui/` included (spec AC
  7).
- Run log, `apps/web/src/app/(app)/runs/page.tsx`, in the Main nav group for everyone (members see
  manual runs as "manual", without who triggered them); the Run now control lands on the keyword page in
  Step 6.
- Admin pages, built on the shell and tokens: users, stores (`erp_store_code`, `pod_studio_store_id`,
  `lark_chat_id`), memberships with ticks, keywords (seed and store), settings (every field of the
  spec's Setting entity, including the LLM model, which lives only there), feeds, holidays, alerts with
  "Đã xử lý", which sets `resolved_at`, and the crawler attention bar for admins, shown while
  `blocked_until` is in the future or an Alert has no `resolved_at`. A page or action the user may not
  use returns 404 through `notFound()`, the same as a missing page; a disabled action states its reason.
  Route `loading.tsx` files render skeletons with the real layout.
- UX test harness, reused by Steps 6 and 7: `apps/web/playwright.config.ts` (projects 1440 and 390 px
  wide; `toHaveScreenshot` with `maxDiffPixelRatio: 0.01` and animations disabled),
  `apps/web/e2e/fixtures/seed.ts` (fixed seed data, one fixture per special state), a frozen clock
  (Playwright `page.clock` in the browser and a test-only fixed `now` for server code),
  `apps/web/e2e/support/axe.ts` (`@axe-core/playwright` scan that fails on any serious or critical
  violation), `apps/web/e2e/support/actions.ts` (counts actions as spec §6 defines them: one per mouse
  click, a drag being one press, and one per key press) and `apps/web/e2e/support/a11y.ts`, the checks
  axe does not make: every element reached by Tab shows a visible focus indicator (its outline or box
  shadow differs from the unfocused state); the borders of inputs whose border is their only edge
  (`input`, `textarea`, `select`, `[role=combobox]`), the focus ring and chart lines reach 3:1 against
  their background (WCAG 1.4.11, from computed colors); no open sheet, popover or toast has a
  `transition-duration` or `animation-duration` over 220 ms; every target is at least 24 × 24 px or
  spaced as WCAG 2.5.8 allows (from bounding boxes). `scripts/check-ui-colors.ts` compiles the classes
  used in `apps/web/src/components/ui/` with Tailwind's `compile()` against `theme.css` and fails when a
  color utility (`bg-`, `text-`, `border-`, `ring-`, `fill-`, `stroke-` or `outline-` with a color name)
  produces no CSS, so non-color utilities such as `text-sm` or `ring-2` never trip it. Baselines live in
  `apps/web/e2e/__screenshots__/` and gate a step only after the owner approves them.
- Exit: Playwright e2e: admin creates a member with `save` on store A; the member sees store A only; a
  member opening store B's ideas or an admin page gets 404; a link to a page opens it with 0 actions on
  a valid session and is kept through sign-in; a callback of `//example.com`, `/%09/example.com` or an
  absolute URL lands on `/briefing`; the sign-in page without a session loads its CSS, JS and fonts; the
  test reads `--font-geist-sans` from `<html>`, checks that the body's computed `font-family` starts
  with it and, after `document.fonts.ready`, that `document.fonts.check` is true for it, never importing
  `geist` or `next/font`; a default shadcn `Button` has a computed background of `#1c1917`, and an open
  Sheet, its overlay, a Tooltip and a sonner toast each have a computed background that is not
  transparent; `scripts/check-ui-colors.ts` passes; `/shops/example.com` without a session goes to
  `/login`; the sidebar's collapsed state survives a reload, and text on `--ih-sidebar-hover-bg` passes
  the contrast check; a session whose `updatedAt` and `expiresAt` were moved back 2 days has, after one
  `page.goto` (a full page load), a new `expiresAt` 7 days ahead and a cookie with a `Max-Age` of 7
  days; `/_next/image` without a session, or with a disabled user's session, is refused; Ctrl+K treats
  `%` and `_` as plain characters, ranks the closer match first and shows a member no "Quản trị" screen;
  "Đã xử lý" on the last open Alert hides the attention bar when `blocked_until` is past; axe reports no
  serious or critical violation on sign in, the run log, admin settings and the other admin pages, its
  contrast rule covering the muted text `#75706a`; the `a11y.ts` checks pass on the same pages;
  `toHaveScreenshot` of sign in at 1440 and 390 px, with the seed data and frozen clock, matches the
  owner-approved baseline within 1%; the Loading, No permission and Crawler attention states each have a
  seeded fixture and a screenshot; the string lint passes.
- Progress (2026-10-20): built on branch `step-5-web-app`. `apps/web` on port 3300 (e2e 3310, database
  `ih_e2e`): better-auth with the admin plugin, `proxy.ts`, the shell (sidebar, store switcher, Ctrl+K,
  attention bar, phone tabs), the run log and every admin page, with all UI strings in
  `src/lib/strings.vi.ts` and the string lint in `eslint-rules/ui-strings.mjs`. Every Exit item has an
  e2e test (39: desktop 1440 and phone 390), run in CI by a new "End-to-end (web)" step; locally 39 pass.
  Pins (ADR 0001 age rule, POD Studio's where it has one): next 16.4.0, react 19.3.0, better-auth 1.7.7,
  tailwindcss and @tailwindcss/postcss 4.3.3, radix-ui 1.7.0, lucide-react 1.49.0, sonner 2.0.8, cmdk
  1.1.1, tw-animate-css 1.4.0, geist 1.7.2, zod 4.6.5, nanoid 6.0.2, sharp 0.35.5, @axe-core/playwright
  4.13.0, @playwright/test 1.63.0; shadcn components generated with `shadcn@4.21.3`. Decisions, with
  reasons:
  - Screenshots: `e2e/support/screens.ts` compares with `toHaveScreenshot` only once
    `e2e/__screenshots__/APPROVED` exists; until then each screenshot is written to
    `e2e/__screenshots__/pending/<platform>/` and attached to the report, so a missing approval never
    fails a run. Pending owner: approve the baselines (sign in at 1440 and 390, Loading, No permission,
    Crawler attention; the Windows set is committed under `pending/win32/`), then move them to
    `e2e/__screenshots__/<platform>/` and add `APPROVED`; CI on Linux needs its own `linux` set.
  - "Admin creates a member with `save` on store A" is tested as the admin adding an existing member to
    store A with `save` (users are created on `/admin/users` or with `pnpm auth:create-user`). The
    member's 404 on store B's ideas is checked at `/ideas?store=…`, which is a 404 for everyone until
    Step 6 adds the page; Step 6's permission tests replace it.
  - Admin pages answer 404 from `admin/layout.tsx`, above the `loading.tsx` boundaries: with a loading
    boundary above the check the 200 status streamed before `notFound()`.
  - The Loading screenshot holds the navigation's RSC request after the route's prefetch has arrived:
    Next 16 shows the loading state only from a completed prefetch.
  - Inputs use `focus:` rather than `focus-visible:` for the ring: Chrome does not match
    `:focus-visible` on a date input whose inner field has focus. The `a11y.ts` focus check moves focus
    to a temporary element instead of `blur()`, which does not leave a date input's inner field.
  - `scripts/check-ui-colors.ts` checks every `.tsx` under `src`, not only `components/ui`, and runs as
    a unit test, so CI covers it.
  - Saving settings wrote SQL NULL for an empty proxy or browser profile into the `not null` jsonb
    column (the toast test failed with a server error); the action now writes JSON `null`.

### Step 6. Research views and save-idea from ads and by hand (weeks 5–7)
- Pages: ads grid (status from `adStatus`, default filter "running", other ads labelled "out of top
  results" or "stopped or unknown"; filters keyword, country, days active, score, domain), ad detail,
  shops, keywords, per-keyword report (sections 1–4, "running" ads only) at `/keywords/[id]` and, for a
  past date, `/keywords/[id]/[date]`.
- Ads in three columns (spec §6): `apps/web/src/app/(app)/ads/{page,loading}.tsx` and
  `apps/web/src/app/(app)/ads/[id]/page.tsx` (a direct link opens the pane),
  `apps/web/src/components/ads/{filter-rail,ad-grid,detail-pane}.tsx`: filter rail 200 px, card grid,
  sticky detail pane 360 px; click or Enter fills the pane, arrow keys move the selection, `S` saves and
  `O` opens the Ad Library link, both only while a card has focus and never while typing in a filter
  field; each card is one stretched link with "Lưu" a separate button above it, so no control is nested;
  below 1280 px a right sheet, on a phone a bottom sheet with "Lưu" pinned. Filters and sort in the URL
  query.
- Thumbnails: `apps/web/src/lib/thumb-url.ts` signs a key (HMAC-SHA256 of the decoded key with
  `THUMB_URL_SECRET`, added to `.env.example`, hex, no expiry) into `/thumbs/[sig]/[key]`;
  `apps/web/src/app/thumbs/[sig]/[key]/route.ts` accepts only a one-segment key matching
  `^[A-Za-z0-9_-]+\.(jpg|webp)$`, checks that the signature is 64 hex characters before comparing it in
  constant time (`timingSafeEqual` throws on buffers of different lengths), returns 404 when either
  fails, and streams the object from the thumbnail prefix in MinIO with a Content-Type from an allow
  list (`image/jpeg`, `image/webp`) and `X-Content-Type-Options: nosniff`; the session is not checked
  there, since the image optimizer fetches the source without headers (Step 5's `proxy.ts` lets
  `/thumbs/**` through). `apps/web/next.config.ts` sets `images.localPatterns` for `/thumbs/**`, adds
  320 to `images.imageSizes` (the default list has no 320), keeps Next's default `images.formats` (WebP)
  and leaves `dangerouslyAllowLocalIP` off; cards ask for 320 px wide images (at most 640 px wide at
  2x), lazy below the first viewport; a thumbnail that fails to load is replaced by the "Chưa có ảnh"
  tile through `onError`. SavedIdea snapshots keep the key, signed when a page renders. The worker names
  keys as Step 3's upsert sets.
- Idea images: the manual idea form posts to `apps/web/src/app/api/ideas/manual/route.ts`, a route
  handler rather than a Server Action, since Server Action bodies are capped at 1 MB by default (next
  16.4.2 `dist/server/app-render/action-handler.js` lines 513–515) and raising
  `experimental.serverActions.bodySizeLimit` would raise it for every action; it is the only entry point
  for a manual idea with an image. The proxy `matcher` leaves the route out, so the proxy does not
  buffer its body, and the handler checks the session itself (401 without one) and `save` on every
  chosen store (403 otherwise); it answers 403 unless `Origin` equals the app origin, taken from the
  configured public URL and never `request.nextUrl` since the app runs behind the tunnel, or
  `Sec-Fetch-Site` is `same-origin`. It refuses a request whose `Content-Length` is over 5 MB + 64 KB,
  reads `request.body` with a byte counter and aborts over that limit, and only then parses the buffered
  bytes with `new Response(buf, { headers: { 'content-type': <original> } }).formData()`, keeping the
  request's boundary, with no new dependency; every size refusal, by `Content-Length`, by the byte
  counter or for a file part over 5 MB, answers status 413 with "Ảnh lớn hơn 5 MB", never a bare 413. It
  checks the magic bytes (JPEG, PNG or WebP, otherwise "Chỉ nhận ảnh JPEG, PNG hoặc WebP"), then runs
  `sharp(buf, { limitInputPixels: 5e7 })` with
  `.rotate().resize({ width: 640, height: 1920, fit: 'inside', withoutEnlargement: true })` and
  `.webp()`, so a 48 MP image within 5 MB passes ("Ảnh quá lớn (trên 50 megapixel)" over the limit,
  "Không đọc được ảnh này" when it cannot decode). It writes one object per chosen store under
  `ideas/<store_id>/` in MinIO with a nanoid key, never the file name, outside the thumbnail prefix,
  then the rows in one transaction with the key in `saved_ideas.image_key`, and deletes the objects it
  wrote if any step fails; "Hoàn tác" deletes those objects with the rows.
  `apps/web/src/app/ideas/[id]/image/route.ts` serves an image after checking the session and the idea's
  store scope (404 otherwise), with `Content-Type: image/webp`, `nosniff` and
  `Cache-Control: private, no-store`; pages show it with `next/image` `unoptimized`, since the
  optimizer's fetch carries no session.
- Run now on `apps/web/src/app/(app)/keywords/[id]/page.tsx`, for admins and for users with the `keywords`
  tick on a store that tracks the keyword, through a server action that applies Step 3's checks; when
  one refuses, the button stays visible but disabled with its reason: "Đang có run khác" (a run
  `running`, or a manual or `cli` row waiting), "Crawler đang nghỉ đến 14:20" (`blocked_until`) or
  "Không còn đủ thời gian trước ca 13:00" (now is already inside the margin before the next slot).
- Charts: `apps/web/src/components/charts/trend-chart.tsx` (shadcn chart, Recharts) on
  `apps/web/src/app/(app)/keywords/[id]/page.tsx` from `keyword_days` and
  `apps/web/src/app/(app)/shops/[domain]/page.tsx` from `shop_days`: one series per slot in the fixed
  colors of spec §6 by slot order (`--ih-series-3` checked in spec §6), the x-axis the date of
  `scheduled_for` in Asia/Ho_Chi_Minh, a gap for a missing snapshot (`connectNulls` off), axis labels
  and values in ink, the "7 ngày trước" rule, range 14 / 30 / 90 / all (30 by default) and the "Bảng"
  table toggle; `react-is`, a required peer of recharts 3.10.1, declared directly and pinned to the same
  version as `react` (ADR 0001).
- Ideas: `apps/web/src/app/(app)/ideas/page.tsx` with
  `apps/web/src/components/ideas/{idea-table,idea-board}.tsx`: the table with status tabs and an inline
  status menu; the Kanban board with `@dnd-kit/core` only (draggable cards, droppable columns, pointer
  and keyboard sensors, announcements from `strings.vi.ts`, and a `coordinateGetter` in
  `apps/web/src/components/ideas/board-keyboard.ts` that moves a picked-up card to the next column on ←
  or →, keeping its current y clamped inside that column's visible rect so the page never scrolls, with
  ↑ and ↓ a no-op, since the default keyboard sensor moves 25 px per press, @dnd-kit/core 6.3.1
  `dist/core.esm.js` lines 1111 and 1121), cards sorted by `updated_at` descending with no position
  field, and a status menu on every card, allowing a move between any two statuses, backwards included
  (Done back to New); a member with only `view` gets the table and the board without status menus and
  the board without drag; on a phone, cards and one column per status without drag; the view toggle kept
  in local storage, table by default; "Ý tưởng mới" for manual ideas.
- Save: `apps/web/src/components/save/{save-button,save-popover}.tsx` and a server action: 1 action with
  one store; with several, a popover pre-checked with the stores in which the user's last save created
  an idea (the user's `saved_ideas` rows with the latest `created_at`: one save is one transaction, so
  its rows share `now()`; no new column) and Enter; the result per store, "Đã lưu" or "Đã có sẵn · Mở";
  the sonner toast (`duration` 10 000 ms) with "Hoàn tác", which deletes only the ideas this save
  created and which the server accepts up to 15 s after the rows' `created_at` (the toast's 10 s plus
  slack for a paused toast) and then answers "Đã quá thời gian hoàn tác"; it also deletes the uploaded
  images of those ideas; after an undo, a "Đã có sẵn · Mở" link to an undone idea opens a 404 page, as
  spec §4 states; only for users with `save` on 2 or more stores, "Thêm store khác". Save from ad card
  and manual with a link (a manual idea with an image goes through `/api/ideas/manual` above); snapshot;
  status New/Picked/Done/Dropped; assignee; unique (store, source, source_ref), manual ideas with only
  an image are not deduped; list filters and CSV.
- Special states of this step in `apps/web/src/components/states/*.tsx`: No data yet, Less than 7 days,
  the ad status chips with their tooltips, and the missing thumbnail tile.
- Exit: integration tests (disposable DB) for the AC 4 permission matrix on ideas, tracked keywords and
  `POST /api/ideas/manual` (a chosen store without `save` gets 403 and nothing is stored), and for save
  dedupe and CSV. The AI-section part of AC 4 is tested in Step 7. Playwright e2e counts actions (one
  per click, drag or key press): a save from the ads grid takes 1 with one store and 2 with several;
  opening an ad's detail takes 1; changing an idea's status from its menu takes 2 in the table and on
  the board; a drag to another column takes 1; a keyboard move on the board takes 2 plus the columns
  crossed (Done back to New: 4), and a unit test of `board-keyboard.ts` moves a card one column per ← or
  → press, keeps its y inside the column's visible rect, and leaves it in place on ↑ and ↓; a user with
  `save` on one store sees no "Thêm store khác"; Ctrl+K finds an ad by part of its caption, page name or
  domain; "Hoàn tác" removes only the ideas it created, is accepted by the server at 14 s and refused at
  16 s with "Đã quá thời gian hoàn tác"; `S` typed in a filter field saves nothing. Run now: with a
  seeded `running` run, with `blocked_until` at 14:20, and with the clock inside the margin before
  13:00, the button is disabled with each reason in turn; a member without `keywords` sees no Run now
  and the server action refuses. With a session, a thumbnail renders through `next/image`;
  `/_next/image?url=/thumbs/…` without a session is refused; `/thumbs/…` with a wrong signature, a
  truncated signature, a valid signature on an altered key, or with a key containing `..`, `/` or `%2F`
  returns 404; a served thumbnail is WebP, 320 px wide and at most 40 KB at 1x and, with `w=640`
  requested, at most 640 px wide and 90 KB at 2x; a missing file shows the "Chưa có ảnh" tile; a run
  that starts after midnight for the previous day's slot plots on the slot's date. A 4.9 MB JPEG is
  accepted; a 6 MB file is refused with "Ảnh lớn hơn 5 MB", not a bare 413, both when its
  `Content-Length` is sent and when the byte counter stops a body sent without one; an SVG upload and a
  file whose magic bytes are not JPEG, PNG or WebP are refused; a JPEG with EXIF orientation 6 is stored
  upright; a 48 MP image within 5 MB passes (its fixture is at most 5 MB); a small PNG declaring more
  than 50 megapixels is refused with "Ảnh quá lớn (trên 50 megapixel)" without exhausting memory; a
  cross-origin POST gets 403; a POST to `/api/ideas/manual` with no session gets 401 and stores no
  object and no row; a failure injected after the objects are written leaves no object; a manual save to
  two stores stores two objects, and "Hoàn tác" deletes both; a member of store A gets A's idea image
  and 404 for store B's; both image routes send an allow-listed Content-Type and `nosniff`, and the idea
  image route `Cache-Control: private, no-store`. A view-only member's table and board have no status
  menu, and the board no drag. axe reports no serious or critical violation (`nested-interactive`
  included) on ads with the pane, a shop, a keyword report with chart, and the ideas table and board,
  and the Step 5 `a11y.ts` checks pass there. `toHaveScreenshot` at 1440 and 390 px of ads with the
  pane, the keyword report with chart, the ideas table and the ideas board, with the seed data and
  frozen clock, matches the owner-approved baselines within 1%. The four states of this step each have a
  seeded fixture and a screenshot.
- Progress (2026-10-20): built on branch `step-6-research`. Pages `/ads` (with `/ads/[id]`), `/shops`,
  `/shops/[domain]`, `/keywords`, `/keywords/[id]`, `/keywords/[id]/[date]`, `/ideas`, `/ideas/[id]`;
  queries in `packages/db/src/queries/{research,ideas}.ts`; the thumbnail, manual idea, idea image and
  CSV routes; e2e in `e2e/{research,ideas}.spec.ts`, the Step 6 pages added to `a11y.spec.ts` and the
  screens to `screens.spec.ts`. Pins (ADR 0001 age rule): recharts 3.10.1, react-is 19.3.0 (same as
  react), @dnd-kit/core 6.3.1; `@aws-sdk/client-s3` 3.1142.0 and pg-boss 12.37.0 as in the worker; the web
  app imports the worker's manual-run entry (`@ideas-hub/worker/manual`) so Run now applies Step 3's
  checks in one place. Decisions, with reasons:
  - "Hoàn tác" at 14 s and 16 s is tested in `ideas.test.ts` against the query with an injected clock:
    the e2e server's clock is frozen (`IDEAS_HUB_FIXED_NOW`), so a browser test cannot move it.
  - "The clock inside the margin before 13:00" is tested by setting the `runTimes` setting to
    `["01:00", "08:45"]` in the e2e database: the frozen clock is 08:30, inside the 25 min margin before
    08:45, which gives the same refusal ("Không còn đủ thời gian trước ca 08:45") without a second clock.
  - The upload edge cases (4.9 MB, missing `Content-Length`, SVG, magic bytes, EXIF, 48 MP, pixel bomb,
    cross-origin, no session, injected failure, two stores and undo) are integration tests of the route
    handler (`api/ideas/manual/handler.test.ts`) with a fake object store; e2e covers the dialog with a
    link and a 6 MB request answered 413 with "Ảnh lớn hơn 5 MB".
  - "Run now refuses without `keywords`" is a unit test of `lib/run-now-rules.ts`, the rule the server
    action calls; e2e checks the button is absent for such a member.
  - The "Less than 7 days" label names the baseline's crawl day (Pacific, spec §3), while the chart's x
    axis uses the slot's Asia/Ho_Chi_Minh date (spec §6), so the 01:00 run of 18/10 VN is "từ 17/10".
  - The board's columns are regions named by the status alone; the count stays in the heading.
  - `adLibraryUrl` lives in `components/ads/ad-library-url.ts`: the server detail pane cannot call a
    function exported from the `'use client'` grid.
  - The seeded thumbnails are 600 px JPEGs with light Gaussian noise (sigma 8): with sigma 20 the 640 px
    WebP was 97.7 KB, over the 90 KB limit, because such noise barely compresses, unlike an ad photo; the
    limits themselves are unchanged. `e2e/global-setup.ts` clears `.next/cache/images`, since the seed
    rewrites thumbnails under the same keys and the optimizer would serve the cached ones.
  - Fixed while adding the a11y checks of these pages: ad cards carry their own focus ring (the check
    reads the focused element, not the card), the chart surface shows an outline on focus (shadcn's chart
    hides it), every `loading.tsx` skeleton has `role="status"` (axe's `aria-prohibited-attr` for an
    `aria-label` on a plain div; probably also the cause of the Step 5 axe failure on `/admin/feeds` that
    did not recur, not verified), and the store page's checkboxes are 24 px (WCAG 2.5.8 once a store has
    more members).
  - CI starts MinIO with `docker run` (a service container cannot take `server /data`) for the e2e
    thumbnails and uploads; the e2e app uses its own bucket `ideas-hub-e2e`.
  - Pending owner: approve the Step 6 screenshots in `e2e/__screenshots__/pending/win32/` (ads-pane,
    keyword-report, ideas-table, ideas-board at desktop and phone; the four states), as in Step 5.

### Step 7. RSS, holidays, AI sections, Lark, save from suggestion (weeks 7–9)
- `packages/sources/rss` (rss-parser), `packages/db/seed/holidays-us.json`, `scripts/acceptance.sql` (AC
  1 Alert checks, AC 3, AC 6), `packages/core/src/briefing/{sections,prompt,schema,cost}.ts`, worker
  jobs `briefing.build` (06:30 Asia/Ho_Chi_Minh, uses the last completed scheduled run, the last one
  that wrote its `keyword_days` and `shop_days`, "running" ads only in sections 1–4, sections 3 and 4
  from `keyword_days` and `shop_days` with `deltaAt` on the run's slot) and `lark.send` (idempotent per
  briefing and chat).
- `briefing.build` and `lark.send` do not write the heartbeat, which only the worker's crawl loop and
  idle timer write; they are bounded by the LLM call timeout (settings, default 120 s; a timed-out call
  counts as a failed attempt under the one-retry rule), the Lark send timeout (settings, default 30 s)
  and `job.signal`, passed to the openai client and the Lark `fetch`, with their queries under a 60 s
  `statement_timeout`, because expiry alone does not stop a handler; a global briefing not ready in time
  raises `briefing_late`. Settings validation rejects an LLM call timeout whose two attempts would not
  fit in one `briefing.build` job's expiry (default 900 s). LLM calls are counted per briefing in
  `briefings.llm_calls`: at most 2 per briefing, job reruns included, since a rerun does not reset the
  count; the increment and the estimated cost are written and committed on their own before each call,
  so a call cut by a crash still counts. After 2 failed calls the briefing still gets `ready_at` with
  sections 1–4, and sections 5 and 6 are stored as "failed: AI". `briefing.build` is idempotent per
  briefing and section: stored sections are kept, so no AI cost is spent twice. At startup the worker
  cancels the `briefing.build` jobs and fails the `lark.send` jobs still active from before the restart
  (crash recovery, Step 3), then sends `briefing.build` again for each of today's briefings with no
  `ready_at` once today's build time has passed (`singletonKey` `${date}:global` or
  `${date}:kw:${keyword_id}`, the global one at a higher `priority`). Tests: the LLM timeout validation
  (rejected when two attempts exceed the expiry, accepted at 120 s), a timed-out call retried once, a
  Lark post over its timeout retried by `lark.send`, a second `briefing.build` for the same key not
  queued (`send()` returns null on the `exclusive` queue), one global and 3 keyword briefings all queued
  (4 non-null ids) and all built, the global job fetched first when all 4 are sent in one transaction, a
  failed build retried once, a rerun after one LLM call making at most one more call for that briefing,
  the scheduler sending one `briefing.build` per briefing with `startAfter` = the build time and the
  global one first, a `lark.send` retry reusing the same `uuid`, a restart while `lark.send` is active
  giving exactly one post and one message id, a `lark_messages` row older than 1 hour without a message
  id giving no new post and a `lark_send_failed` Alert, a `briefing.build` handler that overruns its
  expiry aborted through `job.signal`, a crash during an LLM call followed by a rerun that makes at most
  one more call, two failed calls giving a ready briefing with sections 1–4 and "failed: AI" for 5 and
  6, a change of build time re-sending that day's jobs with the new `startAfter`, and a build cut by a
  worker restart finished after it without a second AI charge for finished sections.
- `scripts/acceptance.sql` gains AC 1's Alert checks (every run with a `blocked` or `parse_error` search
  has that Alert with a Lark message id, and each run's `network_error` Alerts equal its
  `network_cooldowns`, each with a Lark message id), AC 3 (global briefing `ready_at` before 07:00 on ≥
  13 of 14 days, 6 sections not skipped or failed, a Lark message id, evidence refs resolve, daily AI
  cost ≤ cap) and AC 6 (ideas by non-admin members with `via = briefing` in the 14 days, per store row).
- AI: global briefing first, then store-tracked keywords until the cap; pre-call estimate from
  `max_tokens` × model price table, checked before every call including the retry; Vietnamese prompts;
  model name read from settings (default Claude Sonnet 5.5), base URL and key from the environment;
  zod-validated output; evidence refs must match ids that were sent in the prompt, one retry, otherwise
  drop the suggestion. A skipped AI section is stored as "skipped: cost cap" and shown as in the states
  bullet below.
- Lark: summary (3 key points, top 5, link) to the shared group; store chats get their keywords. The
  watchdog (Step 3), not the worker, sends every unsent Alert to admin and stores its Lark message id. A
  briefing post that still fails after `lark.send` retries writes a `lark_send_failed` Alert, shown on
  the admin alerts page as well; the watchdog writes one too when the global briefing is ready but the
  shared group has no message id by the ready time (Step 3).
- Briefing page (spec §6): `apps/web/src/app/(app)/briefing/{page,loading}.tsx` and
  `apps/web/src/app/(app)/briefing/[date]/page.tsx`: the KPI row from the source run (`running_ads`; its
  change against the `running_ads` of the same slot 7 crawl days earlier with `deltaAt` and the §3
  baseline label, the baseline being the run of that slot that wrote `keyword_days`; `ok_searches` ÷
  `planned_searches` as a percentage; days to the next US holiday from `holidays`), then the panels in
  two columns; the source run's label ("Từ run 01:00 ngày 19/10"); a row opens the ad pane as a sheet;
  on a phone, 2 × 2 KPI tiles and stacked panels. Before today's global briefing is ready and before the
  ready time, `/briefing` shows the latest ready briefing with "Đang hiển thị briefing ngày 18/10; bản
  hôm nay sẽ có trước 07:00".
- Save from suggestion with the same "Lưu" button, popover and toast as Step 6 (1 action with one store,
  2 with several), setting `via = briefing`; ad rows in briefings also set `via = briefing`, and so does
  a save from the ad sheet opened from a briefing row.
- States: the Briefing late banner ("Briefing hôm nay chưa sẵn sàng, đang hiển thị bản 18/10" with "Xem
  lại", the date being that of the last ready briefing, which is shown) when today's global briefing has
  no `ready_at` after the ready time; a skipped AI section shown as "Bỏ qua: đã hết hạn mức AI hôm nay"
  and a failed one as "Chưa tạo được phần AI hôm nay", with sections 1–4 still shown; the Before the
  ready time state as above.
- Exit: Playwright e2e for AC 5 (save from ad, suggestion, manual; second save opens the existing idea;
  CSV has the rows) with seeded suggestions; integration tests for the AI-section part of AC 4; a
  briefing for the last run renders 6 sections and posts to the test Lark group; a run with two network
  cool-downs has two `network_error` Alerts, each sent with its own Lark message id, and seeded
  `blocked` and `parse_error` Alerts are each sent with a Lark message id. Playwright e2e counts
  actions: a Lark link opens the briefing with 0 actions on a valid session, and a save from a briefing
  row, from the ad sheet of a briefing row (stored with `via = briefing`) or from a suggestion takes 1
  action with one store and 2 with several. The KPI baseline skips a run of that slot that wrote no
  `keyword_days` (Step 3 tests `running_ads` itself). The KPI row shows a seeded run's `running_ads`,
  its change and `ok_searches` ÷ `planned_searches`, and the source run's label. axe reports no serious
  or critical violation on the briefing; `toHaveScreenshot` of the briefing at 1440 and 390 px, with the
  seed data and frozen clock, matches the owner-approved baseline within 1%; the Briefing late, Before
  the ready time, AI section skipped and AI section failed states each have a seeded fixture and a
  screenshot.

- Progress (2026-10-20): built on branches `step-7-briefing` (web) and `step-7-worker` (worker, core, db,
  RSS), merged into one PR. The shape of `briefings.sections` is a shared contract in
  `packages/core/src/briefing/sections.ts`; decisions of the build and delivery are in
  `docs/adr/0004-briefing-build-and-delivery.md`. Built: `packages/sources/rss`, `pnpm db:seed` with
  `packages/db/seed/{news-feeds,holidays-us}.json`, `packages/core/src/briefing/{prompt,schema,cost}.ts`,
  the `briefing.build` and `lark.send` jobs with scheduling, crash recovery and the watchdog's
  `briefing_late` and `lark_send_failed` checks, the Lark bot behind `LARK_*` variables (tests use a fake
  Lark server, nothing is posted), the LLM client behind an interface (tests use a fake client; no real
  call was made), the AC 1 Alert, AC 3 and AC 6 checks in `scripts/acceptance.sql`, the read queries in
  `packages/db/src/queries/briefing-view.ts`, the briefing pages `/briefing` and `/briefing/[date]` with
  the four states, saves from rows, the ad sheet and suggestions (`via = briefing`), the keyword report's
  AI sections and the sidebar badges (briefing date, New ideas). Decisions, with reasons:
  - RSS feeds are fetched by the global `briefing.build` just before section 5 (15 s per feed, one
    failing feed does not stop the others), so each feed is read once a day and news is fresh at 06:30.
  - Feeds and holidays are seed data (`pnpm db:seed`, idempotent), not a data migration, so the JSON files
    stay the one source; a fresh database needs `pnpm db:seed`.
  - The cost estimate is an upper bound (prompt characters ÷ 3 at the input price plus `max_tokens` at
    the output price) and is what `ai_cost_usd` records.
  - Saving a keyword briefing's suggestion goes through `keywordBriefingFor`, the same AC 4 check that
    decides whether the keyword report shows the AI sections, so the server refuses what the page hides.
  - The "Before the ready time" state is tested by moving `briefingReadyTime` to 09:00 in the e2e
    database: the server clock is frozen at 08:30.
  - The a11y focus check now moves focus inside an open dialog, since the dialog's focus trap returned
    focus to the element and every control in the ad sheet read as having no focus indicator.
  - Pending owner: Lark app id and secret, the shared and admin chat ids and a first real post; the LLM
    endpoint and a first real briefing (`pnpm briefing:build`); review the feed list in
    `packages/db/seed/news-feeds.json` (the URLs were never fetched); check `MODEL_PRICES` in
    `packages/core/src/briefing/cost.ts` (not checked against a price list); approve the Step 7
    screenshots in `e2e/__screenshots__/pending/win32/` (briefing at desktop and phone, the four states).
  - Review fixes (2026-10-20, branch `fix-step7-hardening`): suggestion saves go through the tested
    `suggestionForViewer` (same `canSeeKeywordAi` rule); `saveAction` input checked with zod and the
    snapshot keyword kept only when the ad was seen for it; `lark.send` gives up two post timeouts
    before the 1 h uuid window ends; manual ideas cap the title at 140 characters and the link at 2048
    UTF-8 bytes, and answer 500 with a log line when `APP_URL` is not set; a missing LLM key fails
    sections 5–6 without reserving a call or cost; `restore.sh` exits 1 on a row-count mismatch.

### Step 8. Contract, Linux trial, onboarding, acceptance run (weeks 9–11)
- `docs/contracts/ideas-hub-v1.md` draft (spec §5), reviewed with the POD Studio owner; nothing built.
- Linux desktop, **only after the owner's go-ahead** (it hosts POD Studio production): first stop the
  Windows worker, scheduler, watchdog task and Lark sends, so no run or post happens after the dump;
  its own compose project and DB, restored from the Windows DB (`pg_dump`) so history carries over;
  systemd user units with restart policy, lingering, and the display/session that headed Chrome
  needs; a systemd timer for the watchdog every 5 min; a new Cloudflare tunnel hostname without
  editing POD Studio's tunnel config; block-rate re-check for 2 days. Windows stays stopped once
  Linux crawls.
- Briefing LCP on the Linux trial: `scripts/lcp-briefing.ts` (Playwright, desktop 1440 px, a valid
  session, a `PerformanceObserver` on `largest-contentful-paint`), run on the development PC, loads the
  briefing once to warm the caches and then 5 times in the same browser context through the Cloudflare
  tunnel hostname; the median of the 5 is under 2.5 s (spec AC 7) and is recorded with the trial notes;
  one day is reserved to fix a slower result before the 14-day run.
- Staff onboarding: accounts, store assignments, a 15-minute walkthrough.
- 14-day acceptance run; `scripts/acceptance.sql` checked daily.
- Progress (2026-10-20): docs and scripts built on branch `step-8-contract`; nothing run on the Linux
  desktop, nothing deployed, no call to POD Studio, Cloudflare, Lark or an LLM. Done:
  `docs/contracts/ideas-hub-v1.md` (Draft: the push of a saved idea to POD Studio with a personal access
  token, `Idempotency-Key` and the responses Ideas Hub expects, every POD Studio-side detail marked "to
  confirm with the POD Studio owner"; `/api/v1` read endpoints for briefings, ideas and stores with
  scoped personal tokens, store scoping, cursor pagination, one error format, rate limits, versioning and
  deprecation, JSON examples from the schema; cross-app keys; out of scope); `docs/ops/linux-trial.md`
  with `deploy/linux/` (`ideashub-xvfb`, `ideashub-web`, `ideashub-worker`, `ideashub-watchdog` service and
  timer, `ideashub-tunnel`, `cloudflared-ideas-hub.yml.example`) and `scripts/linux/` (`dump-windows.ps1`
  `-DryRun`, `restore.sh` and `install-units.sh` `--dry-run`); `apps/web/scripts/lcp-briefing.ts`
  (`pnpm --filter @ideas-hub/web lcp:briefing <base-url>`, its median and threshold unit-tested);
  `docs/onboarding.md`; `docs/ops/acceptance-run.md`. Checks: `bash -n` and shellcheck clean on both
  `.sh`, the `.ps1` parses and its dry run prints the five steps; the LCP script ran once against a local
  dev server on port 3320 with a disposable database and an empty briefing (median 220 ms, exit 0; a dev
  server, so the number says nothing about AC 7). Decisions, with reasons:
  - Units are `ideashub-*`, not `ideas-hub-*`: the watchdog restarts `ideashub-worker` by that name
    (`apps/worker/src/watchdog.ts`) and ADR 0001 names them so.
  - Headed Chrome gets a virtual display (Xvfb `:99`, its own unit the worker requires), not the owner's
    graphical session: with lingering the units start at boot before any login, and nothing shows on the
    POD Studio desktop. The browser mode stays `offscreen`, the mode measured on Windows, so the 2-day
    re-check changes only the host; `headed`, then the graphical session, are the fallbacks.
  - Ports stay those of ADR 0001 (web 3300 on 127.0.0.1, Postgres 5433, MinIO 9300/9301): POD Studio's
    Linux ports are not known from this repo, so `restore.sh` checks them with `ss` and stops if one is
    taken. Ideas Hub keeps its own compose project `ideas-hub` and a separate named tunnel with its own
    config file, so nothing of POD Studio's is edited.
  - The Windows tasks are disabled, not unregistered, so rollback is `Enable-ScheduledTask`; the dump is
    taken inside the container and copied out, since PowerShell redirection re-encodes binary output; the
    MinIO volume is copied as a tar made with the already-pulled `postgres:16-alpine` image, so no new
    image is needed; queued pg-boss jobs carry over with the dump.
  - The push to POD Studio sends image bytes, not a `/thumbs` link: those URLs never expire, and uploaded
    idea images are per-store data with no public URL. `/api/v1` tokens act as their owner at request
    time, narrowed by scopes and an optional store list, and never reveal which store tracks a keyword.
  - The LCP script lives under `apps/web/scripts` (typechecked, linted and tested there, like
    `check-ui-colors.ts`) and evaluates its `PerformanceObserver` from a string: tsx wraps named functions
    in `__name`, which the first run showed does not exist in the page.
  - Gaps found while writing the onboarding guide, left as they are: no screen to change one's own
    password and none to add a store-tracked keyword (SQL in `docs/onboarding.md`).
  - Pending owner: review the contract with the POD Studio owner; the go-ahead for the Linux trial and a
    quiet window, the tunnel hostname and whether Cloudflare Access fronts it, the `sudo` installs (Xvfb,
    Google Chrome, fonts), the 2-day re-check; the LCP check through the tunnel; staff names, store
    assignments and ticks, store keywords, and the walkthrough with each store; the tracking issue and
    the start of the 14-day run after the Linux switch.

## Acceptance criteria (measurable form of the spec's seven)

1. Over 14 consecutive days on the Linux desktop: Σ `ok` + `no_results` ÷ Σ `planned_searches` ≥ 90%,
   over run rows with `trigger = schedule` only (written 14 days ahead by the scheduler, and backfilled
   by the watchdog as `missed`, or as `stopped` when the slot fell inside a cool-down, for any slot of
   the run times then in force, so no slot lacks a row). A row still `scheduled` after its slot, or
   `missed`, counts all its planned searches as failed, and so does a slot closed because
   `blocked_until` covered it (all its searches `skipped`); a `network_error` search is a failure like
   any other non-success. Every run with a `blocked` or `parse_error` search has an Alert of that kind
   with a Lark message id, and for every run the number of `network_error` Alerts equals
   `network_cooldowns`, each with a Lark message id (checked by `scripts/acceptance.sql`).
2. Parser and upsert tests pass. In production data (`interrupted` excluded), every `ok` search has
   `embedded_count` > 0; every `ok` search with `embedded_has_next` true has `pages_read` ≥ 1; and every
   `ok` search that stored fewer than 100 unique ads ended with `last_has_next` false (it reached the
   end of results) or has `stop_reason = no_new_ads` (the 2-page rule), never a silent stop.
3. The global briefing has `ready_at` before 07:00 Asia/Ho_Chi_Minh on ≥ 13 of 14 days, with all 6
   sections generated (not "skipped" or "failed: AI") and a Lark message id. Every suggestion's evidence
   refs resolve. Daily AI cost ≤ cap. Keyword briefings have no deadline.
4. Integration tests: a member of store A cannot read store B's ideas, which keywords B tracks, or the
   AI sections of keyword briefings for keywords only B tracks; an admin can. Only which store tracks a
   keyword is hidden: keyword text is shared data and appears in keyword lists and ad filters for
   everyone.
5. The AC 5 e2e test passes.
6. Ideas created by non-admin members with `via = briefing` and `created_at` within the 14 days:
   ≥ 30 in total and ≥ 10 in each of ≥ 2 stores, counted per store row (one save to two stores counts
   once in each).
7. Checked at the Exits of Steps 5–7: axe reports 0 serious and 0 critical violations on the main
   screens of spec AC 7; e2e action counts, one action being one click, one drag or one key press (Lark
   link → briefing 0, save 1 with one store and 2 with several, ad detail 1, idea status from its menu
   2, a keyboard move on the board at most 2 plus the columns crossed); `toHaveScreenshot` of the 6
   screens at 1440 and 390 px within `maxDiffPixelRatio` 0.01 of owner-approved baselines, and a fixture
   and screenshot for each of the 11 special states; the Step 5 focus, non-text contrast and target
   checks; thumbnails WebP, 320 px ≤ 40 KB at 1x and at most 640 px wide and ≤ 90 KB at 2x (`w=640`);
   the string lint. Checked in Step 8: the briefing's median LCP over 5 warm loads in one browser
   context at 1440 px from the development PC through the tunnel < 2.5 s.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Facebook blocks logged-out crawling | Step 1 probe of three browser modes and Step 4 measurement in the production mode; random delays and graduated backoff before the 6 h stop; tune; proxy before accounts; accounts only via ADR |
| Linux IP or session behaves differently | 2-day re-check on Linux before the 14-day run; systemd lingering, restart policy, headed-session checklist |
| Page or GraphQL change | `parse_error` status separate from blocks, alert, no cool-down; fixtures per source |
| Long runs miss the briefing deadline | Run deadline and 06:05 hard stop; briefing uses the last completed scheduled run; spec §1 run-time estimate, adding 210 s per `network_error` search in the page-load case: at the longest delays and the Step 1 p95 times the 19 min margin after the worst backoff holds 5 such searches, or 2 with one 10 min network cool-down; in the 7-scroll-page case of about 750 s per such search (two browser closes included) it holds only 1, or 8 at mean delays, and with no page cap only the run deadline is a hard bound; the Step 4 measurement checks it at the production schedule |
| Overlapping runs (job expiry) | `singleton` queue (one active `crawl.run` job), expiry of run deadline + grace + 5 min, `retryLimit: 0`; a run starts only from `scheduled`, before its deadline; a manual or `cli` run ends 25 min before the next slot and is refused while another run is `running` or another manual or `cli` row is waiting (partial unique index); worker startup closes a run left `running`; a slot covered by `blocked_until` is closed as `stopped` |
| Worker dies silently | Watchdog on an OS timer, outside the worker: heartbeat, missed slots, Alert sending; a run past its deadline plus grace or with a stale heartbeat is closed, its job failed and the worker restarted; a host that is fully down is noticed only when it comes back |
| LLM invents evidence | Refs checked against ids sent in the prompt; retry once; drop |
| AI cost | Pre-call estimate, global first, daily cap |
| Sightings growth (~30k rows/day) | Rollups on `ads`; sightings kept 180 days |
| Thumbnails expire (assumption) | Step 1 checks it; download in the same job; retry on next sighting; downloading is in the legal review scope |
| Missed pagination goes unnoticed | `embedded_has_next` / `last_has_next` recorded per search and checked by AC 2 |
| `is_active` never turns false (active-only crawl) | Staleness rule `adStatus`, used in the ads grid and briefing |
| Sharing the POD Studio host | Separate ports, DB, units, tunnel hostname; owner go-ahead first |
| Legal exposure | Logged out, no raw HTML stored; legal review timing decided at Gate 0 |
| Low staff adoption | Briefing preview from Step 4; onboarding before the 14-day run; AC 6 tracked daily |
| Screenshot baselines break when fonts or data change | Fixed seed data and a frozen clock; Geist from the pinned `geist` package through `next/font/local`; baselines kept per platform (Playwright adds the platform to their names) and compared on the platform they were made on; a deliberate UI change updates its baselines in the same commit, approved by the owner |
| Thumbnail URLs are bearer links: `/thumbs` serves anyone holding a signed URL, and the `/_next/image` cache serves optimized copies by URL | Signatures cannot be made without `THUMB_URL_SECRET`; signed URLs appear only in signed-in pages; `proxy.ts` requires a session for `/_next/image`; thumbnails are shared research data for every signed-in user; images uploaded for manual ideas are per-store data and never go through `/thumbs`: `/ideas/[id]/image` checks the session and the store scope; rotating the secret invalidates every URL; Step 6 Exit tests the wrong-signature, altered-key, traversal, no-session and other-store cases |

## Verification steps

- Per step: typecheck, lint and tests green before each commit; the exit check of each step recorded in
  its PR description.
- Step 4: block-rate report with raw numbers.
- Steps 5–7: Playwright e2e and integration tests on a disposable database; axe scans, the `a11y.ts`
  focus, contrast and target checks, action counts and screenshot comparisons against owner-approved
  baselines.
- Step 8: `scripts/acceptance.sql` output for AC 1, 2, 3 and 6 attached daily to a tracking issue;
  the briefing LCP result of the Linux trial.

## ADR (consensus)

- **Decision:** deliver phase 1 spike-first and crawler-first (Option A): probe, skeleton and rules,
  adapter, measurement with a SQL briefing preview, web/admin, views and save-idea, AI and Lark, then
  the Linux trial and the 14-day run.
- **Drivers:** unknown block rate; calendar time for the 14-day run; early owner and staff feedback.
- **Alternatives considered:** crawler-first without a spike (production plumbing before the cheapest
  test); platform-first (UI on fake data, wasted weeks if blocked).
- **Why chosen:** answers the existential question in days, and puts real briefing content in front of
  the owner by week 3.
- **Consequences:** a throwaway probe; no UI for about two weeks; two extra ADRs (data model, crawler
  design); the spec's delivery order is replaced.
- **Follow-ups:** Gate 0 decisions; owner inputs per step; legal review; integration contract before
  phase 2.

## Open items (v4 Critic MINOR findings not yet addressed)

Reviewed against `main` on 2026-10-21. Each item is resolved (with the code and the test that show it)
or is a question for the owner.

- Step 1, 72 h thumbnail re-fetch outside "days 1–3": resolved. The re-fetch is a one-off Windows task
  (`spikes/fb-ad-library-probe/register-tasks.ps1:37-38`, `IdeasHub-Probe-Refetch-72h` on 2026-10-23
  04:57). Nothing depends on it: it only re-downloads CDN images, and Step 4's measurement does not use it.
  No test; the task list in `docs/status/` is the record.
- Step 1, no action if the thumbnail URLs do not expire: resolved by design. The worker downloads each
  thumbnail to MinIO when it reads the ad (spec §2; `apps/worker/test/run.test.ts`, "stores ads,
  sightings, thumbnails …" and the "thumbnails in a run" tests), so the app never serves a
  CDN URL and nothing changes whether or not the URLs expire.
- Step 1, no block-rate threshold decides go or no-go after the probe: resolved. Step 4's decision
  point is the threshold: success (AC 1's definition) below 90% after tuning stops the plan and brings
  options to the owner (Step 4 "Decision point"; spec AC 1). The probe feeds that measurement, and
  `docs/research/2026-10-20-block-rate.md` "Decision point" records it (≥ 90% so far). No code, so no
  test.
- Step 2, `days_active` of an active ad: resolved. Spec §1 "Measures" says `days_active` always uses
  the payload's `end_date`, which for an active ad is the Pacific day it was read, not the server's
  today. Code: `packages/db/src/queries/research.ts:80` and `packages/db/src/queries/briefing.ts:106`
  call `daysActive(start_date, end_date)`; tests: `packages/core/src/measures.test.ts:36` ("counts an
  active ad up to today", the read day) and `:53` (a run crossing Pacific midnight uses `end_date`).
- Shop's running ad count as ad statuses change: resolved. `refreshShops`
  (`apps/worker/src/run.ts:230`) recounts every shop's running ads, down to 0, in each run's final
  transaction (`run.ts:173`); test: `apps/worker/test/run.test.ts`, "refreshes each shop's running ad
  count …". Between two runs the count can lag by up to one slot, like KeywordDay.
- Which `via` a save from a keyword report page gets: partly resolved. A suggestion saved from the
  report's AI section gets `via = briefing` like every suggestion
  (`apps/web/src/app/(app)/ideas/actions.ts:48`, plan Step 7 "Save from suggestion … setting
  `via = briefing`"). An ad saved from the report's sections 1–2 gets `via = ads`, the `AdGrid` default
  (`apps/web/src/components/keyword-report.tsx:105,111`); whether those count for AC 6 is an owner
  decision.
- Alerts written before Lark sending is configured: resolved (decided by the owner's delegate on
  2026-10-21, reversible; ADR 0004). The watchdog sends only unsent Alerts of the last 24 h
  (`ALERT_MAX_AGE_MS`, `apps/worker/src/watchdog-pass.ts`) and sets `lark_skipped_at` on older unsent
  ones, which later passes skip; they stay on `/admin/alerts`. Test: `apps/worker/test/watchdog.test.ts`,
  "sends only unsent Alerts of the last 24 h …".

## Open items (v18f narrow Critic, left out of v18g)

Line numbers are those of v18f.

- Plan 588: compare the font family after normalising quotes (the variable gives `'X', 'X Fallback'`,
  Chrome serialises without quotes or with double ones) and call
  `document.fonts.check('16px ' + value)`. Left out: not in the v18g list; it is a test detail to settle
  when Step 5's e2e is written.
- ADR 141 describes Next picking the 640 px device size for a 320 px image at 2x, which is correct; no
  change.

## Changelog (v1 → v2)

- Added Step 1 probe and the headed/headless choice (Architect synthesis, Critic option gap).
- Single singleton `crawl.run` job with expiry and no retry; dropped the `crawl.search` queue
  (Architect 3.1–3.2).
- Run times, run deadline and 06:15 hard stop; briefing uses the last completed run (both reviewers).
- Crawl day = Pacific date of run start, with tests (Architect 3.3).
- Upsert semantics, unique sightings, rollups, retention (Architect 3.4–3.5).
- Keyword-briefing visibility rule, tick implications, per-store save results, image-only manual ideas
  (Architect 3.6–3.7, Critic AC 4).
- `StoreScope` type for store-scoped queries (Architect 3.8).
- `no_results` and `parse_error` statuses separate from blocks (both).
- Defined the AC 1 denominator, missed runs and runtime AC 2 checks (both).
- Settings, crawler-state and Lark-message tables, `ready_at` (Critic 1).
- Gate 0 extended; owner inputs per step; ADR 0002/0003 scheduled (Critic 2–3).
- AI: global first, pre-call estimate, "skipped" defined; keyword briefings have no deadline (both).
- AC 6 now uses `via = briefing`, ≥ 10 per store, members only (both).
- Heartbeat and missed-run alerts; Linux checklist; DB restore to Linux (both).
- Save-from-suggestion and the AC 5 e2e moved to Step 7; automated exits for Steps 5–6 (Critic).
- Holiday admin page, run-now test, injected date in tests, trend-score gating test (Critic 12).
- Timeline estimate and the onboarding step (Critic 13).

## Changelog (v2 → v3, owner review 2026-10-19)

- Plan moved from `.omc/plans/` to `docs/plans/` so it is committed; inputs point at the canonical spec.
- AC 2 rewritten against `embedded_has_next` / `last_has_next`; Step 1 verifies the signal exists.
- Staleness rule `adStatus` (stale-after days in settings) used in the ads grid and briefing, with tests.
- "CDN URLs expire" marked as an assumption checked in Step 1.
- Crossing Pacific midnight documented and tested; rising-new also requires `start_date` within 72 h.
- `collation_id` and `collation_count` stored on ads.
- Node 24 at runtime with a `>=22.12.0` engines floor, and telemetry off in the auth config, per ADR 0001.
- AC 4 clarified: only which store tracks a keyword is hidden, not the keyword text.

## Changelog (v3 → v4, consistency pass 2026-10-19)

- Alert entity (one per run and kind, with Lark message id); AC 1 checks Alerts instead of an
  undefined "alert row".
- Missed runs: `scheduled_for` and `planned_searches` on runs; the scheduler records missed slots;
  AC 1's denominator covers every scheduled slot, including slots with no run row.
- Interrupted searches: new `interrupted` status, `ok` means read to the end or the 100-ad cap; crash
  recovery; AC 2 excludes interrupted searches.
- Step 2 schema now points at the spec's entity table instead of repeating it.
- Admin settings page covers every Setting field; alerts page added.
- AC 4 tests split: ideas and keywords in Step 6, AI sections in Step 7.
- Cost estimate covers the LLM retry.
- Week of the first briefing preview fixed to week 3; fixture count fixed to 4; line wraps fixed.

## Changelog (v4 → v5, MAJOR findings of the v4 Critic review)

- A search that hits a block is `blocked` and keeps its ads; `interrupted` is only for the run
  deadline or a crash, so every block reaches AC 1's Alert check.
- The scheduler writes each scheduled run row ahead of its slot with `planned_searches`; changing run
  times rewrites only future rows; AC 1 counts `trigger = schedule` rows only.
- Watchdog on an OS timer, separate from the worker: marks overdue rows `missed`, recovers crashed
  runs, checks the heartbeat and sends Alerts to Lark. A fully down host is a known limit.
- Ad status computed from `last_seen_date` with an explicit rule for inactive pairs; `no_results`
  counts as a successful search; tests for each case.
- Has-next comes from `page_info` or from a total count; AC 2 uses it either way.
- Cap is 100 unique ads with no page cap, because scroll pages may repeat ads (to be measured in Step 1);
  `last_has_next` defined when no scroll page was read.
- AC 4 hides only the AI sections of keyword briefings, as in the spec.
- Engines floor changed to `^22.12.0 || ^24 || >=26` (nanoid rejects Node 23 and 25), per ADR 0001.

## Changelog (v5 → v6, selected MINOR findings of the v4 Critic review)

- Alert dedupe: one per (run, kind); `heartbeat_lost` is one open incident until a fresh heartbeat;
  briefing kinds one per (briefing, kind).
- `run_failed` written on an unexpected run error and when the watchdog closes a crashed run.
- New Alert kinds `briefing_late` and `lark_send_failed`; undeliverable alerts stay on the admin page.
- Search rows inserted as `pending` at run start, so crash recovery can mark `skipped` and
  `interrupted` searches.
- `first_seen_date` on ads; rising-new uses crawl days instead of hours.
- `created_at` on saved ideas; AC 6 counts per store row.
- The LLM model lives only in settings; the environment holds base URL and key.
- Setting lists every value the spec calls admin-editable.
- Telemetry setting added to Step 5; telemetry re-check at the pinned better-auth version.
- Windows worker, scheduler, watchdog and Lark sends stop before the `pg_dump` to Linux.
- Run history hides who triggered a manual run from members.
- Remaining MINOR findings listed under "Open items".

## Changelog (v6 → v7, owner follow-up 2026-10-19)

- Run rows: the scheduler keeps 14 days of scheduled rows written; the watchdog writes a `missed` row
  for any past slot without one; run-time changes are recorded (`run_time_changes`), so past slots are
  judged by the run times in force then.
- Staleness: only an end-of-results search (`no_results`, or `ok` with `last_has_next` false) proves
  an ad stopped; an ad missing only from capped searches is "out of top results". Briefing sections
  1–4 and shop counts use "running" ads only; Step 2 tests cover the new label.
- Pagination: a search stops after 2 scroll pages in a row with no new unique ad (`stop_reason =
  no_new_ads`), with a test; AC 2 accepts that stop reason.
- ADR 0001: pg and zod are resolved transitively but not pinned.

## Changelog (v7 → v8)

- An empty payload has no new ad either, so 2 empty scroll pages stopped a search as `ok` /
  `no_new_ads` before the 3-empty-payload block threshold: a block counted as a success with no Alert,
  and its ads became "out of top results". The 2-page rule now counts only non-empty pages whose ads
  were all read already; empty payloads go to the block counter only. Test added in Step 3.
- `planned_searches` = min(budget, active pairs); future rows are rewritten when run times, budget,
  countries or keywords change, and a run recomputes it from current settings at start.
- Watchdog backfill looks back at most 14 days and never before the first `run_time_changes` row,
  which the first migration seeds with the default settings.
- Section 3 reads `keyword_days` (running ads per keyword and crawl day, upserted at each run end)
  through `deltaAt`, with a partial baseline when less than 7 days exist; the Step 4 preview too.
- Graduated backoff before the 6 h stop (`pacing.ts`, settings, injected clock and random source),
  random delays inside a search, and a run-time estimate in spec §1 with its assumptions.
- Step 1 probes headed, headed off-screen and headless modes and measures timings and backoff.
- `pg` declared directly and pinned (ADR 0001).
- Open items for the planned-searches formula, the preview baseline and settings seeding are
  resolved; charts and trend alerts are listed in the spec as owner decisions.
- Short broken lines in Step 3 and spec AC 2 reflowed (three were missed: Step 1, Step 3 pagination
  and Step 7; fixed in v9).

## Changelog (v8 → v9, consistency pass after v8)

- Backoff: the 15 min cap could never be reached with a stop at the 3rd blocked search in a row, and
  "blocked, blocked, ok" could repeat all run. The cap is dropped; the run also stops at the 6th
  blocked signal, and settings whose longest pause reaches the heartbeat threshold are rejected. The
  run-time margin is redone with the worst total pause (about 6 min): about 27 min at the longest
  delays.
- Search status and the resistance signal sent to the backoff are kept apart: `ok` resets the streak,
  `no_results` and `parse_error` are neutral, and a 2-page stop with `last_has_next` true stays `ok`
  but signals blocked.
- Empty embedded data without the "no results" marker is a block; the 3-empty-payload rule now counts
  scroll payloads.
- `ShopDay` snapshot for section 4; keyword and shop snapshots are kept per run slot, so the 06:30
  briefing compares the 01:00 run with an earlier 01:00 run; a crashed or missed day falls back to an
  earlier day of the slot, labelled with its date.
- `zod` declared directly and pinned (ADR 0001).
- Remaining short broken lines in Steps 1, 3 and 7 reflowed.

## Changelog (v9 → v10, retries, waits and heartbeat from ttwatch)

- Transient errors inside a search (timeout, destroyed page context, `net::err_`, closed browser) are
  retried up to 2 times after 5 s and 15 s with a browser restart; still transient → `blocked` with a
  blocked signal; a permanent error → `parse_error`, neutral. The job-level "no automatic retry" stays.
- Bounded waits: page load 60 s, embedded data 15 s, each scroll response 15 s; running out is a
  transient error, so slow is told apart from blocked.
- The worker writes its heartbeat at every step and at least once a minute during every pause; settings
  that would make one wait reach the heartbeat threshold are rejected.
- A 2-page stop with `last_has_next` true is neutral to the backoff and counted on the run outside the
  stop thresholds until Step 1 measures how often scroll pages repeat ads, so normal repeats cannot
  stop a run (v9 had it signal blocked).
- Spec Open items again list solving captchas by hand as an owner decision with legal review.
- Tests added in Step 3 for each of the above; the run-time estimate notes the cost of a retry.

## Changelog (v10 → v11, consistency pass after v10)

- A search still transient after its last attempt is now `network_error` (new status and Alert kind),
  not `blocked`: neutral to the block streak and outside the blocked thresholds. 3 searches in a row
  with `network_error` give a 30 min network cool-down (setting) with one Alert per run, then the run
  goes on; no 6 h cool-down. AC 1 counts `network_error` as a failure. Step 1 records whether timeouts
  come with other block signs, so the rule can be revisited.
- Run-time margins redone with `network_error` searches (about 210 s each: 200 s of attempts plus two
  restarts); "about 3.5 min" is now derived. At the longest delays a network cool-down does not fit.
- The worker beats at least once a minute while idle and during both cool-downs; the watchdog raises
  `heartbeat_lost` only from a missing heartbeat. The "every wait is shorter than the threshold"
  sentence now covers idle time and cool-downs.
- Step 1 records attempts and wait-limit hits per search, and its exit tunes the wait limits.
- Step 3 records retries on the run; a permanent search error writes a `parse_error` Alert.
- Boundary defined: an error tied to one search's page or payload is a search error (`parse_error`,
  the run goes on); an error outside a search is an unexpected run error (`stopped`, `run_failed`).
- Wording: "attempts of one search" for retries, "searches in a row" for stop rules.
- Short lines in Step 2 and Step 3 tests reflowed.

## Changelog (v11 → v12)

- Defined once in spec §1: the block streak (blocked searches since the last `ok` or 30 quiet min of
  wall time; neutral and network signals skipped) and the network streak (`network_error` searches in
  a row; any other search resets it). Stop rules, the backoff pause, Setting and `pacing.test.ts` use
  them; new tests: blocked, `no_results`, blocked, blocked stops the run; `network_error`,
  `no_results`, `network_error`, `network_error` gives no network cool-down.
- Run-time margin: a `network_error` search adds 210 s (200 s of attempts plus two 5 s restarts),
  counted in full. The margin after the worst backoff holds 25 such searches at mean delays (22 with
  one 10 min cool-down) and 7 at the longest (4 with one); the "Long runs" risk row matches.
- Network cool-down default lowered from 30 to 10 min, for Step 1 to tune. A 30 min cool-down is
  worth about 20 searches at the longest delays and would push about 9 past the deadline after the
  margin.
- AC 1: every network cool-down has a `network_error` Alert with a Lark message id; the Alert is now
  one per cool-down instead of one per run.
- The spec says, as the plan does, that `network_error` sends a network signal, neutral to the block
  streak.
- Bounded waits include browser start (60 s): a late start mid-run is a transient error of the
  attempt, at run start a `run_failed` run error. A network cool-down counts toward the 30 quiet
  minutes that reset the block streak, on purpose; the 10 min default cannot do it alone.

## Changelog (v12 → v13)

- Step 3 test: one Alert per (run, kind), except `network_error`, one per network cool-down; two
  network cool-downs in one run give two `network_error` Alerts, and Step 7 checks that each is sent
  with its own Lark message id.
- Step 3 bounded waits: the browser start limit from settings is passed as the `timeout` option of
  `launch` and `launchPersistentContext`, since Playwright 1.64.1 defaults to 180000 ms (checked in
  playwright-core 1.64.1: `types.d.ts` and `DEFAULT_PLAYWRIGHT_LAUNCH_TIMEOUT`); a test makes a
  launch exceed the limit from settings.

## Changelog (v13 → v14)

- Run now and slots: a manual run's deadline is the earlier of the run deadline after its start and 15
  min before the next scheduled slot; Run now is not refused because its own cool-down could reach the
  next slot. A scheduled slot that comes before `blocked_until` is closed by the watchdog as `stopped`,
  all searches `skipped`, with a `blocked` Alert, and counts as failed in AC 1. Tests for both.
- `network_cooldowns` added to the CrawlRun counts; the `network_error` Alert is written in the same
  transaction as its increment; AC 1 and `acceptance.sql` check that each run has as many
  `network_error` Alerts as `network_cooldowns`.
- Hung runs: the watchdog closes a `running` run when its heartbeat is stale or its deadline plus grace
  (default 15 min, settings) has passed, as `stopped` with `run_failed`, fails its pg-boss job and
  restarts the worker service. The heartbeat is written from the search loop and its waits, not from a
  separate timer. Bounded waits gain thumbnail download and browser close. Tests added.
- Run-time estimate: 210 s is the page-load case of a `network_error` search; the upper bound is about
  720 s per such search (timeouts at the last scroll, 60 s restarts), at which the margin at the
  longest delays holds only 2. "Conservatively" removed.
- KeywordDay and ShopDay are written only by the worker, for a scheduled run that ran at least one
  search and ended without `run_failed`; runs closed by the watchdog write none.
- Run status defined: `done` when all planned searches ran or the run stopped at its deadline;
  `stopped` on a block, on `run_failed`, or when the watchdog closes it.
- A login wall sends the captcha signal; test added.
- Browser restarts and wait-limit hits per wait added to the CrawlRun counts.
- The worst-pause test asserts ≤ 362.25 s; Step 4 has an Exit line; Step 1's Exit records the chosen
  browser mode.
- Step 3 adds `pnpm crawl:run` with keywords and countries, used by its Exit.
- Step 7's Exit also checks Lark message ids on `blocked` and `parse_error` Alerts.
- Timeline: about 9 weeks (Step 7 ends with week 6, plus 16 days of Linux re-check and acceptance
  run, so around day 58); Step 8 is weeks 7–9.
- ADR 0001: pg-boss jobs start from the run rows instead of cron schedules; production adds the
  watchdog timer and the worker restart.

## Changelog (v14 → v15)

- Thumbnails: the downloads of one search share a total limit equal to the gap before the next search
  (20 s after the last search, never past the run deadline), on top of 15 s per image; what is not
  downloaded in time is left missing and downloaded again at the next sighting. The heartbeat is
  written between downloads. Bounded waits, the run-time estimate and the Step 3 tests updated.
- The watchdog also restarts the worker service when the heartbeat is stale while no run is
  `running` (an idle hang), with the usual `heartbeat_lost` incident; test added.
- Upper bound of a `network_error` search: two browser closes at 15 s added, about 750 s; the margin
  after the backoff still holds 2 such searches at the longest delays and 7 at mean delays.
- CrawlRun `trigger` gains `cli`; `triggered_by` is the user for `manual` runs and null for `cli` runs.
  `pnpm crawl:run` writes `trigger = cli`; the manual-run deadline and snapshot rules name `cli` runs
  too; test updated.

## Changelog (v15 → v16)

- Manual and `cli` runs: the margin before the next slot is 25 min by default, and settings reject a
  margin no longer than the deadline grace plus the 5 min watchdog period. Crash recovery runs at
  worker startup: every run left `running` becomes `stopped` with `run_failed`, its searches
  `interrupted` or `skipped`, and its `crawl.run` job is failed. Tests: a manual run that crashes or
  hangs before a slot is closed before it, and the scheduled run runs normally.
- The 750 s figure is the 7-scroll-page case, not an upper bound; with no page cap only the run
  deadline bounds a run.
- `scripts/acceptance.sql` is created in Step 3 (AC 1 ratio, blocked-slot searches) and gains the
  Alert and Lark message id checks in Step 7.
- `briefing.build` and `lark.send` write the heartbeat; each LLM call has a timeout (settings, default
  120 s); `briefing.build` is idempotent and is queued again at worker startup when today's briefing is
  not finished.
- Settings reject a morning run whose end plus grace plus 5 min reaches the briefing build time; the
  end is the earlier of slot plus run deadline and the hard stop, so the defaults (05:50) pass.
- The briefing is built from the last completed scheduled run (the last one that wrote its snapshots);
  the open item on `stopped` runs is closed.
- Run now and `pnpm crawl:run` are refused while another run is `running`; test added.
- Every worker update of a run and its searches is guarded by `status = 'running'` on the run; test
  added.
- The watchdog backfill applies the Blocked slot rule to past slots inside a cool-down; CrawlRun keeps
  the `blocked_until` it set so the cool-down can be found later.

## Changelog (v16 → v17)

- Guarded run start: one update `WHERE status = 'scheduled' AND now() < deadline AND now() >=
  blocked_until`; no row changed → the job is a no-op and inserts no searches. CrawlRun stores
  `job_id`; the watchdog cancels the job when it marks a row `missed` or closes a blocked slot, and its
  closes are conditioned on status. Tests for late jobs of `missed` rows and blocked slots and for a
  manual job after its deadline.
- Job model: `crawl.run`, `briefing.build` and `lark.send` are three queues in one worker, each with
  `localConcurrency: 1`, in parallel. `crawl.run` uses queue policy `singleton` with no per-row key and
  jobs sent ahead with `startAfter`; `briefing.build` uses `singletonKey` = the date; at startup stale
  `briefing.build` and `lark.send` jobs are failed and the build re-sent if unfinished. Checked in
  pg-boss 12.38.0 `types.d.ts` and `index.d.ts`; `expireIn` corrected to `expireInSeconds`. ADR 0001
  records the model.
- The heartbeat belongs to the crawl loop only; briefing and Lark jobs are bounded by the LLM call
  timeout (120 s), the Lark send timeout (30 s) and job expiry, with `briefing_late` as the signal. The
  "longest stretch" sentence fixed; LLM timeout validation and tests added to Step 7.
- Morning hard stop default 06:05, validated directly: hard stop + grace + 5 min before the build time
  (06:25 < 06:30). The morning run is the last scheduled slot before the build time; open item closed.
- AC 1 (spec and plan): the backfill writes `missed`, or `stopped` when the slot fell inside a
  cool-down.
- The Windows worker task restarts every 1 min on failure; the crash-before-a-slot test names the
  restart policy.
- Alerts and `blocked_until` are written with the guarded update that causes them, KeywordDay and
  ShopDay with the final run update; test that a late finish writes no snapshot.
- `scripts/acceptance.sql`: AC 2 in Step 3; AC 1 Alert checks, AC 3 and AC 6 in Step 7, listed in its
  files.

## Changelog (v17 → v17b)

- Run start condition: `blocked_until` lives in CrawlerState, so the update is `status = 'scheduled'
  AND now() < deadline AND NOT EXISTS (crawler_state row with blocked_until > now())`; a NULL
  `blocked_until` blocks nothing. Test added.
- `briefing.build` is created with `createQueue` and policy `exclusive` (one queued or active job per
  `singletonKey`, `send()` returns null otherwise), because `singletonKey` does nothing on a `standard`
  queue in pg-boss 12.38.0 (its unique indexes are per policy, `job_i6` for `exclusive`). `lark.send`
  uses `standard`. Plan and ADR 0001 updated.
- Retry limits: `crawl.run` 0 (the pg-boss default is 2, which would rerun an expired job),
  `briefing.build` 1 (idempotent), `lark.send` 3 with a 30 s delay.
- `crawl.run` `expireInSeconds` = run deadline + deadline grace + 5 min (17400 s by default), so the
  singleton is not freed before the watchdog closes a hung run; settings reject values above 24 h, the
  pg-boss maximum; a change of deadline or grace re-sends future jobs.

## Changelog (v17b → v17c)

- Stored deadlines: every run row (schedule, manual, `cli`) is inserted `scheduled` with `deadline`
  computed before its job is sent: scheduled rows the earlier of slot plus run deadline and, for the
  morning run, the hard stop; Run now and `cli` rows the earlier of request time plus run deadline and
  the next slot minus the margin, sent with `startAfter` = now. A change of run times, run deadline,
  grace, hard stop, build time or margin rewrites future deadlines and re-sends their jobs. Tests added.
- Crash recovery fails every active `crawl.run` job, including one whose row is still `scheduled`,
  before the worker takes jobs.
- At startup, active `briefing.build` and `lark.send` jobs are cancelled, not failed: `fail()` moves a
  job with retries left to `retry`, which stays inside `job_i6`, so the re-send would return null.
- `lark.send` carries Lark's `uuid` dedupe field (first 32 hex characters of SHA-256 of briefing id and
  chat; at most 50 characters; one message per `uuid` within 1 hour, checked in Lark's send-message API
  schema); after that hour the unique key of `lark_messages` prevents a second post.
- `briefing.build` expiry 900 s by default, in settings; one job per briefing (global and each
  keyword), `singletonKey` = `date:scope`, the global one sent first; the LLM timeout check uses one
  job's expiry.
- LLM calls are counted per briefing in the database, at most 2 including job reruns.
- The worker's scheduler sends each day's `briefing.build` jobs with `startAfter` = the build time and
  applies settings changes within 1 minute; the web app only writes settings. ADR 0001 updated.
- The Step 3 crash test calls the recovery function directly; Step 4's Exit kills the worker and
  checks it is back within 2 min, with a wrapper loop or the watchdog as fallback.

## Changelog (v17c → v18)

- Spec: new §6 "UI and UX" after §5, from the owner's UI/UX interview of 2026-10-19: principles, users
  and devices, Vietnamese UI with one string dictionary, direction B with POD Studio's `--vet-*` tokens
  and Geist, screens and routes with navigation and the default page, save in 1 or 2 actions with undo,
  three-column ads with a detail pane, ideas as a table and a Kanban board with a non-drag way, per-slot
  line charts, 9 special states with their Vietnamese copy, roles with 404 for no permission, phone
  behaviour. §1–§5 keep their numbers.
- Spec §4 "Save-idea flow" matches the save interaction (1 or 2 actions, nothing else asked, undo
  deletes only the created ideas, per-store result); §2 serves thumbnails through an app route as WebP
  via `next/image`; §3 stores a skipped AI section as before and shows it as in §6; the time-series
  chart open item is closed, trend alerts stay open; new AC 7 (UX); dark theme, a second UI language and
  a native app or PWA added to "Out of scope".
- Plan Step 5: tokens and theme, Geist, the shell with sidebar, bottom tabs, store switcher and Ctrl+K
  menu, sign-in with a 30-day session, the string dictionary and its lint, admin pages on the design,
  404 for pages a user may not use, and the UX test harness. Step 6: three-column ads, the thumbnail
  route and `next/image` config, keyword and shop charts, ideas table and Kanban, save in 1 or 2 actions
  with undo, its special states. Step 7: the briefing page, save from suggestions with the same
  interaction, the Briefing late and AI section skipped states. New files listed per step.
- Exits of Steps 5–7 gain e2e action counts, axe with 0 serious or critical violations on the step's
  screens, `toHaveScreenshot` at 1440 and 390 px with seed data and a frozen clock against
  owner-approved baselines (max 1%), and a fixture and screenshot per special state. Step 8 measures the
  briefing LCP (< 2.5 s) through the tunnel on the Linux desktop. Plan AC 7, verification steps and two
  risks (screenshot baselines; the `/_next/image` cache) added.
- Calendar: about 10 days of UI work (3 + 5 + 2) move the end of Step 7 from day 42 to day 52 and the
  end of the 14-day run from day 58 (week 9) to day 68 (week 10).
- ADR 0001: a "UI libraries" row with the npm latest versions of 2026-10-19, the install rule that will
  pin older releases and prefer POD Studio's pins, the libraries left out and why, and thumbnails
  through an app route with `localPatterns`, `dangerouslyAllowLocalIP` off.

## Changelog (v18 → v18b)

- Thumbnails: Next 16's image optimizer does not forward headers when it fetches the source image, so a
  session-checked `/thumbs` route would break every optimized thumbnail. They now use signed URLs
  `/thumbs/[sig]/[key]` (HMAC-SHA256 of the key with `THUMB_URL_SECRET`, no expiry, so the
  `/_next/image` cache is not churned); the route checks only the signature and returns 404 when it is
  wrong; `proxy.ts` still requires a session for pages and `/_next/image`. Spec §2 and §6, Step 6 files,
  Exit and tests, the risk row and ADR 0001 updated.
- Save toast: "Đã lưu vào {store}" and "Hoàn tác" only; "Thêm store khác" appears only for users with
  `save` on 2 or more stores (spec §4 and §6, Step 6).
- Spec §3 section 6: the suggestion button is "Lưu", as in §6.
- `react-is`, a required peer of recharts 3.10.1, is declared directly and pinned, like `pg` and `zod`
  (Step 6, ADR 0001).
- Kanban moves between any two statuses, backwards included, like the status menu. Ctrl+K matches with
  `ILIKE` on ad caption, page name and domain, backed by `pg_trgm` GIN indexes in the Step 2 migration,
  from 3 characters, at most 5 results per group.
- Sessions keep better-auth 1.7.11's defaults (`expiresIn` 7 days, `updateAge` 1 day, sliding) instead
  of 30 days (spec §6, Step 5).
- Open items: sparklines are not built in phase 1, next to threshold-based trend alerts.

## Changelog (v18b → v18c, v17c Critic findings)

- Critic 3 (manual and `cli` rows): `requested_pairs` on CrawlRun, intersected with active keywords and
  countries at start and capped by the budget; the scheduler rewrites `schedule` rows only; Run now
  inserts its row and sends its job in one transaction (`send(..., { db })`); a partial unique index
  allows one `manual` or `cli` row `scheduled` or `running`; a no-op start, crash recovery and the
  watchdog close such a row as `stopped` `not_started`; "the web app writes settings and Run now rows".
  Tests added.
- Critic 13: partial unique index `(source, scheduled_for) WHERE trigger = 'schedule'`, with `ON
  CONFLICT DO NOTHING` in the scheduler and the watchdog backfill. Test added.
- Critic 5, 1, 2 (crash recovery): a still-`scheduled` row with an active job gets a new job before its
  deadline, or is closed after it; `briefing.build` is cancelled and sent again; `lark.send` is failed
  so it retries; the watchdog writes `lark_send_failed` when the global briefing is ready but the shared
  group has no message id by the ready time. Tests added.
- Critic 6: the Step 3 test uses "the run deadline after the request time".
- Critic 7: settings reject a morning slot at or after the hard stop and slots closer than the run
  deadline plus grace plus 5 min; the hard-stop test uses a 02:00 slot. Each rule has a rejected and an
  accepted case.
- Critic 1: `singletonKey` `${date}:global` and `${date}:kw:${keyword_id}`. Test: 1 global and 3 keyword
  briefings all queued and built.
- Critic 4: pg-boss expiry does not stop a handler; the briefing and Lark handlers use `job.signal` and
  a 60 s `statement_timeout`. Test added.
- Critic 8: the global job gets a higher `priority`; the scheduler sends the next build's jobs for the
  keywords active at each pass and cancels and re-sends them when the build time changes.
- Critic 9, 10: the LLM call count and estimated cost are committed before each call; after 2 failed
  calls the briefing is ready with sections 1–4 and "failed: AI" for 5 and 6, shown as a new tenth
  special state in spec §6; AC 3 counts that day as not generated. Tests, fixture and screenshot added.
- Critic 11: the `lark_messages` row is inserted before the call, and one older than 1 hour without a
  message id is not posted again but alerted; Alerts carry a `uuid` from their id.
- Critic 12: watchdog passes take `pg_try_advisory_lock`; closes, marks, backfill and the heartbeat
  check come first, then Alerts within 60 s.
- Critic 14–17: a wrapper loop is the main worker restart on Windows and the Step 4 exit checks for
  orphan processes; the 6 h cool-down ends the run and is spent idle; the scheduler writes
  `run_time_changes`; its `cancel()` and `send()` share one transaction.

## Changelog (v18c → v18d, v18b Critic findings and owner decisions)

Owner decisions of 2026-10-19, applied as given: D1 POD Studio's `tokens.css` copied unchanged
(secondary text `#44403c`, muted `#75706a`, sidebar 248 px, page title 24 px, KPI 28 px, fade 220 ms),
new Ideas Hub tokens under their own `--ih-` names; D2 brand red only for the logo, ink for "Lưu", the
active nav item and the selected card outline; D3 an action is one mouse click or one key press, with
targets set to what flows really take; D4 7-day sessions with a sliding extension, and "Thêm store khác"
hidden for single-store users; D5 the AI failure text is now "Chưa tạo được phần AI hôm nay".

- M1 session refresh: `nextCookies()` skips the extension in server component renders (better-auth
  1.7.11 `dist/integrations/next-js.mjs` lines 67–69), so the shell calls `authClient.getSession()` once
  per page load; Step 5 Exit tests a session aged 2 days.
- M2 image sizes: 320 added to `images.imageSizes` (Next 16.4.2 defaults 32–384 have no 320);
  `images.formats` removed, WebP being the default (`dist/shared/lib/image-config.js`); targets 320 px ≤
  40 KB at 1x and 640 px ≤ 90 KB at 2x in spec §2, AC 7, Step 6 and plan AC 7.
- M3 idea uploads: JPEG, PNG or WebP by magic bytes, at most 5 MB, re-encoded with sharp to WebP at most
  640 px wide (the width cap is this version's choice), keys per store, served by `/ideas/[id]/image`
  with session and store scope; allow-listed Content-Type and `nosniff` on both image routes; tests for
  SVG and another store's image; the bearer-link risk row now says uploads are not shared data.
- M4 the run log moves to the Main group in Step 5; Run now and its three disabled reasons land on the
  keyword page in Step 6, each with an e2e test; the `cli` bullet of Step 3 points to Step 6.
- M5 action counts per D3 in spec §4, §6 principle 2, the Ideas bullet and AC 7, plan Steps 5–7 and AC
  7: status from the menu 2, keyboard board move at most 2 plus the columns crossed; `actions.ts` counts
  clicks, drags and key presses.
- M6 tokens per D1 and D2: the "values copied" sentence replaced by POD Studio's real values; the dark
  216 px sidebar becomes POD Studio's white 248 px one; out-of-top chip in POD's warn colors; motion at
  most 220 ms; type sizes from POD; `--ih-*` tokens listed. Two contrast facts found while checking:
  muted text is 4.27:1 on `selected`, so selected rows use secondary text, and POD's borders are 1.26:1
  and 1.49:1, so `--ih-field-border` (3.37:1) marks inputs. The phone breakpoint follows POD's 820 px,
  since the copied tokens switch type sizes there.
- M7 `running_ads` and `ok_searches` on CrawlRun (spec §2, plan Step 2), written with `keyword_days` in
  the final run transaction (Step 3, with a test); the KPI row reads them (spec §6, Step 7). M7 is the
  only crawler data change; minor 19 changes the worker heartbeat.
- Minor findings: 1 Ctrl+K escaping, ordering and screen filter; 2 thumbnail key pattern, decoded key
  signed, key in snapshots, `onError` tile, altered-key and traversal tests, ADR cites
  `fetchInternalImage`; 3 `proxy.ts` with a full `getSession()` in Step 5 and the relative callback
  check; 4 "Thêm" phone tab; 5 "Đã xử lý" sets `resolved_at`, the attention bar counts open Alerts only;
  6 latest ready briefing before the ready time, as an 11th special state, and the source-run label; 7
  `/keywords/[id]/[date]`; 8 library strings from `strings.vi.ts`, lint over `components/ui`,
  `lang="vi"`; 9 `a11y.ts` focus, 1.4.11 and 24 px checks; 10 stretched card link with a separate "Lưu";
  11 `S` and `O` only on a focused card; 12 server-side 10 s undo, 404 after undo, pre-check from stores
  the last save created in; 13 `via = briefing` from the briefing ad sheet; 14 chart x-axis, gaps,
  colors by slot, ink labels; 15 Kanban by `updated_at`, no position field, `@dnd-kit/core` only, no
  drag or menu for view-only members; 16 `@playwright/test` 1.64.1 in ADR 0001; 17 the `geist` package
  through `next/font/local` (1.8.1 latest, likely pin 1.7.2, Vietnamese glyphs checked in its fonts); 18
  LCP with a warm cache from the development PC, one day reserved; 19 the heartbeat timer between runs;
  20 the Status line.
- Calendar: Steps 5–7 grow by 2, 2 and 1 days and Step 8 reserves 1 day for LCP fixes, so the 14-day run
  ends around day 74 (week 11) instead of day 68 (week 10).

## Changelog (v18d → v18e, v18d Critic findings and owner decisions)

Owner decisions of 2026-10-19, applied as given: O1 a dark sidebar as in mock-up B, 248 px, collapsed to
60 px by a toggle the browser remembers, `--ih-sidebar-bg` = ink `#1c1917`, sidebar text at least 4.5:1
(`#e7e5e1` 13.9:1, labels `#a8a29e` 6.9:1), the active item a surface background with ink text; O2 the
820 px phone breakpoint; O3 strings: phone tab "Khác", "Đã xử lý" and "Từ run 01:00 ngày 19/10" kept,
"Đang hiển thị briefing ngày 18/10; bản hôm nay sẽ có trước 07:00", "Đã quá thời gian hoàn tác", "Ảnh
lớn hơn 5 MB"; O4 series 3 `#c2369b`, a fall in secondary text with ▼, a rise in POD's success token,
the crawler attention bar in `--vet-warn`; O5 playwright and @playwright/test pinned to 1.63.0 as in POD
Studio.

- M1 uploads go through a route handler that stops reading at 5 MB, so the 1 MB Server Action limit
  stays for every other action; tests for 4.9 MB accepted and 6 MB refused with the app's message.
- M2 a `coordinateGetter` jumps one column per arrow press (the default sensor moves 25 px), with a unit
  test; ADR updated; 0.25 day added to Step 6.
- M3 `theme.css` wires Geist from `next/font/local` and shadcn's color names to POD's tokens; Step 5
  Exit checks the loaded font and an ink default button.
- Minor findings: 1 session refresh described as it works (the proxy extends it on full loads; server
  components use `disableRefresh`; the browser call removed, the 2-day test kept with `page.goto`); 2
  SavedIdea `updated_at`; 3 series 3 per O4; 4 the worker's thumbnail key form and PNG handling in Step
  3, "No worker change" replaced; 5 sharp with a pixel limit, EXIF rotation and a 640 × 1920 box, with
  tests; 6 `image_key`, one copy per store, undo deletes objects, `Cache-Control: private, no-store`; 7
  callback checked with `new URL` and no control characters, `/%09/example.com` test; 8 signature length
  and hex checked before `timingSafeEqual`, truncated-signature test; 9 undo accepted up to 15 s, then
  "Đã quá thời gian hoàn tác"; 10 Sheet and sonner durations at most 220 ms with a check; 11 the 3:1
  check lists input selectors and `--ih-field-border` becomes `#8a847d`, at least 3:1 on white, the app
  background and selected; 12 change colors and the attention bar per O4 with token names; 13 KPI
  baseline over runs that would write `keyword_days`, and a `running_ads` test with overlapping ads; 14
  x-axis from `scheduled_for` in Asia/Ho_Chi_Minh; 15 no status menu for view-only members in the table
  either; 16 the 2x test asks for `w=640`, LCP in one browser context; 17 the idle timer writes only
  while pg-boss polls (`lastFetchedOn` under 2 min), with a test; 18 the proxy `matcher` leaves out
  static files, with a sign-in page test; 19 the sidebar per O1; 20 a drag is one action in principle 2
  and AC 7.
- Diff review of v18d: H1 one definition of running ads (running under §1 "Measures" after the run's
  upserts, as `keyword_days`); H2 only the worker writes the heartbeat, crawl loop or idle timer, a
  deliberate behaviour change (v18c wrote it only from the crawl loop and an idle wait that pg-boss does
  not provide; v18d added the timer); H3 the v18d changelog now says M7 is the only crawler data change
  and minor 19 changes the worker heartbeat; H4 ADR 0001 lists @playwright/test, geist and sharp as not
  covered by any dry run, and names playwright 1.64.1 and react 19.3.1 among the releases too new to
  pin.
- Found while applying O5: playwright-core 1.63.0 still falls back to a 180000 ms launch timeout in code
  although its `types.d.ts` documents 30000, so the Step 3 rule to pass the limit as `timeout` stands.
- Crawler parts touched: H1 (the `running_ads` rule), H2 and minor 17 (heartbeat), minor 4 (thumbnail
  keys), O5 (launch timeout text). Nothing else in Steps 1–4 changed.
- Calendar: Step 6 grows by 0.25 day, so Step 6 ends around day 48, Step 7 around day 58 and the 14-day
  run around day 75 (58 + 17), still in week 11.

## Changelog (v18e → v18f, v18e Critic findings)

Owner decisions of 2026-10-20: `running_ads` counts every running ad in the database, and spec §1
"Measures" says so; the keyboard drop point is the card's current y clamped inside the column's visible
rect, so the page never scrolls.

- MAJOR 1: the proxy `matcher` names its static extensions
  (`css|js|map|woff2?|ico|png|svg|webp|jpg|txt|webmanifest`) instead of "any path with a file
  extension", which skipped `/shops/example.com`; it leaves out `/api/ideas/manual`; the `(app)` layout
  checks the session too; Step 5 Exit tests `/shops/example.com` without a session.
- MAJOR 2: the shadcn color names `background`, `foreground`, `card-foreground`, `popover-foreground`,
  `accent-foreground`, `secondary-foreground`, `secondary` and `muted` are mapped; raw `--popover`,
  `--popover-foreground`, `--border` and `--radius` for sonner; sonner with `theme="light"` and no
  next-themes; `package.json` restored to the ADR pins after each `shadcn add` (the registry brings
  next-themes and recharts 3.8.0); `scripts/check-ui-colors.ts` and computed-background checks on an
  open Sheet, Tooltip and toast.
- Minor 3: the base layer sets the body font from `--font-sans`; the font test reads `--font-geist-sans`
  from the page and imports nothing.
- Minor 4–5: the upload route is left out of the proxy, checks the session, `save` on every chosen store
  and the origin, refuses bodies over 5 MB + 64 KB by `Content-Length` and by a byte counter before
  `formData()`, writes nanoid-keyed objects before the rows and deletes them on failure, raises
  `limitInputPixels` to 5e7, and has strings for a wrong type, too many pixels and an unreadable image;
  the Save server action no longer takes images; the AC 4 matrix covers the route.
- Minor 6: the plan's chart x-axis uses the date of `scheduled_for`, with an after-midnight test.
- Minor 7–12, 14–15: series 3 ΔE numbers in spec §6; KPI baseline = the run of that slot that wrote
  `keyword_days`; a missing `crawl.run` entry or null `lastFetchedOn` means not polling, and
  `pollingIntervalSeconds` stays at the default under 120 s; the `thumbs/` prefix and extensions from
  magic bytes, with a Step 3 test; `[cmdk-input]` dropped and muted text on `accent` uses `--vet-text`;
  sidebar hover and badge tokens with a reload test of the collapse state; "at most 640 px wide at 2x"
  everywhere; ADR dry runs repeated at the pins; the `running_ads` test moved to Step 3; split code
  spans joined in the bullets this version rewrote; ← and → move one column, ↑ and ↓ are a stated no-op.
- Found while repeating the dry runs: with react 19.3.0 and react-dom undeclared, npm picks react-dom
  19.3.1, whose peer is react `^19.3.1`, and fails with ERESOLVE, so react-dom is pinned with react (ADR
  0001).
- Calendar (minor 13): Step 6 grows by 1 day to 8.25, so Step 6 ends around day 49, Step 7 around day 59
  and the 14-day run around day 76 (59 + 17), still in week 11.
- New UI strings for owner approval (approved at Gate 0, 2026-10-20): "Chỉ nhận ảnh JPEG, PNG hoặc
  WebP", "Ảnh quá lớn (trên 50 megapixel)", "Không đọc được ảnh này".

## Changelog (v18f → v18g, findings of the narrow v18f Critic)

- MAJOR 1: `theme.css` defines `--color-white` and `--color-black`, which POD's `--color-*: initial`
  removes and shadcn's overlays and destructive variants use; `check-ui-colors.ts` compiles with
  Tailwind's `compile()` instead of matching class names, so `text-sm` and the like pass; Step 5 Exit
  checks the open Sheet's overlay.
- MAJOR 2: every size refusal of `/api/ideas/manual`, by `Content-Length`, by the byte counter or for
  the file part, answers 413 with "Ảnh lớn hơn 5 MB"; the 6 MB test covers both paths; the 48 MP test
  image is a fixture of at most 5 MB (spec §2 and plan Step 6).
- `apps/web/src/app/(app)/layout.tsx` holds the session check; signed-in pages move under `(app)/` with
  unchanged URLs, `/login` stays outside (plan Step 5, page paths in Steps 5–7).
- Upload route: `new Response(buf, …).formData()` with the original `content-type`; the origin rule as
  in the plan, the app origin from the configured public URL; 401 without a session, with a test (spec
  §2, plan Step 6).
- `notifyPollingIntervalSeconds` kept at its 30 s default and refused at 120 s or more (plan Step 3);
  keyboard drop keeps the card's y (spec §6); spec §2 lists everything the proxy skips; blank line
  before spec §2; KeywordDay `slot` is the run's `scheduled_for` timestamptz.
- Left out, under "Open items (v18f narrow Critic, left out of v18g)": the font test detail and the
  ADR's 2x wording. No calendar change.
- Pre-commit touch-ups: ShopDay slot type, plan Step 3 wording, ADR 141 item closed.

## Changelog (v18g → Gate 0)

- Owner decisions of 2026-10-20 recorded under "Gate 0": ADR 0001 approved (status accepted), the delivery
  order approved, the remote is the private repo `anhtahaylove/ideas-hub` with the current docs as the
  first commit (c687ad8), and the legal review finishes before the 14-day run starts.
- Status: approved at Gate 0, v18g; the ADR input is listed as accepted; spec "Delivery order" no longer
  awaits approval.
- The three v18f UI strings ("Chỉ nhận ảnh JPEG, PNG hoặc WebP", "Ảnh quá lớn (trên 50 megapixel)",
  "Không đọc được ảnh này") are approved.

## Changelog (Gate 0 → open-item review, 2026-10-21)

- "Open items (v4 Critic MINOR findings not yet addressed)" checked against `main`. Four are resolved,
  each with its code and tests: the 72 h re-fetch timing, thumbnails that do not depend on URL expiry,
  `days_active` from the payload's `end_date`, and the shop running ad count (new test in
  `apps/worker/test/run.test.ts`). Three are owner questions, listed in
  `docs/status/2026-10-21-morning.md`: the probe's go/no-go threshold, the `via` of ad saves from a
  keyword report, and the Alert backlog when Lark is configured. No product code change.
- Correction the same day: the probe's go/no-go threshold is Step 4's decision point (success < 90%
  after tuning), so that item is resolved too. The Alert backlog was decided in #21 (24 h cut-off), so
  the `via` of keyword-report ad saves is the only owner question left.
