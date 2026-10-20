# Block rate and crawler measurement (plan Step 4)

Status: interim, 2026-10-20. Every figure measured so far is below; the 3–5 day measurement at the
production schedule is **pending: scheduled runs** (see "Measurement schedule"). Inputs for
[ADR 0003](../adr/0003-crawler-design.md).

Success rate is AC 1's definition: Σ `ok` + `no_results` ÷ Σ planned searches, where `network_error`,
`blocked`, `parse_error`, `skipped`, `interrupted` and the searches of a `missed` or never-run slot are
failures. For the probe, a search is `ok` or `no_results` by the same detector rules (spec §1).

## Runs measured so far

| Run | Source | Mode | Trigger | Planned | ok + no_results | Blocked | Other failures | Success | Duration | Per search |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-19T21:57 | Step 1 probe | headed | sample | 41 | 41 | 0 | 0 | 100.0% | 40 min | 59 s |
| 2026-10-19T22:37 | Step 1 probe | offscreen | sample | 29 (ended from outside; the other 11 are the next row) | 29 | 0 | 0 | 100.0% | – | – |
| 2026-10-20T03:28 | Step 1 probe | offscreen | sample | 11 | 11 | 0 | 0 | 100.0% | 11 min | 60 s |
| 2026-10-20T03:39 | Step 1 probe | headless | sample | 41 | 39 | 0 | 2 `parse_error` | 95.1% | 45 min | 66 s |
| `run_0bfae41144ba455cabf48` | worker (Step 3 Exit) | offscreen | `cli` | 20 | 20 | 0 | 0 | 100.0% | 19 min 33 s | 59 s |

Totals: 142 searches, 140 `ok` or `no_results` (98.6%), 0 blocks, 2 `parse_error` (headless: an
embedded script read while still streaming, fixed in the Step 3 adapter), 0 `network_error` left after
retries. The production mode, off-screen, read 60 of 60 (100.0%).
Probe figures are from `docs/research/2026-10-20-fb-probe.md`; the worker run from the dev database:

```sql
select status, count(*), sum(ads_found), min(ads_found), max(ads_found), sum(pages_read),
       max(extract(epoch from finished_at - started_at))::int as max_seconds
from crawl_searches where run_id = 'run_0bfae41144ba455cabf48' group by status;
-- ok | 20 | 2000 | 100 | 100 | 143 | 25
```

The worker run (10 seed keywords × US, GB): every search reached the 100-ad cap (`stop_reason = cap`),
1556 unique ads, 2000 sightings, 400 shops, 1555 thumbnails stored, 1 transient retry, recovered on the
next attempt.

## Block events and backoff waits

None so far: no captcha flag, login wall, empty embedded data or 3 empty scroll payloads in any search,
so no backoff wait, cool-down or `blocked_until` was ever set. The probe's retries were all transient
(scroll-response timeouts) and every one was recovered
by the retry rule (off-screen: 3 searches needed a second attempt; headless: 5, with 6 timeouts).

## Run duration against the spec §1 estimate

Spec §1 estimates about 61 s per search (2 h 43 min for 160 searches, 4 h 05 min at 92 s in the longest
case). The worker run took 59 s per search including the 20–60 s delays, inside the estimate: the full
schedule (4 countries × 41 keywords, 164 searches) would take about 2 h 41 min, within the 4 h run
deadline.

## Tuned defaults

No change: with no block in 142 searches there is nothing to tune the delays, backoff or limits on, so
the spec §1 defaults in `DEFAULT_SETTINGS` stay as they are and no `settings` row is written. To be
revisited with the scheduled runs below.

## Decision point

Success ≥ 90% so far (98.6% over 142 searches, 100.0% for the off-screen mode); the decision is **pending: scheduled runs**, taken on
the production-schedule measurement. Below 90% after tuning, the options for the owner are fewer
countries, longer delays and the residential proxy slot.

## Worker restart and orphan check

`scripts/windows/check-worker-loop.ps1` registers a copy of the worker task (`IdeasHub-Worker-Check`)
against a disposable database with no run times and no keywords, then removes both. Result on
2026-10-20 (Windows 11, pnpm 12.9.1, Playwright 1.63.0, system Chrome):

```
PASS killed worker restarted by the loop - new worker pid 20504 after 6 s
PASS ending the task leaves no process (worker) - 3 processes before, 0 left:
PASS ending the task leaves no process (browser open) - 13 processes before, 0 left (0 chrome.exe):
```

Without the job object in `worker-loop.ps1` the same check fails: ending the task left the worker's
node processes and, with a browser open, 8 `chrome.exe`. The cause is that ending a task stops only its
own process, and pnpm runs scripts through Git Bash, whose processes lose their parent links; the loop
therefore joins a job object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, so every process started under
it ends with it.

## Measurement schedule

- `IdeasHub-Probe-Runs`: the probe, off-screen, 01:00 and 13:00 Asia/Ho_Chi_Minh to 2026-10-22, 40
  searches per run; results in the probe worktree's `out/` and added to the table above.
- The worker measurement (3–5 days at 01:00 and 13:00 with the watchdog) starts after the probe ends
  on 2026-10-22, so the two never crawl at the same time: register the tasks with
  `scripts/windows/register-worker-tasks.ps1 -StartAt '2026-10-23 00:30'`.
- `pnpm briefing:preview` renders sections 1–4 from those runs.
