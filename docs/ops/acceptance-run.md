# Runbook: the 14-day acceptance run

Status: **ready, not started.** Pending owner: start the run after the Linux switch, its 2-day
re-check and the LCP check (`docs/ops/production.md`), the legal review (Gate 0: it must finish first)
and staff onboarding (`docs/onboarding.md`). Plan "Acceptance criteria" (AC 1–7, measurable form) and
"Verification steps"; spec "Acceptance criteria".

## Before day 1

1. The Linux trial passed its 2-day re-check (success ≥ 90%).
2. **LCP check** (AC 7, Step 8 part), from the development PC through the tunnel:

   ```sh
   IDEAS_HUB_LCP_EMAIL='<member email>' IDEAS_HUB_LCP_PASSWORD='<password>' \
     pnpm --filter @ideas-hub/web lcp:briefing https://<tunnel-hostname>
   ```

   (PowerShell: set `$env:IDEAS_HUB_LCP_EMAIL` and `$env:IDEAS_HUB_LCP_PASSWORD` first, then the same
   `pnpm` line.) It uses system Chrome at 1440 × 900, signs in, loads `/briefing` once to warm the caches,
   then 5 times in the same browser context, prints each LCP and the median, and exits 1 when the median
   is 2500 ms or more. Use a member account with a store (the page staff see), on a morning when the day's
   briefing is ready. Record the 5 values and the median in the tracking issue and under "Linux trial"
   in `docs/research/2026-10-20-block-rate.md`. A median ≥ 2500 ms uses the reserved day to fix it, then
   re-run; the 14-day run waits for a pass. If Cloudflare Access is put in front of the hostname, the
   script must first get through it (pending owner, `production.md` "Tunnel").
3. Staff onboarded in at least 2 stores, with `save` and no admin role (admin saves do not count).
4. The owner creates the tracking issue, for example "Phase 1 acceptance run `<day 1>` – `<day 14>`", and
   writes day 1's date (Asia/Ho_Chi_Minh) and the start time in UTC, `<run-start>`, at its top.

## Daily check (about 07:30 Asia/Ho_Chi_Minh, after the briefing post)

On the Linux desktop, from the checkout (the Postgres container has `psql`; no client on the host is
needed):

```sh
docker compose -p ideas-hub exec -T postgres psql -U ideashub -d ideashub -v ON_ERROR_STOP=1 < scripts/acceptance.sql
```

With a `psql` client on the host, `psql "$DATABASE_URL" -f scripts/acceptance.sql` gives the same output.
Each `-- name:` block is one query and prints one result. Read-only: the file only selects.

On the production host, `ideashub-acceptance.timer` (phase 2 plan Step 8, enabled by the pilot's start
session) runs this file at 07:30 through the read-only role, appends the output to
`~/.local/state/ideas-hub/acceptance.log`, and sends an `acceptance_failed` Alert to Lark only when AC 1 is
under 0.90, an AC 1 or AC 2 count is above 0, or today's briefing (`ac3_today`) is late or lacks its 6
sections.

The queries look back 14 days from now. When `pilot.run_start` is set, AC 1 and AC 6 also skip rows from
before it; the daily script sets it from `PILOT_RUN_START` (default `2026-10-22T17:00:00Z`, changed
2026-10-24), so days 1–13 are no longer read against slots missed before the pilot. Run by hand without
it, the window still holds those rows: read days 1–13 as a trend, and take the **verdict from the run made
at or after `<run-start>` + 14 days**, when the window is exactly the run.

| AC | Query in `scripts/acceptance.sql` | Pass |
|---|---|---|
| 1 | `ac1_success_ratio`: `ok_searches`, `planned_searches`, `success_ratio` over `trigger = schedule` rows; a row `missed` or still `scheduled` after its slot counts all its planned searches as failed, skipped searches of a blocked slot are failures | `success_ratio` ≥ 0.9000 |
| 1 | `ac1_alerts`: `blocked_unsent`, `parse_error_unsent`, `network_mismatch` (runs whose `blocked` or `parse_error` search has no such Alert with a Lark message id, or whose `network_error` Alerts differ from `network_cooldowns` or lack a message id) | All three 0 |
| 2 | `ac2_violations`: `ok_without_embedded`, `has_next_without_page`, `silent_stops` | All three 0 |
| 3 | `ac3_briefings`: `days`, `days_ok` (global briefing `ready_at` before 07:00, all sections stored with 5 and 6 generated, a Lark message id), `unresolved_refs`, `days_over_cap` | `days_ok` ≥ 13 of 14; `unresolved_refs` 0; `days_over_cap` 0 |
| 6 | `ac6_ideas`: `ideas` by non-admin members with `via = briefing` in the window, per store row, `stores_with_10`, `per_store` | `ideas` ≥ 30 and `stores_with_10` ≥ 2 |

