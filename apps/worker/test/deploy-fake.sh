#!/usr/bin/env bash
# One fake for every host command the ops scripts (deploy, retention, backup, sizes) call
# (apps/worker/test/ops-host.ts copies it under each command's name). It appends its call to
# $FAKE/calls.log and answers from FAKE_* variables and files in $FAKE; unit states live in
# $FAKE/units/<unit>; $FAKE/rows ("<table> <n>" lines) is the database (row counts, and the COPY blocks of
# `pg_restore --data-only`). With FAKE_PG_EXEC set, the Postgres tools run
# for real through that prefix (`docker exec -i <container>`), on the test database $FAKE_DB.
name="$(basename "$0")"
printf '%s %s\n' "$name" "$*" >> "$FAKE/calls.log"

# The real command, with the fakes off PATH.
real() {
  PATH="$(printf %s "$PATH" | tr ':' '\n' | grep -vxF "$(dirname "$0")" | paste -sd: -)"
  exec "$@"
}

if [ -n "${FAKE_PG_EXEC:-}" ] && [[ " psql pg_dump pg_restore dropdb createdb " == *" $name "* ]]; then
  out=()
  prev=""
  for a in "$@"; do
    # The database name `ideashub` becomes the test database; the role `ideashub` (-U, -O) stays.
    if [ "$a" = ideashub ] && [ "$prev" != -U ] && [ "$prev" != -O ]; then a="$FAKE_DB"; fi
    out+=("${a//database ideashub/database $FAKE_DB}")
    prev="$a"
  done
  # shellcheck disable=SC2086 # a command prefix
  real $FAKE_PG_EXEC "$name" "${out[@]}"
fi

