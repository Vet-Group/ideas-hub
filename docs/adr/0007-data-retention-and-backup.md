# ADR 0007: Data retention, backup and disk Alerts

Status: accepted (2026-10-21), with the phase 2 plan (v5, consensus); the backup destination waits for the owner (D3).
Deciders: owner (through the phase 2 plan).
Inputs: [phase 2 plan](../plans/ideas-hub-phase-2.md) Steps 2b, 2c and 5, ADR 0002 (sightings kept 180
days), ADR 0005.

## Context

Ideas Hub's data grows without an end. On the dev database after one 20-search crawl: about 14.6 KB per
ad row and 146 KB per thumbnail (thumbnails are ~87% of the bytes), about 160 KB per new ad, so 29–295 GB
a year for 500–5,000 new ads a day, before backups. ADR 0002 keeps `ad_sightings` 180 days but no purge
code exists; thumbnails have no retention; Ideas Hub has no backup; the host is shared with POD Studio
production, whose own backups sit on the same disk. Saved ideas and stored briefings keep the
`thumbnailKey` of the ads they show.

## Decision

- **Sightings:** a daily job deletes `ad_sightings` whose `crawl_day` is more than 180 days old, in
  batches; the counts on `ads` stay.
- **Thumbnails:** the same job deletes the thumbnail of an ad not seen for 90 days and clears its
  `thumbnail_key`, except ads referenced by a saved idea's snapshot, which keep both. An ad seen again
  gets a new thumbnail; a stored briefing that showed a pruned ad renders the missing-thumbnail state.
  The stored format does not change now; a smaller stored WebP is measured first and decided after the
  pilot.
- **Backup:** daily at 08:30 Asia/Ho_Chi_Minh (no crawl or briefing then): a `pg_dump -Fc`, a
  `counts.txt` of per-table row counts and the bucket's object count, and the MinIO volume, sent with
  `restic` (client-side encrypted, deduplicated, incremental; a fixed `--host` so snapshots chain and
  `forget` groups them) to a repository **off the host**; 7 daily and 4 weekly snapshots kept. The
  pre-deploy dump stays on the host (last 3). Backup, retention, the drill and deploys share one lock.
- **Restore drill:** after setup and monthly, the latest snapshot is restored into a temporary database
  and a temporary MinIO and compared with its `counts.txt`; any difference fails the drill and Alerts.
- **Sizes and disk:** a daily line of database size, bucket bytes and objects, and disk use; Alerts at
  80% (warning) and 90% (critical) for the filesystem holding Ideas Hub's Docker data and the home
  directory.
- **Ops Alerts:** kinds `retention_failed`, `backup_failed`, `disk_space` (and `deploy_failed`, ADR
  0006), deduplicated per key (date and stage, or filesystem and level), so a warning never hides a
  critical and a test never hides a real Alert; written to `alerts` and posted by the watchdog.
- **Proposed, pending the owner (D3):** Cloudflare R2 on a personal account (10 GB free, then $0.015 per
  GB-month, no egress fee); the restic password in the owner's password manager and a `chmod 600` file
  on the host.

## Alternatives considered

- **Backups on the same disk, as POD Studio does today:** lost with the disk; rejected.
- **Backblaze B2** (about $7/TB-month): as good; R2 is recommended for no egress fee on restores.
- **The development PC as the backup target:** not on 24/7; rejected.
- **`rclone` copies of dump files without restic:** no deduplication of thumbnails between days, and
  encryption set up separately; restic does both.
- **Storing WebP thumbnails now:** unmeasured saving and a change to a path the screenshots and AC 7
  depend on; measured first, decided after the pilot.
- **Alerts deduplicated per kind per day (as `settings_invalid`):** one early Alert would silence a
  later, more serious one the same day; rejected.

## Consequences

- Deleted sightings and thumbnails come back only from a backup, so the retention timer is enabled only
  after the first off-host backup and drill.
- Losing the restic password makes every backup unreadable.
- Off-host storage costs about $0–0.50 a month in the first year at the measured growth.
