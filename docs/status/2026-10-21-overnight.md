# Overnight status, 2026-10-21

Unattended run of `docs/plans/ideas-hub-phase-1.md`, Steps 1 to 8. Every step is merged to `main`
with CI green on its head commit. What is left needs the owner, a credential, the Linux machine or
calendar time, and is listed under "Pending owner".

## Steps

| Step | PR | Commit on main | State |
| --- | --- | --- | --- |
| 2. Skeleton, schema, core rules | #1 | d091f4c | merged |
| 1. Block-rate probe (sample, schedule) | #2 | cb458f1 | merged; scheduled runs still going |
| 3. Facebook Ad Library adapter and worker | #3 | bdc9303 | merged |
| 4. Measurement, crawler ADR, briefing preview | #4 | 98926d5 | merged; the 3–5 day measurement waits for the probe to end |
| 5. Web app, auth, admin | #5 | 6c1e6f2 | merged |
| 6. Research views, ideas, saves | #6 | 561d603 | merged |
| 7. RSS, holidays, AI sections, Lark, saves from suggestions | #7 | dd34d89 | merged |
| 8. Contract, Linux trial, onboarding, acceptance run (docs and scripts) | #8 | 2c6373f | merged |
| Review fixes (Steps 6–8 critic findings) | #9 | a420d1e | merged |
| Cleanup of the briefing web files | #10 | cbcdf70 | merged |

No step was blocked. At the last check, `pnpm -r test` passed in every package: core 69, rss 3,
db 38, fb-ad-library 39, worker 114, web 75. The full web e2e suite passed locally (100 tests) on
Steps 6, 7 and #9.

## Decisions

Each decision and its reason is in the "Progress" lines of its step in the plan, and the lasting ones
are ADRs:

- [ADR 0003](../adr/0003-crawler-design.md): crawler design (off-screen headed Chrome, delays,
  backoff, probe lock, 6 h cool-down after a block).
- [ADR 0004](../adr/0004-briefing-build-and-delivery.md): briefing build and Lark delivery (at most
  2 LLM calls per briefing, daily cost cap, idempotent sections, uuid dedupe, row written before the
  post).

The ones most worth a look:

- Production browser mode is `offscreen`: 0 blocks in all three modes, and fewer scroll timeouts
  than headless (Step 1).
- Tuned crawler defaults: none. With no block in 142 searches there was nothing to tune, so the
  spec §1 defaults stay and no `settings` row is written (Step 4).
- The worker's scheduled tasks are not registered. They would share the probe's slots until
  2026-10-22, and two crawls must never overlap (Step 4).
- Seed noise sigma is 8 in the e2e seed, so screenshot sizes stay under the limits without changing
  the limits (Step 6).
- When no LLM is configured, AI sections fail without reserving a call or cost, so they are not
  shown as "skipped: cost cap" (#9).
- A Lark post is given up two send timeouts before the 1 h dedupe window ends, so a late retry
  cannot post twice (#9).

## Probe runs since the report

The 13:00 VN run on 2026-10-20 (06:00Z) did 41 searches in `offscreen` mode: 40 `ok`,
1 `no_results`, 0 blocks. It is not yet added to `docs/research/2026-10-20-block-rate.md`.

## Pending owner

- Approve the screenshot baselines for Steps 5, 6 and 7 in
  `apps/web/e2e/__screenshots__/pending/win32/`. Until then the screenshot checks pass but are
  marked unapproved.
- Lark: app credentials and chat ids, then one real post.
- LLM: an endpoint and key, then one real `pnpm briefing:build`.
- Review the news feed list (`packages/db/seed/news-feeds.json`, also editable at `/admin/feeds`)
  and `MODEL_PRICES` (`packages/core/src/briefing/cost.ts`).
- Review the contract `docs/contracts/ideas-hub-v1.md` with the POD Studio owner.
- Linux trial (`docs/ops/linux-trial.md`): go-ahead and a quiet window, the tunnel hostname, the
  `sudo` installs (Xvfb, Chrome, Vietnamese fonts), the 2-day block-rate re-check and the LCP run
  through the tunnel.
- Staff names, store assignments and the 15-minute walkthrough (`docs/onboarding.md`), then the
  14-day acceptance run (`docs/ops/acceptance-run.md`).
- After the probe ends, register the worker tasks with
  `scripts/windows/register-worker-tasks.ps1 -StartAt '2026-10-23 00:30'`. This starts the Step 4
  scheduled measurement: 3–5 days, then fill in the final numbers in the block-rate report.
- Not built and not in any step's Exit: self-service password change, and a screen for each store's
  keywords. Today an admin sets the password when creating the account and manages keywords at
  `/admin/keywords`.

## Scheduled tasks

All three run from the worktree `C:\Users\User\dev\wt\ideas-hub-probe`.

| Task | When | Last result |
| --- | --- | --- |
| `IdeasHub-Probe-Runs` | 01:00 and 13:00 VN until 2026-10-22; next 2026-10-21 01:00 | 2026-10-20 13:00, exit 0 |
| `IdeasHub-Probe-Refetch-24h` | once, 2026-10-21 04:57 | not run yet |
| `IdeasHub-Probe-Refetch-72h` | once, 2026-10-23 04:57 | not run yet |

To delete them:

```powershell
Get-ScheduledTask -TaskName 'IdeasHub-Probe-*' | Unregister-ScheduledTask -Confirm:$false
```

No `IdeasHub-Worker-*` task is registered.

## Unverified

- Real Lark and real LLM calls. Tests use a fake Lark server and a fake LLM client only.
- `scripts/linux/restore.sh` and `install-units.sh` on Linux, the real dump and restore, and LCP
  through the tunnel. Only `bash -n`, `shellcheck` and dry runs were done.
- The seeded news feed URLs were never fetched, and the model prices were not checked against the
  providers.
- The cause of one Step 5 axe flake was not found. The likely cause is the loading skeleton; it did
  not happen again.
- Three MINOR critic findings are open:
  - The chars/3 token estimate in the cost cap has no measured basis.
  - Some tests are missing: `/thumbs` response headers, multi-store saves from briefing rows and the
    ad sheet, and the manual CSV path in e2e.
  - Settings validation does not check the RSS settings or the briefing query time.
