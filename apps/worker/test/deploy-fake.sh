#!/usr/bin/env bash
# One fake for every host command ideashub-deploy and ideashub-retention call (apps/worker/test/
# deploy.test.ts copies it under each command's name). It appends its call to $FAKE/calls.log and answers
# from FAKE_* variables and files in $FAKE; unit states live in $FAKE/units/<unit>. With FAKE_PG_EXEC set, the Postgres tools run
# for real through that prefix (`docker exec -i <container>`), on the test database $FAKE_DB.
name="$(basename "$0")"
printf '%s %s\n' "$name" "$*" >> "$FAKE/calls.log"

if [ -n "${FAKE_PG_EXEC:-}" ] && [[ " psql pg_dump pg_restore dropdb createdb " == *" $name "* ]]; then
  out=()
  prev=""
  for a in "$@"; do
    # The database name `ideashub` becomes the test database; the role `ideashub` (-U, -O) stays.
    if [ "$a" = ideashub ] && [ "$prev" != -U ] && [ "$prev" != -O ]; then a="$FAKE_DB"; fi
    out+=("${a//database ideashub/database $FAKE_DB}")
    prev="$a"
  done
  PATH="$(printf %s "$PATH" | tr ':' '\n' | grep -vxF "$(dirname "$0")" | paste -sd: -)"
  # shellcheck disable=SC2086 # a command prefix
  exec $FAKE_PG_EXEC "$name" "${out[@]}"
fi

case "$name" in
  gh)
    if [ -n "${FAKE_GH_ERR:-}" ]; then echo "$FAKE_GH_ERR" >&2; exit 1; fi
    echo "${FAKE_GH:-completed success}" ;;
  pgrep) exit "${FAKE_PGREP:-1}" ;;
  sleep) ;;
  flock) exit "${FAKE_FLOCK_RC:-0}" ;;
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
    esac ;;
  docker)
    # `compose ... exec -T postgres CMD...` runs CMD (a fake, or the real tool above); `up` succeeds.
    args=("$@")
    for i in "${!args[@]}"; do
      if [ "${args[i]}" = postgres ] && [ "$i" -gt 0 ] && [ "${args[i - 1]}" = -T ]; then exec "${args[@]:i+1}"; fi
    done
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
      "--filter @ideas-hub/web build") [ "$head" != "${FAKE_BUILD_FAIL:-}" ] || exit 1 ;;
      db:migrate)
        [ "$head" != "${FAKE_MIGRATE_FAIL:-}" ] || exit 1
        if [ -n "${FAKE_MIGRATE_HELPER:-}" ]; then node "$FAKE_MIGRATE_HELPER" "$PWD/packages/db/migrations"; fi ;;
    esac ;;
  psql) case "$*" in *crawler_state*) echo "${FAKE_HEARTBEAT:-1}" ;; esac ;;
  pg_dump) echo "dump of $(git rev-parse HEAD)"; exit "${FAKE_DUMP_RC:-0}" ;;
  pg_restore) cat > /dev/null; exit "${FAKE_RESTORE_RC:-0}" ;;
esac
