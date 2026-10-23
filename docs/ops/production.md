# Production: the POD Studio host

Status: **in production since 2026-10-22** (phase 2 plan Step 4), at `https://ideas.vetgroup.net`. The
host also runs POD Studio production; Ideas Hub runs beside it as the `ideashub` user. What ran and the
real values are under "Production record (2026-10-22)" below; the steps after it are the runbook used,
kept for a rebuild. Spec "Hosting"; ADR 0001 (ports, units), ADR 0003 (browser mode), ADR 0005 (host).

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
4. `cloudflared` installed; no Cloudflare login on the host (see "Tunnel").

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

The hostname is `ideas.vetgroup.net` on the company's Cloudflare zone `vetgroup.net` (phase 2 plan D5).
A separate named tunnel `ideas-hub` with its own config file; POD Studio's tunnel (`pod-studio-ubuntu`,
locally configured), its config (wherever it lives, for example `/etc/cloudflared/config.yml` or
`~/.cloudflared/config.yml`), its DNS records and every other zone or record of the account are not
edited.

Cloudflare is reached from the development PC, never through a login on the host:

- The Cloudflare CLI `cf` (`npm install --global cf`, in beta; 1.0.0-beta.20 on 2026-10-22) with the auth
  profile `ideas-hub`: the owner's OAuth login (`cf auth create ideas-hub`), bound to the checkout with
  `cf auth activate ideas-hub <checkout>`. Outside the checkout, pass `--profile ideas-hub`.
- The Cloudflare API MCP server (`https://mcp.cloudflare.com/mcp`, OAuth) for read-only cross-checks.
- No API token is stored. The login holds every scope the owner has, not only this zone, so read first,
  print each write before running it, and touch only the tunnel `ideas-hub` and the record `ideas`.

1. Read only: `cf auth whoami`, `cf zones list` (`vetgroup.net` active), `cf dns records list --zone
   vetgroup.net` (no `ideas` record), `cf tunnels list` (no `ideas-hub` tunnel).
2. `cf tunnels create --name ideas-hub --config-source local`. Read its token with `cf tunnels token get`
   into a variable, never printed: it is base64 JSON `{a, t, s}`, i.e. the account tag, tunnel id and
   secret. Write them as `~ideashub/.cloudflared/<ideas-hub-tunnel-id>.json`
   (`{"AccountTag", "TunnelID", "TunnelSecret"}`, `chmod 600`) through `ssh ideashub-prod` stdin, never
   on a command line.
3. The CNAME `ideas` → `<ideas-hub-tunnel-id>.cfargotunnel.com`, proxied (the command has no per-field
   flags, only `--body`):
   `cf dns records create --zone vetgroup.net --body '{"type":"CNAME","name":"ideas","content":"<ideas-hub-tunnel-id>.cfargotunnel.com","proxied":true}'`.
4. On the host, copy `deploy/linux/cloudflared-ideas-hub.yml.example` to `~/.cloudflared/ideas-hub.yml`
   and fill in the id, home path and hostname; `systemctl --user enable --now ideashub-tunnel.service`.
   The `ideashub` user's `~/.cloudflared` then holds only these two files, no `cert.pem`.
5. After Step 4: `cf auth delete ideas-hub` (`cf auth logout` refuses `--profile` and only signs out the
   default profile) and clear the MCP server's authentication. The tunnel keeps running on its own
   credentials.
6. Pending owner: whether to put Cloudflare Access in front. The app has its own sign-in; if Access is
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
that report under a "Linux trial" heading. Fail: record the figures and the options (rollback below, the
browser-mode fallbacks under "Display", ADR 0003) on the pilot issue and in that report, and let the
pilot run on; the owner chooses at the day-14 verdict (owner, 2026-10-22: nothing changes mid-pilot).
Then the LCP check (`docs/ops/acceptance-run.md`), then the 14-day run.

## Off-host backup (Cloudflare R2)

