# Runbook: Linux desktop trial

Status: **ready to run, not run.** Pending owner: the go-ahead to touch the Linux desktop (it hosts POD
Studio production), the tunnel hostname, and the installs that need `sudo` (Xvfb, Google Chrome). Plan
Step 8; spec "Hosting"; ADR 0001 (ports, units) and ADR 0003 (browser mode).

Files: `scripts/linux/dump-windows.ps1` (Windows side), `scripts/linux/restore.sh` and
`scripts/linux/install-units.sh` (Linux side), units under `deploy/linux/`. Every script has a dry run
(`-DryRun` for the `.ps1`, `--dry-run` for the `.sh`): run it first and read what it would do.

## Rules for the whole trial

- **Never both at once.** Windows is stopped before the dump and stays stopped once Linux crawls. Two
  workers on one database, or two databases crawling the same slots, would double runs and Lark posts.
- **Nothing of POD Studio's is edited**: not its compose project, database, units, ports or tunnel
  config. Ideas Hub has its own compose project (`ideas-hub`, from `docker-compose.yml`'s `name:`), its
  own volumes (`ideas-hub_pg-data`, `ideas-hub_minio-data`), its own `ideashub-*` user units and its own
  named tunnel.
- No secrets in the repo, the shell history or chat. `.env` is copied by hand (`scp`), `chmod 600`.

## Ports

| Service | Port (bound to 127.0.0.1) | Where it is set |
|---|---|---|
| Web (Next.js) | 3300 | `deploy/linux/ideashub-web.service`, `apps/web/package.json` |
| Postgres | 5433 | `docker-compose.yml`, `.env` `DATABASE_URL` |
| MinIO API / console | 9300 / 9301 | `docker-compose.yml`, `.env` `S3_ENDPOINT` |
| Xvfb display | `:99` (no TCP: `-nolisten tcp`) | `deploy/linux/ideashub-xvfb.service`, worker unit `DISPLAY` |

These are the development ports of ADR 0001, chosen to avoid POD Studio's 3100 and the dev machine's
20128, 1933, 11434, 8642 and 40325. POD Studio's ports on the Linux desktop are not known from this repo,
so `restore.sh` checks 3300, 5433, 9300 and 9301 with `ss` and stops if one is taken. Then pick a free
port and change it in every place of that row (and `APP_URL` if the web port moves), before going on.
The e2e port 3310 is development only.

## Display: Xvfb, not the user's graphical session

The worker drives real headed Chrome (ADR 0003: off-screen mode). Chosen: a virtual display, Xvfb on
`:99`, as its own user unit (`ideashub-xvfb.service`) that the worker `Requires`. Why:

- With lingering, user units start at boot **before anyone logs in**; the graphical session (and its
  `DISPLAY`/Wayland socket) exists only while the owner is logged in to the desktop, so the 01:00 run
  would fail after any reboot or logout. Xvfb does not depend on a login.
- Nothing appears on the POD Studio desktop, and a locked screen or a Wayland session (where an X window
  needs XWayland and may be throttled when hidden) cannot change Chrome's behaviour.
- The cost: a 1920×1080×24 virtual screen instead of a physical one, a fingerprint difference the 2-day
  re-check below measures. The browser mode stays `offscreen` (unset `IDEAS_HUB_BROWSER_MODE`), the mode
  measured on Windows, so only the host changes between the two measurements. Fallbacks, in order:
  `IDEAS_HUB_BROWSER_MODE=headed` on Xvfb, then the graphical session (`DISPLAY=:0` and a desktop
  autologin), each re-checked for 2 days.

## Prerequisites (owner, on the Linux desktop)

1. Node 24 and pnpm 12.9.1 for the user that runs Ideas Hub (`node -v`, `pnpm -v`); Docker with the
   compose plugin; `ss` (iproute2), `sha256sum`.
2. `sudo apt install xvfb` and Google Chrome stable (Playwright uses `channel: 'chrome'`:
   `sudo pnpm --filter @ideas-hub/worker exec playwright install --with-deps chrome`, or Google's `.deb`).
   Plus fonts with Vietnamese glyphs for screenshots (`fonts-noto`).
3. A checkout: `git clone <ideas-hub-repo> <repo-dir>` at the commit Windows runs (`git rev-parse HEAD`
   on Windows; `manifest.txt` records it).
4. `cloudflared` installed and logged in to the Cloudflare account (see "Tunnel").

## Steps

Choose a quiet window: after the 07:00 briefing post and well before the 13:00 slot (Asia/Ho_Chi_Minh),
for example 09:00–11:00, so no run is due during the switch.

### 1–2. Windows: stop everything, then dump (`scripts/linux/dump-windows.ps1`)

1. Stop the Windows web app if it runs (`pnpm dev`/`next start` window), so nobody saves after the dump.
2. `powershell -File scripts\linux\dump-windows.ps1 -DryRun`, read it, then run it without `-DryRun`.
   In this order it:
   - disables and stops `IdeasHub-Worker` and `IdeasHub-Watchdog`, which stops every Lark send (the
     worker's `lark.send` and the watchdog's Alert sends); disabled rather than unregistered, so rollback
     is `Enable-ScheduledTask`;
   - refuses if a worker, watchdog or web node process of the checkout is still alive, a run is
     `running` or a pg-boss job is `active`;
   - `pg_dump -Fc` inside the Postgres container, copied out to `transfer\ideashub.dump`;
   - stops MinIO, tars its volume to `transfer\minio-data.tgz`, starts it again;
   - writes `transfer\manifest.txt` (git commit, SHA-256 and size of both files, row counts, object
     count).
   Queued pg-boss jobs (the scheduler's `crawl.run` jobs 14 days ahead, any pending `lark.send`) are in
   the dump and are worked on Linux; Lark posts are idempotent per `uuid`.

### 3. Copy to Linux

`scp -r transfer <linux-user>@<linux-host>:<repo-dir>/transfer`, and `.env` to `<repo-dir>/.env`
(`chmod 600`). On Linux edit `.env`: `APP_URL=https://<tunnel-hostname>` (the upload route checks the
origin against it, spec §2); `DATABASE_URL` and `S3_*` stay as in `.env.example` unless a port moved.
Keep `BETTER_AUTH_SECRET` and `THUMB_URL_SECRET` as on Windows (sessions and signed thumbnail URLs keep
working); never print them.

### 4–6. Linux: restore (`scripts/linux/restore.sh`)

`scripts/linux/restore.sh --dry-run`, read it, then `scripts/linux/restore.sh`. It:

- checks tools, `.env`, the four ports, that no `ideas-hub` compose volume exists yet, and the SHA-256
  sums in the manifest;
- `docker compose -p ideas-hub up -d --wait postgres`, `pg_restore --no-owner --exit-on-error` into the
  fresh `ideashub` database (history, settings, run rows and queued jobs carry over);
- creates the MinIO volume, untars the Windows data into it, starts MinIO;
- `pnpm install --frozen-lockfile`, `pnpm db:migrate` (a no-op at the same commit),
  `pnpm --filter @ideas-hub/web build`;
- compares row counts with the manifest (`ok` or `DIFF` per table) and exits 1 if any table differs.

### 7. Units (`scripts/linux/install-units.sh`)

`scripts/linux/install-units.sh --dry-run` prints each unit with the paths filled in; then run it. It
writes `~/.config/systemd/user/ideashub-*.{service,timer}`, runs `loginctl enable-linger $USER` (units
run without a login and survive logout), `systemctl --user daemon-reload`, and
`enable --now` for:

| Unit | Does | Mirrors on Windows |
|---|---|---|
| `ideashub-xvfb.service` | Xvfb `:99`, `Restart=always` | the logged-in desktop session |
| `ideashub-web.service` | `pnpm exec next start --port 3300 --hostname 127.0.0.1`, `Restart=always` | `pnpm --filter @ideas-hub/web start` |
| `ideashub-worker.service` | `pnpm --silent worker` with `DISPLAY=:99`, `Restart=always`, `RestartSec=5`, `StartLimitIntervalSec=0`; `KillMode=control-group` stops Chrome with it | `IdeasHub-Worker` running `worker-loop.ps1` (5 s restart, job object) |
| `ideashub-watchdog.timer` → `.service` | `pnpm --silent watchdog` every 5 min (`OnCalendar=*:0/5`), oneshot, 240 s limit | `IdeasHub-Watchdog` every 5 min, 4 min limit |
| `ideashub-tunnel.service` | `cloudflared tunnel --config ~/.cloudflared/ideas-hub.yml run`; enabled only once that file exists | none |

The worker unit name is fixed: the watchdog restarts it with `systemctl --user restart ideashub-worker`
(`apps/worker/src/watchdog.ts`). Logs: `journalctl --user -u ideashub-worker -f` (and `-web`,
`-watchdog`); `systemctl --user list-timers ideashub-watchdog.timer`.

### Tunnel: a new hostname, POD Studio's tunnel untouched

A separate named tunnel with its own config file; POD Studio's tunnel, its config (wherever it lives,
for example `/etc/cloudflared/config.yml` or `~/.cloudflared/config.yml`) and its DNS records are not
edited.

1. `cloudflared tunnel login` only if `~/.cloudflared/cert.pem` does not exist yet; if POD Studio's
   setup already created it for the same Cloudflare account, reuse it (do not overwrite it).
2. `cloudflared tunnel create ideas-hub` (writes `~/.cloudflared/<ideas-hub-tunnel-id>.json`).
3. `cloudflared tunnel route dns ideas-hub <tunnel-hostname>`.
4. Copy `deploy/linux/cloudflared-ideas-hub.yml.example` to `~/.cloudflared/ideas-hub.yml` and fill in
   the id, home path and hostname; `systemctl --user enable --now ideashub-tunnel.service`.
5. Pending owner: whether to put Cloudflare Access in front. The app has its own sign-in; if Access is
   added, the LCP check and the future `/api/v1` need it too (`docs/contracts/ideas-hub-v1.md`).

### 8. Smoke check (same day)

- `systemctl --user is-active ideashub-xvfb ideashub-web ideashub-worker` → three `active`;
  `systemctl --user list-timers` shows the watchdog's next tick.
- `https://<tunnel-hostname>/login` signs in; `/briefing` shows the last Windows briefing with its
  thumbnails (MinIO restored); `/runs` shows the Windows history.
- Kill test: `systemctl --user kill ideashub-worker` → back within 10 s (`systemctl --user status`), and
  `pgrep -f playwright_chromiumdev_profile` shows no leftover Chrome after
  `systemctl --user stop ideashub-worker` (then start it again).
- Reboot test, if the owner allows a reboot of the POD Studio host: after reboot, without logging in,
  the three units are active (lingering).
- `journalctl --user -u ideashub-watchdog --since -15min` shows a `watchdog` line every 5 min.

### 9. Block-rate re-check: 2 days (4 scheduled runs)

After the first two days of scheduled runs on Linux, with `<switch-time>` the UTC time the Linux worker
started, run `scripts/acceptance.sql`'s `ac1_success_ratio` with its window replaced and the blocked
searches added:

```sql
select coalesce(sum(case when r.status in ('scheduled', 'missed') then 0 else s.ok end), 0) as ok_searches,
       coalesce(sum(r.planned_searches), 0) as planned_searches,
       round(coalesce(sum(case when r.status in ('scheduled', 'missed') then 0 else s.ok end), 0)::numeric
         / nullif(sum(r.planned_searches), 0), 4) as success_ratio,
       coalesce(sum(s.blocked), 0) as blocked_searches
from crawl_runs r
left join lateral (
  select count(*) filter (where status in ('ok', 'no_results'))::int as ok,
         count(*) filter (where status = 'blocked')::int as blocked
  from crawl_searches where run_id = r.id
) s on true
where r.trigger = 'schedule' and r.scheduled_for >= '<switch-time>' and r.scheduled_for <= now();
```

Pass: `success_ratio` ≥ 0.90 and run durations within the spec §1 estimate (compare with
`docs/research/2026-10-20-block-rate.md`). Record the numbers, blocks, durations and backoff waits in
that report under a "Linux trial" heading. Fail: stop (rollback below, or the browser-mode fallbacks
under "Display") and bring the options to the owner (ADR 0003 decision point). Then the LCP check
(`docs/ops/acceptance-run.md`), then the 14-day run.

## Rollback

1. On Linux: `systemctl --user disable --now ideashub-worker.service ideashub-watchdog.timer
   ideashub-web.service ideashub-tunnel.service ideashub-xvfb.service`. Confirm no Chrome or worker
   process is left (`pgrep -af 'src/main.ts|playwright_chromiumdev_profile'`).
2. Data: if Linux ran no scheduled run and nobody saved anything, the Windows database is still the
   source of truth (it was not written after the dump). Otherwise reverse the copy: `pg_dump -Fc` on
   Linux (`docker compose -p ideas-hub exec -T postgres pg_dump -U ideashub -d ideashub -Fc -f /tmp/x.dump`
   and `docker compose cp`), restore it on Windows into the `ideashub` database after a backup dump of the
   Windows one, and the same for MinIO if thumbnails were added.
3. On Windows: `Enable-ScheduledTask IdeasHub-Worker; Enable-ScheduledTask IdeasHub-Watchdog;
   Start-ScheduledTask IdeasHub-Worker`. The watchdog backfills the slots missed in between as `missed`.
4. The tunnel hostname can stay (it then answers 502) or be removed with `cloudflared tunnel route` /
   `cloudflared tunnel delete ideas-hub`; nothing of POD Studio's needs undoing. The `ideas-hub` compose
   project and its volumes on Linux are kept until the owner decides to delete them
   (`docker compose -p ideas-hub down` keeps volumes; `-v` would delete them).

## Pending owner

- The go-ahead to run steps 1–9 on the Linux desktop, and a quiet window.
- `<tunnel-hostname>`, the Cloudflare account and whether Cloudflare Access fronts it.
- `sudo` installs: Xvfb, Google Chrome, fonts; confirm Node 24 and pnpm 12 for the service user.
- Confirm 3300, 5433, 9300 and 9301 are free on that host (the script checks) and that a reboot test is
  allowed.
