# ADR 0006: Auto-deploy from main

Status: accepted (2026-10-21), with the phase 2 plan (v5, consensus).
Deciders: owner (through the phase 2 plan).
Inputs: [phase 2 plan](../plans/ideas-hub-phase-2.md) Steps 2a and 4, ADR 0005, POD Studio's
auto-deploy (its `docs/deploy-linux.md`, "Auto-deploy"; read for the pattern only).

## Context

After install, the owner should not deploy by hand. POD Studio's host polls `origin/main` every 5
minutes and deploys every new commit without looking at CI. Ideas Hub has extra hazards: a restart in
the middle of a crawl run or the briefing build loses work and distorts the block-rate numbers; a red
commit must never be deployed; a deploy that overlaps POD Studio's own deploy doubles the load on a
shared host; and a failed migration must not leave old code on a new schema.

## Decision

- `ideashub-deploy` (bash) started by a systemd user timer 3 minutes after boot and 5 minutes after the
  previous run ends; one `flock` shared with backup, retention and the restore drill; skipped while POD
  Studio's deploy runs; the deploy unit capped (memory, CPU, idle IO).
- **CI gate, always on:** the GitHub Actions run `CI` of `origin/main`'s commit, read with a fine-grained
  token limited to this repo (Contents and Actions, read): success deploys; failure, timeout,
  cancellation and similar conclusions never deploy that commit and Alert once; no run after 60 minutes
  Alerts; a rejected token fails closed with an Alert.
- **Plus a ruleset requiring CI on `main`** when the GitHub plan allows it on a private repo.
- **Quiet gate, derived from the database:** no deploy while a crawl run is `running`, a scheduled run is
  due within 45 minutes (or was due in the last 10), a crawl or briefing job is active, or the briefing
  build time from `settings` is within −10/+40 minutes. Checked before the build and again before
  stopping anything.
- **Order:** fast-forward → install → build → quiet gate again → stop the watchdog timer, worker and
  web → dump the database → `docker compose up` if the compose file changed → migrate → start → health
  (`/api/health`, worker active, heartbeat within 4 minutes).
- **Rollback:** a build or migrate failure returns to the previous commit, reinstalls, rebuilds and
  starts web, worker and the watchdog timer again (a failed migration leaves the schema unchanged); a
  health failure stops them and, when the commit changed `packages/db/migrations`, drops and re-creates
  the database and restores the dump taken after web and worker stopped **before** the old code starts,
  so no table a migration added is left behind and the migration journal matches; only the few minutes
  of heartbeats the new code wrote are lost. A failed restore leaves everything stopped, disables the
  timer, blocks further deploys with a sentinel and posts to Lark without the database. Dumps are never
  overwritten. Migrations only move forward. Every failure writes an ops Alert
  (`deploy_failed`, deduplicated per commit and stage), which the watchdog posts to Lark.
- **Code freeze during the block-rate measurement:** the timer is disabled (so a reboot does not
  restart it) from the measurement's `T_start` until its report; env-only restarts outside crawl windows
  are allowed and logged.

## Alternatives considered

- **Required checks only:** not available on private repos of GitHub Free organizations or personal
  accounts, and admins can bypass them; not enough alone.
- **Deploy every commit as POD Studio does:** a red commit or a mid-run restart would reach production;
  rejected.
- **Hard-coded quiet windows:** simpler, but wrong as soon as run times change in `/admin/settings`;
  rejected.
- **Restoring the database on every health failure:** loses nothing more but restores needlessly when no
  migration ran; restore only when migrations changed.
- **Push-based deploy from GitHub Actions over SSH:** needs inbound access or a self-hosted runner on the
  shared host and secrets in GitHub; rejected.
- **Manual deploys only (an agent session runs the script):** no standing code path on the host, but the
  owner's target is a system that updates itself; kept for the measurement window only (the freeze).

## Consequences

- A merge reaches production about 10 minutes after its CI completes (CI takes 7–15 minutes), later when
  it lands near a run or the briefing.
- The host keeps a read-only token valid at most one year; its expiry shows up as an Alert.
- The web app is briefly unavailable during the build and restart, outside the quiet gate's busy times.