ADR 0007 D3 was reversed by the owner on 2026-10-23: the daily backup goes to a Cloudflare R2 bucket. It is
`restic` (the existing `scripts/linux/ideashub-backup`), not a plain upload: the same run snapshots the
`pg_dump -Fc` of the database, `counts.txt` (row counts and bucket objects) and the whole MinIO volume
(thumbnails), deduplicated between days and encrypted on the host with the restic password, on top of R2's
own encryption at rest. Nothing is kept on the host except the staging directory, which is deleted after a
good run and kept after a failed one; the pre-deploy dumps (last 3) are separate and unchanged.

**What runs, and when.** `ideashub-backup.timer` starts `ideashub-backup.service` daily at 08:30
Asia/Ho_Chi_Minh (no crawl or briefing then; it waits for `ops.lock` behind a deploy or retention pass).
`ideashub-backup-drill.timer` starts `ideashub-backup-drill.service` (`ideashub-backup --drill`) on the 1st
at 09:30. Both read `~/.config/ideas-hub/backup.env` (root's home on this host). The timers are installed
disabled; enable them once `backup.env` exists:
`XDG_RUNTIME_DIR=/run/user/0 systemctl --user enable --now ideashub-backup.timer ideashub-backup-drill.timer`.

**`backup.env`** (`chmod 600`; never in the repo, chat or logs):

| Variable | Meaning |
|---|---|
| `OFFSITE_S3_ENDPOINT` | R2 S3 endpoint, `https://<account id>.r2.cloudflarestorage.com` |
| `OFFSITE_S3_BUCKET` | the bucket |
| `OFFSITE_S3_ACCESS_KEY_ID`, `OFFSITE_S3_SECRET_ACCESS_KEY` | an R2 API token scoped to that bucket, object read and write |
| `OFFSITE_S3_PREFIX` | optional, default `ideas-hub`: the restic repository is `s3:<endpoint>/<bucket>/<prefix>` |
| `OFFSITE_S3_REGION` | optional, default `auto` (what R2 expects) |
| `OFFSITE_RETENTION_DAYS` | optional, default `30`: snapshots older than this are forgotten (`restic forget --keep-within`), packs are pruned on Sundays; only this repository is touched |
| `RESTIC_PASSWORD_FILE` | path of a `chmod 600` file holding the restic password; required. Keep the password in the owner's password manager too: without it no backup can be read |

`RESTIC_REPOSITORY` plus `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` still work for any other restic
repository when no `OFFSITE_S3_*` is set. The first run creates the repository (`restic init`) when it does
not exist. A partial `OFFSITE_S3_*` set, an unreadable password file or a bad `OFFSITE_RETENTION_DAYS` is a
`config` failure.

**When nothing is configured** the script logs `no off-host target configured (OFFSITE_S3_* unset); nothing
to do` and exits 0, with no Alert (this also holds for the drill). **A failure** (dump, counts, repository
init, upload, forget, drill) writes a `backup_failed` Alert keyed `<date>:<stage>`, which the watchdog posts
to Lark; the script exits 1. A failed upload does not touch the database, MinIO or earlier snapshots, and the
staging directory stays for a look; the next run starts over. Log: `~/.local/state/ideas-hub/backup.log`.

**Setup (session, after the owner creates the bucket and token).** Write `backup.env` and the password file
(600), run `ideashub-backup` by hand (creates the repository and the first snapshot), run
`ideashub-backup --drill` (every line `ok`), then enable the two timers above.

**Check.** The restic image and variables are the script's; to list snapshots by hand:

```
set -a; . ~/.config/ideas-hub/backup.env; set +a
export RESTIC_REPOSITORY="s3:${OFFSITE_S3_ENDPOINT%/}/$OFFSITE_S3_BUCKET/${OFFSITE_S3_PREFIX:-ideas-hub}" AWS_ACCESS_KEY_ID="$OFFSITE_S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$OFFSITE_S3_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto
docker run --rm -e RESTIC_REPOSITORY -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION \
  -e RESTIC_PASSWORD_FILE=/run/restic-password -v "$RESTIC_PASSWORD_FILE:/run/restic-password:ro" \
  restic/restic:0.19.1 snapshots --host ideashub
```

(use the digest-pinned image named in `scripts/linux/ideashub-backup`).

**Restore drill from R2.** `ideashub-backup --drill` (also the monthly unit) takes the latest snapshot from
the same repository, restores it into a temporary database and a temporary MinIO, compares them with its
`counts.txt` (`ok` or `DIFF` per line, exit 1 and an Alert on any difference) and removes both. It can run
on any machine that has the checkout, Docker, the compose project and a `backup.env`.

**Restore after a host loss.** (1) Bring up the host and the checkout, `docker compose -p ideas-hub up -d
--wait postgres` and `docker compose -p ideas-hub create minio`; write `backup.env`. (2) With the `docker run`
above, `restic snapshots --host ideashub` and pick a snapshot id (or `latest`). (3) Database: `restic dump
<id> /backup/staging/ideashub.dump | docker compose -p ideas-hub exec -T postgres pg_restore -U ideashub -d
ideashub --no-owner --exit-on-error` (make the `ideashub_ro` role first, as `restore.sh` does). (4) Thumbnails:
`restic restore <id>:/backup/minio --target /data` with `-v ideas-hub_minio-data:/data` added to the
`docker run`, then `docker compose -p ideas-hub up -d --wait minio`. (5) Compare with
`restic dump <id> /backup/staging/counts.txt`, then continue at "7. Units". The drill in
`scripts/linux/ideashub-backup` is the same sequence into temporary targets.

**Cost.** R2 is free to 10 GB-month, then $0.015 per GB-month, and has no egress fee. Retention (ADR 0007)
deletes old thumbnails on the host; they stay in the snapshots until those age out after
`OFFSITE_RETENTION_DAYS`.

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
4. The tunnel hostname can stay (it then answers 502) or be removed from the development PC: after
   `systemctl --user disable --now ideashub-tunnel.service` on the host (a tunnel with live connections
   cannot be deleted), `cf dns records delete <ideas-record-id> -f --zone vetgroup.net` and
   `cf tunnels delete <ideas-hub-tunnel-id> -f`, with the ids read from `cf dns records list` and
   `cf tunnels list` (both take ids, not names; `-f` skips the prompt) and only those two (a new
   `cf auth create ideas-hub` if the login was ended); nothing of POD Studio's needs undoing. The `ideas-hub` compose
   project and its volumes on Linux are kept until the owner decides to delete them
   (`docker compose -p ideas-hub down` keeps volumes; `-v` would delete them).

## Production record (2026-10-22)

Run on 2026-10-22 from 13:55 (Asia/Ho_Chi_Minh), outside the plan's 09:00–11:00 window by the owner's
leave (Ideas Hub was not running anywhere and no crawl was due). POD Studio's `/api/health` was logged
every 30 s on the host for the whole step and checked every minute from the development PC against the
plan's limit (a non-200, or two consecutive samples over 0.05 s): no breach. The log was in `/tmp` until
the reboot below wiped it (tmpfs), then in `~/.local/state/ideas-hub/pod-health-step4.txt`.

### Host and user

| | Value |
|---|---|
| Host | `auto-System-Product-Name.local` (office network only), Ubuntu 26.04.1, kernel 7.0, 12 CPUs, 15 GB RAM |
| User | `ideashub`, uid 1001, lingering on; admin SSH alias `ideashub-prod` (passphrase key) |
| Slice cap | `user-1001.slice`: `MemoryMax=5G`, `CPUQuota=200%` (`memory.max` 5368709120, `cpu.max` `200000 100000`) |
| Root packages (Step 4.1, through `podstudio-prod`) | Ubuntu's `uidmap`, `rootlesskit` 2.0.2, `slirp4netns` 1.3.3, `xvfb` 2:21.1.22-1ubuntu1.3 (it upgraded the shared `xserver-common`; owner accepted); `google-chrome-stable` 155 and `fonts-noto-core` were already installed |
| Docker | rootless, `systemctl --user` `docker.service` from `/usr/share/docker.io/contrib/dockerd-rootless-setuptool.sh install --force` (Ubuntu's `docker.io` 29.1.3; the rootful daemon stays for POD Studio); data in `~/.local/share/docker`; `DOCKER_HOST=unix:///run/user/1001/docker.sock` in `~/.profile` and `~/.config/environment.d/10-ideas-hub.conf` |
| Tools in `~/.local` | Node v24.21.0 (`~/.local/node` → `node-v24.21.0-linux-x64`), pnpm 12.9.1, `cloudflared` 2026.10.3 and `gh` 2.103.0 in `~/.local/bin`, each checked against its published SHA-256 |
| Checkout | `~/ideas-hub`, cloned from `Vet-Group/ideas-hub` with the git credential store (`~/.git-credentials`, 600) |
| Secrets | `~/ideas-hub/.env` (600; `APP_URL=https://ideas.vetgroup.net`); `~/.config/ideas-hub/deploy.env` (`GH_TOKEN`), `ro.env` (`RO_DATABASE_URL`), all 600 |

The Windows `.env` had empty `BETTER_AUTH_SECRET` and `THUMB_URL_SECRET` (development accepts that,
production answers 500), so both were generated on the host (32 random bytes, hex). Sessions and
thumbnail signatures started fresh; the owner signs in with an admin account made on the host
(`pnpm --filter @ideas-hub/web auth:create-user`).

### Data moved from Windows

`dump-windows.ps1 -RepoRoot <main checkout> -OutDir <scratch>` at 13:59, Windows commit `b95dedc`:
`ideashub.dump` 5.8 MB, `minio-data.tgz` 226 MB. `restore.sh` restored both; every row count matched the
manifest (users 1, stores 1, keywords 41, crawl_runs 1, crawl_searches 20, ads 1556, saved_ideas 8,
briefings 2, alerts 0) and 1653 MinIO objects. The restore script then compared only the first table
(`docker compose exec -T` read the rest of the manifest); checked by hand, fixed in PR #49. The Windows
tasks `IdeasHub-Worker` and `IdeasHub-Watchdog` were never registered; `IdeasHub-Probe-*` run the FB
probe spike and write only files, not the Windows database.

### Units and tunnel

- `install-units.sh`: `ideashub-xvfb`, `-web`, `-worker`, `-watchdog.timer`, `-deploy.timer` and
  `-tunnel` enabled; `-backup`, `-backup-drill`, `-sizes`, `-retention` and `-acceptance` timers written
  and disabled.
- Tunnel `ideas-hub` (id `4d268316-bf17-4bec-aa40-045dc1e5f6ab`, locally configured), made with
  `cf --profile ideas-hub`; credentials in `~/.cloudflared/<id>.json` (600, written through SSH stdin),
  config `~/.cloudflared/ideas-hub.yml`; no `cert.pem`. DNS: `ideas.vetgroup.net` CNAME →
  `<id>.cfargotunnel.com`, proxied (record `9cd95fd75bae68872c33d2ebad7d4ef7`). Cross-checked with the
  Cloudflare API MCP server: both tunnels healthy with 4 connections, POD Studio's untouched.

### Checks

| Check | Result |
|---|---|
| Units after install | xvfb, web, worker, watchdog timer, deploy timer, tunnel `active` |
| Caps | worker `memory.max` 2621440000; slice 5368709120 |
| Sign-in through the hostname | 200; `/runs` 200; `/ads` with 120 signed thumbnails; a signed `/thumbs/...` 200 `image/jpeg`, a wrong signature 404 |
| `/briefing` | 200; no briefing was ever finished on Windows (`ready_at` empty), so the first full one follows the first host run |
| Kill test | worker back in 5.2 s; no Chrome left after `stop` |
| Watchdog | a pass every 5 min; its first pass sent 5 `missed_run` (the slots Windows did not run since 2026-10-20), `briefing_late` and `heartbeat_lost`, and restarted the worker once |
| Restart instead of reboot (item 8) | `sudo systemctl restart user@1001.service` at 14:18:51: every unit and both containers back by 14:18:54, before the next `ideashub` login (14:19:06) |
| Real reboot (not planned) | someone pressed the host's power key at 15:22:07 and 15:22:32 (`systemd-logind: Power key pressed short`); the host booted at 15:23:21 and every `ideashub-*` unit, the user's `docker.service` and both containers were up by 15:23:38 with no login; POD Studio's health was 200 at 15:26 |
| Two more reboots (not planned) | at about 15:30 and 15:35 (boots 15:30:43 and 15:35:55; the owner thinks someone at the host restarted it); Ideas Hub came back by itself each time; from 15:37 to 15:44 the session kept Ideas Hub disabled (units, rootless Docker, containers stopped; data kept) to rule it out, then enabled it again. Ideas Hub was idle before each (no build; the last deploy pass at 15:33:52 only read the CI state) |
| Build-failure drill | `IDEASHUB_BUILD_CMD=false ideashub-deploy` on `dc2cfe5` (PR #47): exit 1, `HEAD` stayed `57b43ef`, web, worker and watchdog timer `active`, `deploy_failed` Alert sent to Lark at 07:45:02Z; after `rm failed-sha` a manual run deployed `dc2cfe5` |
| Red CI | `ideashub-deploy --ci-status a749cd8` → `failure, not deployed` |
| Deploy time (D9) | **Over the 10 minutes on the first try.** PR #48: merged 07:50:35Z, its CI on `main` completed 08:00:43Z, `deployed a965288f` at 08:15:39Z: 14 min 56 s. The ticks of 07:56, 08:02 and 08:08 waited because POD Studio's deploy was running (`pgrep -f podflow-deploy`, a gate by design); once clear, build and restart took 1 min 29 s. Deploy unit peak 1,614,315,520 bytes of its 2 GB cap. Measured again on the next PR (Step 5 record) |
| Read-only role | `ideashub_ro` (connection limit 2, `statement_timeout` 60s, read-only default) with column grants only; `insert` in a read-write transaction, `select caption from ads`, `select * from sessions` → permission denied; `create temp table` → denied (also inside a read-write transaction); `\c - ideashub` and `\! id` → syntax errors; `scripts/acceptance.sql`, every `scripts/sql/prod-measure/*.sql` and `scripts/sql/pilot-verdict/*.sql` ran |
| Forced-command keys | `ideashub_ro` ran stdin as SQL whatever command was asked; `ideashub_stats` printed only its files for `id; rm …`; `ideashub_timer` ran only `systemctl --user enable --now ideashub-deploy.timer` for `id; echo PWNED` (nothing printed; the timer came up `enabled`, `active`) |

`gh` was missing on the host, so the deploy's CI gate failed with "gh: command not found" until it was
installed in `~/.local/bin`; the plan's root list did not name it.

## Moved to root (2026-10-22)

The owner decided on one `root` user and one SSH profile, `vet-linux`, for the whole host (ADR 0005, "D6
superseded"). The record above describes the first install as `ideashub`; from 16:35 Ideas Hub runs as
root, with the same units under root's user manager. POD Studio's `/api/health` was logged every 30 s
from 16:35 to 17:36 (122 samples): every one 200; one sample over 0.05 s (0.132 s at 10:12:26Z, during
the restart of `user@0.service` below), never two in a row, so under the limit.

| | Value |
|---|---|
| Access | `ssh vet-linux` (root, POD Studio's admin key). The aliases `ideashub-prod` and `podstudio-prod` were removed from the development PC; `~/.ssh/ideashub_admin` is no longer loaded in its agent |
| Units | root's user manager: lingering on for root; units in `/root/.config/systemd/user`, `systemctl --user` with `XDG_RUNTIME_DIR=/run/user/0` |
| Caps | `systemctl set-property user@0.service MemoryMax=5G CPUQuota=200%` (controllers cpu, memory, pids); worker `memory.max` 2621440000 |
| Docker | the rootful daemon, shared with POD Studio; Ideas Hub stays in its own compose project `ideas-hub` (127.0.0.1:3300, 5433, 9300, 9301) |
| Checkout | `/opt/ideas-hub`, a fresh clone of `main` (`git fsck` clean), credential store in `/root/.git-credentials` (600) |
| Tools | Node v24.21.0 and pnpm 12.9.1 in `/opt/ideas-hub-tools/node-v24.21.0-linux-x64`, linked as `/opt/ideas-hub-tools/node` (not in `/usr/local/bin`, where Node 24 would shadow POD Studio's `/usr/bin/node` 22); `gh` 2.103.0 and `cloudflared` 2026.10.3 in `/root/.local/bin`. The first copy took only the `node` symlink, so until 17:40 the units ran Node from `/home/ideashub`; the tree was copied, the link repointed and web and worker restarted (`restarts.log`); no root process or config refers to `/home/ideashub` now |
| Secrets | `/opt/ideas-hub/.env`, `/root/.config/ideas-hub/deploy.env` and `ro.env`, `/root/.cloudflared/ideas-hub.yml` and `<tunnel id>.json`, all 600; the tunnel config's `credentials-file` points at `/root/.cloudflared` |
| State | `/root/.local/state/ideas-hub` (history of `sizes.csv`, `peaks.csv`, `deploy.log`, `restarts.log` copied over; `deployed-sha` `428db8f`) |
| Forced-command keys | `ideashub_ro`, `ideashub_stats` and `ideashub_timer` in `/root/.ssh/authorized_keys` (backup of the file before: `/root/ideas-hub-migration/authorized_keys.root.bak-20261022165607`), with the commands of ADR 0005 pointed at the root paths |
| Timers | watchdog, deploy, sizes (08:45), retention (09:00), acceptance (07:30); backup and drill stay disabled (ADR 0007) |
| Power key | `/etc/systemd/logind.conf.d/10-ignore-power-key.conf`: `HandlePowerKey=ignore`, from the next boot (logind was not restarted). A long press still forces power off |
| `ideashub` user | locked (`usermod -L -e 1`), lingering off, no process left; its home, checkout and rootless Docker volumes are kept for rollback |

**Data.** At 16:35 the rootless Postgres was dumped (`pg_dump -Fc`) and the MinIO volume archived, with
the worker stopped, into `/root/ideas-hub-backup-20261022/transfer` (manifest created 09:35:55Z, git
`a965288`; a copy is on the development PC), next to `ideashub-config.tgz` and the pre-deploy dumps.
`restore.sh` stopped at `pg_restore: role "ideashub_ro" does not exist` (the dump grants to it); the
project was reset and the role made first by hand, then the same steps: every table's row count matched
the manifest; MinIO 1653 objects against 1655 (2 MinIO trash files). `restore.sh` makes the role itself
since PR #54.

| Check | Result |
|---|---|
| Kill test | `kill -9` of the worker: back in 5.1 s, no Chrome left |
| Restart of `user@0.service` | every unit back and started after the restart; both containers healthy; `/login` 200 through the hostname, `/api/health` 200 locally; heartbeat fresh |
| Deploy | `ideashub-deploy --check` as root: `no new commit (428db8fb)` (`git fetch` works; the old checkout's objects were broken by the 15:29 power-off) |
| Forced-command keys | `ideashub_ro` ran only SQL (`select caption from ads` and an insert into `settings` denied); `ideashub_stats` printed only its files; `ideashub_timer` only enabled the deploy timer, the extra command asked did not run |
| Disk Alert (Step 5) | one `ideashub-sizes` by the unit (`Result=success`); `IDEASHUB_DISK_WARN_PCT=1 IDEASHUB_ALERT_KEY=test:20261022T102937Z` → `disk_space` Alert at 10:29:38Z, posted to Lark at 10:30:07Z (message id recorded), then resolved |
| LCP (Step 8, before day 1) | `lcp:briefing` as a staff account through `https://ideas.vetgroup.net`: 192, 164, 176, 176, 176 ms, median 176 ms; no briefing was ready yet, so it is run again on day 1 (issue #55) |

**Rollback to `ideashub`.** Rootless data is as of 16:35; anything written later is only in the root
project, so dump it first (`docker compose -p ideas-hub exec -T postgres pg_dump -U ideashub -d ideashub
-Fc`). Then as root: `XDG_RUNTIME_DIR=/run/user/0 systemctl --user disable --now ideashub-worker
ideashub-watchdog.timer ideashub-deploy.timer ideashub-acceptance.timer ideashub-sizes.timer
ideashub-retention.timer ideashub-tunnel ideashub-web ideashub-xvfb`; `docker compose -p ideas-hub stop`
(keeps volumes); `usermod -U -e '' ideashub`; `loginctl enable-linger ideashub`; as `ideashub`
`systemctl --user enable --now docker.service`, then its units. The `ideashub` checkout needs a fresh
clone first (its git objects are broken). Remove the three forced-command lines from root's
`authorized_keys` (or restore the backup above) and add the `ideashub-prod` alias back.

## Pilot run (phase 2 Step 8)

Day 1 is 2026-10-23, `<run-start>` 2026-10-22T17:00:00Z, day 14 is 2026-11-05; tracking issue #55. The app
version under test is `8849d3f`. The Trending sort went in just before day 1 (#60 merged 23:12, deployed
23:28; #61 merged 23:42, deployed 23:54, 2026-10-22 ICT); on 2026-10-23 the owner kept it, and the code
freeze counts from `8849d3f`. The first scheduled crawl on Linux is 2026-10-23 01:00: every slot from
2026-10-20 13:00 to 2026-10-22 13:00 is `missed`, because the Linux worker first ran at 14:05 on 2026-10-22,
when the watchdog backfilled them.

Decided by the owner on 2026-10-22:

- No Cloudflare Access in front of `ideas.vetgroup.net`: the app has its own sign-in.
- Code freeze from day 1 to the verdict: no app-code, crawl-setting, schedule or model change reaches `main`.
  Docs and ops PRs still merge; each new green commit is deployed by the timer, inside its quiet gate.
  **Narrowed by the owner on 2026-10-23:** app code merges again (phase 3 items 1 and 2 and UI fixes), on
  green CI and through the same quiet gate. What the pilot measures stays frozen until the verdict: the
  crawler and its settings, schedules, the briefing pipeline and the LLM model. The one exception so far is
  #66 (2026-10-23), which made the briefing's LLM call valid for `gpt-6-luna`; the version under test is
  therefore `8849d3f` plus #66 for the measured paths.
- A failed check is recorded and reported only. Nothing on the host changes mid-pilot; the fix options go
  to the verdict.
- The `ideashub` user's home and rootless volumes (2.7 GB) are deleted after a passing verdict (#55 closed),
  not before. A failed verdict keeps them. This replaces the 2026-10-29 cleanup approved earlier that day.

Windows tasks on the development PC. They are read-only on the host except one `acceptance_failed` ops
Alert on a failure, sent through `pnpm ops:alert`, which the watchdog posts to Lark. The day scripts are in
the owner's `Documents\ops`, outside the repo.

| Task | When (Asia/Ho_Chi_Minh) | What |
|---|---|---|
| `IdeasHub-Check-Crawl-20261023` | 2026-10-23 03:05 | `Report-IdeasHub-Day.ps1 crawl`: the 01:00 run's status, searches, worker and root Chrome on #55 |
| `IdeasHub-Report-Day1-20261023` | 2026-10-23 07:40 | `Report-IdeasHub-Day.ps1 day1`: the day comment in the `acceptance-run.md` format, the model rule (keep `gpt-6-luna` only if the briefing is ready before 07:00 with news and suggestions ok, `llm_calls` ≤ 2 and cost under $0.20; otherwise recommend `gpt-6-sol`, never switched automatically) and the LCP check |
| `IdeasHub-Pilot-Daily` | 08:00, 2026-10-24 to 2026-11-05 | `Report-IdeasHub-Day.ps1 daily`: the same comment without the LCP check. On a failure, `claude -p` (no usable tool, no MCP) writes a second comment with the likely cause and fix options |
| `IdeasHub-Check-BlockRate-20261024` | 2026-10-24 20:00 | `Report-IdeasHub-Day.ps1 blockrate`: step 9 over the first four scheduled Linux runs, on #55 and under "Linux trial" in `docs/research/2026-10-20-block-rate.md` (a docs PR merged on green CI) |
| `IdeasHub-Pilot-Verdict` | 2026-11-06 02:00 | `scripts/windows/ops-report.ps1 -Report pilot-verdict`: the verdict SQL, AC 4/5/7 tests at the deployed commit on this PC, the grade in code, `docs/ops/pilot-verdict.md` in a PR merged on green CI, the verdict on #55 (closed on a pass), Lark |
| `IdeasHub-Cleanup-OldUser-20261106` | 2026-11-06 10:00 | `Cleanup-IdeasHub-OldUser.ps1`: deletes `/home/ideashub` only if #55 is closed, no comment on it mentions a rollback, the account is locked with no process and nothing mounted, the root units are active and `/root/ideas-hub-backup-20261022` exists |
| `IdeasHub-Phase3-Start` | disabled 2026-10-23 | Was: after a PASS, build item 1 of `docs/plans/ideas-hub-phase-3.md`. Items 1 and 2 are built before the verdict instead, so the task would only repeat them |

## External heartbeat (phase 3 item 3)

The watchdog runs on the host, so a host that is fully down (power, network, the tunnel) sends nothing. A
Cloudflare Worker with a cron trigger probes the app from outside and posts to the same Lark group. Code:
`deploy/cloudflare/heartbeat/` (not part of the app, the crawler, the schedules or the briefing).

What it checks: every 5 minutes, `GET https://ideas.vetgroup.net/api/health` (the app's public health
route: 200 after a `select 1`, so it covers the tunnel, the web process and the database) with a 10 s
timeout; healthy is exactly HTTP 200 (a redirect or 5xx counts as a failure).

What it posts (Vietnamese, one message per state change, never per tick):

- **down**: after 2 failed probes in a row (about 5 to 10 minutes), so a deploy restart does not alert.
- **recovered**: on the first healthy probe after a down, with the outage length.
- If Lark rejects a post, the state change is not recorded and the next tick posts it again.

State is one KV key (`state`) in the `HEARTBEAT` namespace, written only when it changes. The Lark
webhook URL and signing secret are Worker secrets; the same values as `LARK_WEBHOOK_URL` and
`LARK_WEBHOOK_SECRET` in the host's `.env` (leave the secret out if the bot does not sign).

### Deploy (owner's Cloudflare account; run from `deploy/cloudflare/heartbeat/`)

```sh
npx wrangler login
npx wrangler kv namespace create HEARTBEAT      # prints an id: put it in wrangler.toml (kv_namespaces.id)
npx wrangler secret put LARK_WEBHOOK_URL        # paste the webhook URL at the prompt
npx wrangler secret put LARK_WEBHOOK_SECRET     # only when the bot has a signing secret
npx wrangler deploy
```

The first `secret put` before the first `deploy` offers to create the Worker; answer yes. The KV id is an
identifier, not a secret, so committing it in `wrangler.toml` is fine; do that in a PR.

### Test

- Locally, no Cloudflare calls for the state: `npx wrangler dev --test-scheduled`, then
  `curl "http://localhost:8787/__scheduled?cron=*%2F5+*+*+*+*"`. Secrets for `wrangler dev` go in an
  untracked `.dev.vars` (`LARK_WEBHOOK_URL=...`).
- Deployed, force a "down": `npx wrangler deploy --var HEALTH_URL:https://ideas.vetgroup.net/does-not-exist`
  (404 is a failure), wait 10 minutes for the down message, then `npx wrangler deploy` again (the default
  URL) and wait 5 minutes for the recovered message. Live logs: `npx wrangler tail`.
- Code: `pnpm --filter @ideas-hub/heartbeat test` (the state machine, the Lark signature and the payload,
  without a network).

### Pause or remove

- Pause (no probes, no posts): remove the cron with `crons = []` in `wrangler.toml` and `npx wrangler deploy`;
  restore `*/5 * * * *` and deploy to resume. Planned host maintenance longer than 10 minutes pages Lark
  otherwise, so pause first.
- Remove: `npx wrangler delete ideas-hub-heartbeat`, then delete the KV namespace in the dashboard.