case "$name" in
  gh)
    if [ -n "${FAKE_GH_ERR:-}" ]; then echo "$FAKE_GH_ERR" >&2; exit 1; fi
    echo "${FAKE_GH:-completed success}" ;;
  pgrep) exit "${FAKE_PGREP:-1}" ;;
  sleep) ;;
  flock) exit "${FAKE_FLOCK_RC:-0}" ;;
  date) if [ "$*" = +%u ] && [ -n "${FAKE_WEEKDAY:-}" ]; then echo "$FAKE_WEEKDAY"; else real date "$@"; fi ;;
  df)
    # `df -P PATH`: under $HOME is /home at FAKE_DF_HOME %, anything else / at FAKE_DF_ROOT %.
    p="${!#}"
    if [[ "$p" == "$HOME"* ]]; then mnt=/home pct="${FAKE_DF_HOME:-50}"; else mnt=/ pct="${FAKE_DF_ROOT:-50}"; fi
    printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\nfake 100 %s %s %s%% %s\n' "$pct" "$((100 - pct))" "$pct" "$mnt" ;;
  curl) [ "${FAKE_HEALTH:-200}" = 200 ] || exit 22 ;;
  systemctl)
    shift # --user
    verb="$1"
    shift
    [ "${1:-}" = --quiet ] && shift
    [ "${1:-}" = --now ] && shift
    case "$verb" in
      is-active) [ "$(cat "$FAKE/units/$1" 2>/dev/null || echo active)" = active ] ;;
      start) for u; do echo active > "$FAKE/units/$u"; done ;;
      stop) for u; do echo inactive > "$FAKE/units/$u"; done ;;
      disable) for u; do echo disabled > "$FAKE/units/$u"; done ;;
      show) printf 'MemoryPeak=%s\nCPUUsageNSec=%s\n' "${FAKE_PEAK:-1048576}" "${FAKE_CPU_NS:-5000000000}" ;;
    esac ;;
  docker)
    # `compose ... exec -T postgres CMD...` runs CMD (a fake, or the real tool above); `up` succeeds.
    args=("$@")
    for i in "${!args[@]}"; do
      if [ "${args[i]}" = postgres ] && [ "$i" -gt 0 ] && [ "${args[i - 1]}" = -T ]; then exec "${args[@]:i+1}"; fi
      # `run ... restic/restic... SUBCOMMAND ...`; FAKE_RESTIC_FAIL names a subcommand that fails.
      if [[ "${args[i]}" == restic/restic* ]]; then
        sub="${args[i + 1]}"
        if [ "$sub" = "${FAKE_RESTIC_FAIL:-}" ]; then echo "Fatal: $sub failed (fake)" >&2; exit 1; fi
        case "$sub" in
          snapshots) if [ -n "${FAKE_NO_SNAPSHOT:-}" ]; then echo '[]'; else echo '[{"time":"2026-10-21T01:30:00Z","id":"5ca1ab1e00","short_id":"5ca1ab1e"}]'; fi ;;
          dump) case "${args[${#args[@]} - 1]}" in */counts.txt) cat "$FAKE/counts.txt" ;; *) echo dump ;; esac ;;
        esac
        exit 0
      fi
    done
    case "$1" in
      info) echo "${FAKE_DOCKER_ROOT:-/srv/docker}"; exit 0 ;;
      exec)
        # `exec CONTAINER sh -c SCRIPT mc ARGS`: mc inside a MinIO container; `ls` lists FAKE_OBJECTS
        # objects of 100 bytes (FAKE_DRILL_OBJECTS in the drill's MinIO).
        n="${FAKE_OBJECTS:-2}"
        [[ "$2" == *drill* ]] && n="${FAKE_DRILL_OBJECTS:-$n}"
        if [[ " $* " == *" ls "* ]]; then
          for ((k = 0; k < n; k++)); do printf '{"status":"success","type":"file","size":100,"key":"thumbs/%s.jpg"}\n' "$k"; done
        fi
        exit 0 ;;
    esac
    if [[ " $* " == *" ps -q minio "* ]]; then echo ideas-hub-minio-1; exit 0; fi
    exit "${FAKE_COMPOSE_RC:-0}" ;;
  pnpm)
    head="$(git rev-parse HEAD)"
    case "$*" in
      "--silent ops:quiet")
        # $FAKE/quiet: one line per call; empty or `quiet` = quiet, `down` = no database, else the reason.
        n=$(($(cat "$FAKE/quiet.n" 2>/dev/null || echo 0) + 1))
        echo "$n" > "$FAKE/quiet.n"
        reason="$(sed -n "${n}p" "$FAKE/quiet" 2>/dev/null)"
        if [ -z "$reason" ] || [ "$reason" = quiet ]; then exit 0; fi
        if [ "$reason" = down ]; then echo "connect ECONNREFUSED 127.0.0.1:5433" >&2; exit 1; fi
        echo "$reason"
        exit 10 ;;
      "--silent lark:post") cat > "$FAKE/lark.txt" ;;
      "--silent retention") exit "${FAKE_RETENTION_RC:-0}" ;;
      "--silent ro-query")
        cat > "$FAKE/ro.sql"
        if [ -n "${FAKE_RO_ERR:-}" ]; then echo "$FAKE_RO_ERR" >&2; exit 1; fi
        cat "$FAKE/ro.csv" ;;
      "--filter @ideas-hub/web build") [ "$head" != "${FAKE_BUILD_FAIL:-}" ] || exit 1 ;;
      db:migrate)
        [ "$head" != "${FAKE_MIGRATE_FAIL:-}" ] || exit 1
        if [ -n "${FAKE_MIGRATE_HELPER:-}" ]; then node "$FAKE_MIGRATE_HELPER" "$PWD/packages/db/migrations"; fi ;;
    esac ;;
  psql)
    case "$*" in
      *heartbeat_at*) echo "${FAKE_HEARTBEAT:-1}" ;;
      *pg_database_size*) [ -z "${FAKE_DB_DOWN:-}" ] || exit 2; echo "${FAKE_DB_BYTES:-123456}" ;;
      *"select count(*) from "*) q="$*"; awk -v t="${q##* }" '$1 == t { print $2; f = 1 } END { if (!f) print 0 }' "$FAKE/rows" ;;
    esac ;;
  pg_dump) echo "dump of $(git rev-parse HEAD 2>/dev/null)"; exit "${FAKE_DUMP_RC:-0}" ;;
  pg_restore)
    cat > /dev/null
    if [[ " $* " == *" --data-only "* ]]; then
      awk '{ print "COPY " $1 " (id) FROM stdin;"; for (k = 0; k < $2; k++) print k; print "\\." }' "$FAKE/rows"
    fi
    exit "${FAKE_RESTORE_RC:-0}" ;;
esac
