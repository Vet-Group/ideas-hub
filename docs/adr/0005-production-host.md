# ADR 0005: Production host

Status: accepted (2026-10-21) for the host, isolation, caps and unattended access (phase 2 plan v5), the
Linux account and Docker access (D6) and the public hostname (D5, changed 2026-10-22 to
`ideas.vetgroup.net`).
Deciders: owner.
Inputs: [phase 2 plan](../plans/ideas-hub-phase-2.md), ADR 0001 (ports, units), ADR 0003 (browser
mode), `docs/ops/production.md`.

## Context

Phase 1 runs on the development PC, which is not on 24/7: the 01:00 and 13:00 runs and the 07:00
briefing are not reliable there. Ideas Hub needs a host that runs unattended: headed Chrome on a virtual
display, Postgres, MinIO, the web app and the watchdog. Ideas Hub is the owner's personal project, so
cost is personal money. The Linux host that runs POD Studio production is on 24/7, and phase 1 Step 8
already wrote units and scripts for it. Auto-deploy (ADR 0006) will run code from the repo on that host
every time `main` changes.

## Decision

- **Host:** the Linux host that runs POD Studio production. The owner is responsible for having
  permission to use it.
- **Isolation from POD Studio:** Ideas Hub's own compose project (`ideas-hub`), volumes, `ideashub-*`
  systemd user units, ports (web 3300 on 127.0.0.1, Postgres 5433, MinIO 9300/9301) and named tunnel;
  nothing of POD Studio's is edited.
- **An unprivileged Linux user `ideashub` with rootless Docker** (decided 2026-10-21, D6): its own home, user
  manager, units, `~/.cloudflared` and cgroup; not in the `docker` group, which would be root-equivalent
  on the POD Studio host for anyone who can merge to `main`. Rootless Docker keeps `restore.sh` and the
  compose file unchanged and puts the containers inside the user's cgroup. Created before the resource
  measurement, so no session ever uses POD Studio's user.
- **Caps:** the `ideashub` user slice is hard-capped (`MemoryMax=5G`, `CPUQuota=200%`), so everything
  Ideas Hub runs, containers and builds included, stays inside it whatever slice POD Studio's services
  sit in; per-unit caps inside it (worker with Chrome, web, Xvfb, deploy, backup), Chrome first to be
  killed on memory pressure, and `mem_limit`/`cpus` on the containers. The `memory` and `cpu`
  controllers must be delegated to that user's manager (an instance drop-in on
  `user@<ideashub uid>.service` when missing, restarting only that manager).
- **Before install:** a 24 h read-only resource measurement with fixed "not enough" thresholds (plan
  Step 3). A no-go stops the install; the owner decides what follows. There is no automatic move to a VPS.
- **Unattended reports** (scheduled on the development PC) do every action in fixed code: collection
  through forced-command SSH keys (one SQL text through a `pg` client to a read-only role whose column
  grants exclude the ad text in `ads`, sessions, accounts and password hashes; fixed queries that print
  counts and flags only; a `cat` of the stats files; the deploy timer only), the verdict, git and the PR,
  the Lark summary. The model only writes prose in `docs/`, in a session cut off from the user's
  settings and MCP servers, with no shell, proven by a canary. The admin key for interactive sessions
  is passphrase-locked.
- **Public hostname** (D5, changed 2026-10-22): `ideas.vetgroup.net`, a subdomain on the company's
  Cloudflare zone, served by Ideas Hub's own locally configured tunnel `ideas-hub`. The tunnel and its
  DNS record are made from the development PC with the Cloudflare CLI `cf` (auth profile `ideas-hub`, the
  owner's OAuth login) and checked with the Cloudflare API MCP server; no API token is stored. The host
  gets only that tunnel's credentials file in the `ideashub` home: no origin certificate and no
  `cloudflared tunnel login` there. The 2026-10-21 choice, a personal domain on a personal account, was
  dropped to save its cost and the second account.

## Alternatives considered

- **A personal VPS** (4 vCPU, 8 GB, 80+ GB; about €7–15/month): isolated, but a datacenter IP, which
  Facebook is more likely to block than the office IP the probe measured (not measured), and one more
  machine to maintain. The fallback the owner may choose after a no-go.
- **The `docker` group for `ideashub`:** no setup, but root-equivalent; only if rootless Docker fails
  and the owner accepts the risk in writing.
- **No Docker for `ideashub`, host clients against 127.0.0.1:** not root-equivalent, but every compose
  change needs the owner's `sudo` and the scripts change.
- **POD Studio's Linux user:** shared unit namespace and `~/.cloudflared` (a `cloudflared tunnel login`
  there would overwrite POD Studio's origin certificate); rejected.
- **The development PC kept on:** no 24/7 guarantee; rejected.

## Consequences

- The owner runs two short `sudo` sittings (user, then packages, slice cap and delegation).
- POD Studio's health is watched during every host step; a resource or health problem stops the step.
- Postgres and MinIO keep the compose file's local-only credentials and listen on 127.0.0.1 only.
- The backup bucket is personal while the repo, host and hostname are the company's; moving it is a
  follow-up if the project becomes the company's.
- The owner's Cloudflare login is not limited to `vetgroup.net`: it can change every zone and tunnel of
  the company account, POD Studio's included. Sessions read first, print each write, touch only the
  tunnel `ideas-hub` and the record `ideas`, and the login is ended after Step 4.
- A full host outage cannot send an Alert; the missing 07:00 briefing is the signal.
