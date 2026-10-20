# ADR 0003: Facebook Ad Library crawler design

Status: accepted for phase 1 (2026-10-20), with the measurement figures still pending (see "Open").
Inputs: spec §1 and §2, plan Steps 1, 3 and 4, [the Step 1 probe](../research/2026-10-20-fb-probe.md),
[the block-rate report](../research/2026-10-20-block-rate.md), ADR 0001 (stack) and ADR 0002 (data model).

## Context

Phase 1 reads the Facebook Ad Library logged out through its web UI, 4 countries × about 40 keywords,
twice a day, from one residential IP. The probe measured three browser modes on a 40-search sample per
mode; the 3–5 day measurement of Step 4 checks the chosen mode at the production schedule.

## Decision

### Browser

- System Chrome (`channel: 'chrome'`) driven by Playwright 1.63.0, one browser and one tab, a fresh
  logged-out context at every browser start, locale `en-US`. No persistent profile and no proxy in phase
  1; the `proxy` setting is wired, the `browserProfile` slot stays off.
- **Mode: headed with the window off-screen** (`--window-position=-32000,-32000` and the three
  anti-throttling flags), set by `IDEAS_HUB_BROWSER_MODE` (default `offscreen`). Why: no mode met a block
  in the probe sample, so the choice rests on the other evidence: off-screen is the same real headed
  browser as headed mode (no headless fingerprint) but does not put a window in front of whoever uses the
  PC at 13:00; its 3 scroll-response timeouts in 40 searches were all recovered by the retry rule.
  Headless had 4 such timeouts and an embedded script read while still streaming; it stays the fallback
  for a host without a desktop session. Headed is the fallback if off-screen retries grow.
- The worker starts Chrome through `launchServer()` so a browser that does not close within its limit
  can be killed (`BrowserServer.kill()`); the start limit is passed as `timeout` and also raced, since
  `launchServer()` in 1.63.0 did not stop at a 1 ms `timeout` in our test.

### Reading a search

- The embedded `search_results_connection` (30 ads, `count`, `page_info`), then
  `AdLibrarySearchPaginationQuery` responses while scrolling, until the end of results, 100 unique ads,
  or 2 non-empty scroll pages in a row with no new ad. Has-next from `page_info`, else count > ads read.
- The adapter waits through the client-side `sort_data` redirect after load and polls the embedded script
  until it parses; a script that never parses within the embedded-data limit is a transient error.

### Detection and backoff

- "No results" is the embedded connection with `count: 0` and no edges. Blocks: captcha flag, login
  wall (URL or email/password inputs), empty embedded data without that marker, 3 empty scroll payloads
  in a row. Anything unparseable is `parse_error` (neutral, Alert, no cool-down).
- Backoff, stop rules, transient retries, network cool-down and bounded waits as spec §1, with the
  defaults kept: the probe saw no block, so there was nothing to tune them on (see "Open").
- A 2-page stop with a next page left stays neutral: no scroll page repeated an ad in the probe sample.

### Job model

- pg-boss 12.37.0, three queues in one worker: `crawl.run` (`singleton`, `retryLimit` 0, expiry run
  deadline + grace + 5 min), `briefing.build` (`exclusive`, keyed per briefing) and `lark.send`
  (`standard`). One job per run row, sent ahead with `startAfter` at its slot; the scheduler keeps 14 days
  of rows and jobs and rewrites future ones when settings change.
- Every worker write after a run starts is guarded by `status = 'running'`; Alerts and `blocked_until`
  are written in the transaction of the update that causes them, snapshots with the final update.
- The watchdog is a separate 5-minute process (Task Scheduler on Windows, systemd timer on Linux):
  missed and blocked slots, backfill, hung runs, heartbeat, Alert sending. Crash recovery runs at worker
  start. On Windows the worker task runs `scripts/windows/worker-loop.ps1`, which restarts it after any
  exit and holds every process it starts in a kill-on-close job object, so ending the task leaves no
  node or Chrome process (pnpm's Git Bash processes lose their parent links, so killing the task
  alone left both; `scripts/windows/check-worker-loop.ps1`).

## Consequences

- One IP and no accounts: a sustained block stops collection for 6 h at a time; the next lever is the
  proxy slot, before any account (spec §1).
- The probe sample is small (about 120 searches over three modes). The production mode's numbers come
  from the twice-daily probe runs to 2026-10-22 and the Step 4 measurement.

## Open

- Block rate, run duration and backoff waits at the production schedule: pending the scheduled probe runs
  (to 2026-10-22) and the Step 4 measurement runs; the decision point (success < 90% → options to the
  owner) is taken there.
- Thumbnail URL expiry: the 24 h and 72 h re-fetches are scheduled; the `oe` parameter says about 4 days.
