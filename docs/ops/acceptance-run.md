# Runbook: the 14-day acceptance run

Status: **ready, not started.** Pending owner: start the run after the Linux switch, its 2-day
re-check and the LCP check (`docs/ops/linux-trial.md`), the legal review (Gate 0: it must finish first)
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
   script must first get through it (pending owner, `linux-trial.md` "Tunnel").
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

The queries look back 14 days from now. Until day 14 the window still holds rows from before
`<run-start>` (the Linux re-check, Windows): read days 1–13 as a trend, and take the **verdict from the
run made at or after `<run-start>` + 14 days**, when the window is exactly the run.

| AC | Query in `scripts/acceptance.sql` | Pass |
|---|---|---|
| 1 | `ac1_success_ratio`: `ok_searches`, `planned_searches`, `success_ratio` over `trigger = schedule` rows; a row `missed` or still `scheduled` after its slot counts all its planned searches as failed, skipped searches of a blocked slot are failures | `success_ratio` ≥ 0.9000 |
| 1 | The Alert checks Step 7 adds: every run with a `blocked` or `parse_error` search has that Alert with a Lark message id; each run's `network_error` Alerts equal its `network_cooldowns`, each with a message id | No row reported (0 violations) |
| 2 | `ac2_violations`: `ok_without_embedded`, `has_next_without_page`, `silent_stops` | All three 0 |
| 3 | The AC 3 query Step 7 adds: global briefings with `ready_at` before 07:00, all 6 sections generated, a Lark message id; evidence refs resolve; daily AI cost ≤ cap | ≥ 13 of 14 days on time and complete; 0 unresolved refs; 0 days over the cap |
| 6 | The AC 6 query Step 7 adds: ideas by non-admin members with `via = briefing` in the window, per store row | ≥ 30 in total and ≥ 10 in each of ≥ 2 stores |

As of this branch the file holds `ac1_success_ratio` and `ac2_violations`; the AC 1 Alert, AC 3 and AC 6
queries come with Step 7 (plan Step 7, "`scripts/acceptance.sql` gains…"). Read their column names from
the file once it has them; the pass rule above does not change.

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