### AC 1 and the next-slot retry (AC-C1, ADR 0008)

From 2026-11-06 a scheduled run first retries the failed searches of the previous finished scheduled run
(`done` or `stopped`, started, scheduled before this slot; a slot the watchdog closed inside a cool-down
never starts and is passed over; manual and `cli` runs are never the previous run and never retry): its `blocked` and
`network_error` searches, plus its `skipped` ones when that run has a `block_reason`, still active, once per
(keyword, country), at most `R = min(RETRY_PER_SLOT, searchBudget)` (`RETRY_PER_SLOT` = 40 in
`packages/core/src/schedule.ts`). The rotation then takes `searchBudget − retries` pairs from the stored
cursor and advances by that many; a rotation pair already retried is not replaced. Pacing, cool-downs and
run times do not change.

A pair is not retried when its search was also `blocked` or `network_error` in the started scheduled run
before the previous one (a two-run lookback), so a pair that keeps failing is retried once and then waits
for the rotation instead of taking a retry seat in every slot. A `skipped` search two runs back is not a
failure here: that pair was never searched.

What it does to `ac1_success_ratio` (Σ ok ÷ Σ planned over scheduled rows):

- A failed search stays failed in its own slot. The query does not change; no row is rewritten.
- A retry is one planned search of the next slot, in a seat the rotation would otherwise use, so
  `planned_searches` per slot stays at most `min(searchBudget, active pairs)`. A retry that succeeds counts
  as ok there; one that fails again counts as a failure there, as the rotation search it replaced could.
- So the ratio itself moves only by the difference between the retries' success rate and the rotation's.
  The gain is coverage: the pairs a blocked slot missed are searched in the next slot (12 h later with the default run times) instead of when the rotation
  comes back to them. Baseline: since 2026-10-23, 160 of 179 failed searches came from one blocked slot
  (2026-10-26 01:00 ICT); the next slot would have retried 40 of those 160 (the cap), and AC 1 would still
  have counted all 160 as failed. The ratio is raised by fewer blocks (low-yield keyword pruning, AC-C2)
  rather than by retries; proxies stay the fallback only if AC 1 is under 0.95 for 2 weeks after AC-C1.

AC 4, 5 and 7 are test results, not daily queries:

| AC | How | When | Pass |
|---|---|---|---|
| 4 | `pnpm -r test` (integration tests of store scoping: ideas, tracked keywords, AI sections of keyword briefings) | Day 1 and day 14, on the commit that runs | exit 0 |
| 5 | `pnpm --filter @ideas-hub/web e2e` (the AC 5 e2e: save from an ad, a suggestion and by hand; dedupe; CSV) on the development PC, its own port 3310 and database `ih_e2e` | Day 1 and day 14 | exit 0 |
| 7 | The same e2e run (axe, action counts, screenshots against owner-approved baselines, special states, focus, contrast and target checks, thumbnail sizes) plus the LCP check above | Before day 1; e2e again on day 14 | e2e exit 0; LCP median < 2500 ms |

Never run the e2e suite against the Linux database: it drops and re-creates its own `ih_e2e` database on
the machine it runs on.

### What to record, where

One comment per day on the tracking issue (English), pasting the query output:

```text
Day <n> (<YYYY-MM-DD>), checked <HH:MM> Asia/Ho_Chi_Minh
AC 1: success_ratio <x> (<ok>/<planned>); Alert violations <n>
AC 2: ok_without_embedded <n>, has_next_without_page <n>, silent_stops <n>
AC 3: today ready_at <HH:MM>, sections <6/6 | skipped | failed>, Lark <yes/no>; on-time days so far <k>/<n>
AC 6: briefing saves so far <total>; per store <store: n, ...>
Incidents: <blocks, cool-downs, missed runs, restarts, Alerts, or "none">
```

Also record restarts and incidents from `journalctl --user -u ideashub-worker --since yesterday` and the
admin Alerts page (`/admin/alerts`). AC 1, 2, 3 and 6 are attached daily (plan "Verification steps"); the
final comment gives the verdict per AC 1–7 with the day-14 output and links to the test runs.

### When a day fails

- AC 1 dropping under 0.90, or a block: check `/runs` and `/admin/alerts`, the cool-downs, the worker
  journal. Do not change settings mid-run without writing it in the issue: a settings change rewrites
  future rows, and the run is judged on what was in force.
- A missed briefing (AC 3) uses 1 of the 1 allowed late days; a second one fails AC 3 for this run.
- A host outage counts against AC 1 (the watchdog backfills `missed` rows when the host returns). If the
  run cannot reach its targets any more, the owner decides whether to restart the 14 days.

## Pending owner

- Start the run after the Linux switch, its re-check and the LCP check; create the tracking issue.
- Run the daily check (or delegate it) and the day 1 / day 14 test runs.
- Decide on a restart of the 14 days if an outage or block makes the targets unreachable.
