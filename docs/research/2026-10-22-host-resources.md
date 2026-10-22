# Host resources: can the POD Studio host also run Ideas Hub?

Date: 2026-10-22. Phase 2 plan Step 3 (items 2, 4 and 5). Read-only on the host: the session ran as
`ideashub` over `ssh ideashub-prod` and wrote only under `/tmp/ideas-hub-measure`.

Verdict: go

Every item 4 threshold passes on the samples taken. The measurement was closed early by the owner's
decision of 2026-10-22 (plan "Owner decisions (2026-10-22)"), so it covers 18.25 h, not 24 h; see
"Limits" before relying on the CPU numbers.

## Host

| | Value |
|---|---|
| OS | Ubuntu 26.04.1 LTS, kernel 7.0.0-38-generic, systemd 259 (259.5-0ubuntu3.4) |
| CPU | `nproc` 12 |
| RAM | 15,369 MB total; `free -m` "available" 9,378 MB at the start |
| Swap | `/swap.img`, 4 GB file, 412 MB used at the start |
| Disk (`/`, also `/home` and `/var/lib/docker`) | `/dev/nvme0n1p2`, 233 GB; 160 GB free, 28% used on 2026-10-21 16:11 (UTC+7); 146 GB free, 34% used on 2026-10-22 10:30 |
| cgroups | `cgroup2fs`; controllers delegated to the `ideashub` manager: `cpu memory pids` |
| Ports 3300, 5433, 9300, 9301 | all free |
| Docker | `docker.io` 29.1.3-0ubuntu4.1 (Ubuntu's package, rootful, used by POD Studio); no `docker-ce`, `uidmap`, `docker-ce-rootless-extras` or `fuse-overlayfs` |
| Rootless prerequisites | kernel ≥ 5.11 (overlay in a user namespace works); `kernel.apparmor_restrict_unprivileged_userns=1` (Step 4.1 needs the `rootlesskit` AppArmor profile); `/etc/subuid` and `/etc/subgid`: `ideashub:165536:65536` |
| Uptime | up since 2026-10-13 10:41 (UTC+7), no reboot during the measurement |

## Sampling

- `/tmp/ideas-hub-measure/sample.sh`: a `nohup setsid` loop, one line every 5 minutes with the fields
  of Step 3 item 2 (`MemAvailable`, `/proc/loadavg`, idle/`si`/`so` from `vmstat 1 2 | tail -1`, and
  POD Studio's `/api/health` code and time). It survived the SSH disconnect (checked by reconnecting).
- First sample 2026-10-21T09:12:04Z (16:12 UTC+7), last 2026-10-22T03:27:05Z (10:27 UTC+7);
  stopped by the session at 03:29Z. **220 samples over 18.25 h** (76% of the planned 288); gaps between
  samples 299–301 s, none missing.

## Thresholds (Step 3 item 4)

| Threshold | No-go when | Measured | Result |
|---|---|---|---|
| RAM | minimum `MemAvailable` < 6 GB | 7,195,756 kB (6.86 GiB, 7.37 GB) on 2026-10-22 09:02 (UTC+7); median 9,698,270 kB; max 11,882,900 kB | pass |
| Swap | `si` or `so` > 0 in more than 10% of samples | 1 of 220 (0.5%): `si` 4 on 2026-10-22 09:02, the same sample as the RAM minimum | pass |
| CPU count | `nproc` < 4 | 12 | pass |
| CPU, 01:00–05:30 | p95 of `100 − idle` > 50% | 54 samples (2026-10-22 01:02–05:27): p95 17%, max 23% | pass |
| CPU, 13:00–17:30 | p95 of `100 − idle` > 50% | 16 samples, **only from the afternoon of 2026-10-21** (16:12–17:27): p95 15%, max 15% | pass |
| CPU, both windows | p95 of `100 − idle` > 50% | 70 samples: p95 15% | pass |
| Disk free | < 60 GB on the filesystem of `~ideashub` | 146 GB (2026-10-22), 160 GB (2026-10-21) | pass |
| Disk used | ≥ 70% | 34% (2026-10-22), 28% (2026-10-21) | pass |
| cgroups | not `cgroup2fs` | `cgroup2fs` | pass |

All samples: CPU busy p95 15%, max 32%, median 3%; 1-minute load at most 2.87. Percentiles are
nearest-rank. Times are UTC+7 unless marked Z.

## POD Studio health baseline

- 219 of 220 samples returned 200. **Median 0.0030 s** (2.986 ms), p95 0.0116 s, max 0.0179 s.
- One sample, 2026-10-21T10:52:04Z (17:52 UTC+7), returned code `000` in 0.000075 s: the connection was
  refused at once, so POD Studio's web was not listening at that moment (a restart or deploy is likely,
  not checked). The next sample was 200.
- The plan's rule for Steps 4–6 is "all 200, times ≤ 3× Step 3's median", i.e. ≤ 0.009 s. The p95 of this
  quiet baseline is already 0.0116 s, so that rule would stop a step on normal jitter; the owner may want
  a floor (for example the larger of 3× the median and the baseline's max, 0.018 s) before Step 4.

## Limits

- 18.25 h instead of 24 h, by the owner's decision. The 13:00–17:30 window holds only 16 samples, all
  from the afternoon of 2026-10-21 (16:12–17:27); 13:00–16:10 and the afternoon of 2026-10-22 were not
  sampled. The morning of 2026-10-22 (07:30–10:27) is included and had the lowest `MemAvailable`.
- `MemAvailable` fell from about 9.7 GB to 7.2 GB during the morning of 2026-10-22, then recovered to
  7.8 GB by the last sample; the margin to the 6 GB threshold at that low point was 0.86 GiB.
- Disk use grew from 28% to 34% (about 14 GB) between the two readings; the cause was not checked. At
  that rate the 70% line would be about 5 days away, so the disk Alerts of Steps 4–5 matter.
- `/tmp` is a tmpfs: a reboot would have lost the samples. The raw files stay in `/tmp/ideas-hub-measure`
  until the rollback (`rm -rf /tmp/ideas-hub-measure`).

## Deviations from the plan

- The admin key `~/.ssh/ideashub_admin` has a passphrase and was loaded into the Windows ssh-agent with
  no time limit (the owner's choice; the Windows agent does not accept `ssh-add -t`), not for 4 h.
- No scheduled task collected the data; the owner returned to the session and asked for it.

## For Step 4.1

- Install from Ubuntu's archive: `uidmap`, `rootlesskit`, `slirp4netns`, `xvfb`. Docker's repository is
  not configured, so there is no `docker-ce-rootless-extras`: Ubuntu's `docker.io` ships
  `/usr/share/docker.io/contrib/dockerd-rootless-setuptool.sh`, and Ubuntu's `apparmor` ships the
  `rootlesskit` and `slirp4netns` profiles. The setup tool needs `install --force` because rootful
  Docker stays running for POD Studio.
- Owner-accepted (2026-10-21): `fonts-noto-core` (installed) instead of `fonts-noto`, and `xvfb`
  upgrading the shared data package `xserver-common` to 2:21.1.22-1ubuntu1.3.
- `user-1001.slice`: `MemoryMax=5G CPUQuota=200%` (not set yet).
