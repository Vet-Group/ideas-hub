#!/usr/bin/env bash
# Linux side of the trial, part 1 (docs/ops/production.md, steps 4–6). Run on the Linux desktop from the
# Ideas Hub checkout, ONLY after the owner's go-ahead and after dump-windows.ps1 has stopped Windows.
#   scripts/linux/restore.sh [--dry-run] [--transfer DIR]
# Checks that Ideas Hub's ports are free and that no ideas-hub compose volume exists yet, verifies the
# manifest's SHA-256 sums, starts Ideas Hub's own compose project (`ideas-hub`, Postgres 127.0.0.1:5433,
# MinIO 127.0.0.1:9300/9301), restores the dump into its own `ideashub` database and the MinIO tar into its
# own volume, installs, migrates and builds, and compares row counts with the manifest. It never touches
# POD Studio's containers, volumes or database. --dry-run prints each command instead of running it.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
transfer="$repo/transfer"
dry=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry=1 ;;
    --transfer) transfer="$2"; shift ;;
    *) echo "usage: $0 [--dry-run] [--transfer DIR]" >&2; exit 2 ;;
  esac
  shift
done

run() {
  if [ "$dry" = 1 ]; then printf '[dry-run] %s\n' "$*"; else printf '==> %s\n' "$*"; "$@"; fi
}
fail() { echo "error: $*" >&2; exit 1; }

cd "$repo"
compose=(docker compose -p ideas-hub -f "$repo/docker-compose.yml")

echo "== preflight (runs in --dry-run too: read-only)"
for c in docker node pnpm sha256sum ss; do command -v "$c" >/dev/null || fail "$c is not installed"; done
[ -f "$repo/.env" ] || fail ".env missing at $repo/.env (copy it from Windows, then set APP_URL and DATABASE_URL)"
grep -q '^APP_URL=https://' "$repo/.env" || echo "warning: APP_URL in .env is not an https:// tunnel URL yet"
for port in 3300 5433 9300 9301; do
  if ss -ltnH "sport = :$port" | grep -q .; then fail "port $port is in use (POD Studio?); pick another, see docs/ops/production.md"; fi
done
if docker volume ls -q --filter label=com.docker.compose.project=ideas-hub | grep -q .; then
  fail "ideas-hub compose volumes already exist; this script restores into a fresh project only"
fi
for f in ideashub.dump minio-data.tgz manifest.txt; do [ -f "$transfer/$f" ] || fail "$transfer/$f missing"; done
# manifest lines: "sha256 <hex> <file> <bytes>"
(cd "$transfer" && tr -d '\r' < manifest.txt | awk '$1 == "sha256" { print $2 "  " $3 }' | sha256sum -c -) || fail "checksum mismatch"

echo "== Postgres: own project and database"
run "${compose[@]}" up -d --wait postgres
# A production dump GRANTs to the read-only role, and pg_restore --exit-on-error stops on a missing role, so a
# fresh database gets it first, NOLOGIN; its password and limits come back after the restore (the Next lines).
run "${compose[@]}" exec -T postgres psql -U ideashub -d ideashub -v ON_ERROR_STOP=1 -c \
  "do \$\$ begin if not exists (select from pg_roles where rolname = 'ideashub_ro') then create role ideashub_ro nologin; end if; end \$\$"
run "${compose[@]}" cp "$transfer/ideashub.dump" postgres:/tmp/ideashub.dump
run "${compose[@]}" exec -T postgres pg_restore -U ideashub -d ideashub --no-owner --exit-on-error /tmp/ideashub.dump
run "${compose[@]}" exec -T postgres rm -f /tmp/ideashub.dump

echo "== MinIO: own volume"
run "${compose[@]}" create minio
volume="ideas-hub_minio-data"
run docker run --rm -v "$volume:/data" -v "$transfer:/backup:ro" postgres:16-alpine tar xzf /backup/minio-data.tgz -C /data
run "${compose[@]}" up -d --wait minio

echo "== install, migrate (a no-op at the same commit), build the web app"
run pnpm install --frozen-lockfile
run pnpm db:migrate
run pnpm --filter @ideas-hub/web build

echo "== row counts: manifest vs restored"
diffs=0
# Process substitution, not a pipe: the loop runs in this shell, so `diffs` survives it.
while read -r table expected; do
  if [ "$dry" = 1 ]; then echo "[dry-run] compare $table (manifest: $expected)"; continue; fi
  # < /dev/null: `exec -T` would otherwise read the rest of the manifest and end the loop after one table.
  got="$("${compose[@]}" exec -T postgres psql -U ideashub -d ideashub -At -c "select count(*) from $table" < /dev/null)"
  if [ "$got" = "$expected" ]; then
    echo "ok   $table $got"
  else
    echo "DIFF $table restored $got, manifest $expected"
    diffs=$((diffs + 1))
  fi
done < <(tr -d '\r' < "$transfer/manifest.txt" | awk '$1 == "rows" { print $2, $3 }')
[ "$diffs" = 0 ] || fail "$diffs table(s) differ from the manifest"
echo "Next: give ideashub_ro back its login (the password in ~/.config/ideas-hub/ro.env's RO_DATABASE_URL):"
echo "  alter role ideashub_ro login password '<password>' connection limit 2;"
echo "  alter role ideashub_ro set statement_timeout = '60s'; alter role ideashub_ro set default_transaction_read_only = on;"
echo "Then: scripts/linux/install-units.sh (docs/ops/production.md, step 7)."
