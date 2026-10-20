#!/usr/bin/env bash
# Linux side of the trial, part 2 (docs/ops/linux-trial.md, step 7). Installs the systemd user units from
# deploy/linux into ~/.config/systemd/user with this checkout's paths filled in, enables lingering so they
# run without a login, and enables and starts: the Xvfb display, the web app, the worker, the watchdog
# timer, and the tunnel when ~/.cloudflared/ideas-hub.yml exists. Only ideashub-* units are written; POD
# Studio's units and tunnel are never touched. ONLY after the owner's go-ahead, with Windows stopped.
#   scripts/linux/install-units.sh [--dry-run]
# --dry-run prints the filled-in units and every command instead of running them.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
dry=0
case "${1:-}" in
  --dry-run) dry=1 ;;
  "") ;;
  *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;;
esac

run() {
  if [ "$dry" = 1 ]; then printf '[dry-run] %s\n' "$*"; else printf '==> %s\n' "$*"; "$@"; fi
}
fail() { echo "error: $*" >&2; exit 1; }
need() { command -v "$1" || fail "$1 is not installed (${2:-see docs/ops/linux-trial.md})"; }

pnpm_bin="$(need pnpm)"
node_bin="$(need node)"
xvfb_bin="$(need Xvfb 'sudo apt install xvfb')"
cloudflared_bin="$(command -v cloudflared || echo /usr/bin/cloudflared)"
# systemd user units get a minimal PATH; give them the directories of node and pnpm.
unit_path="$(dirname "$node_bin"):$(dirname "$pnpm_bin"):/usr/local/bin:/usr/bin:/bin"
dest="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

[ -f "$repo/.env" ] || fail ".env missing at $repo/.env"
[ -d "$repo/apps/web/.next" ] || [ "$dry" = 1 ] || fail "web app not built; run scripts/linux/restore.sh first"

run mkdir -p "$dest"
for src in "$repo"/deploy/linux/ideashub-*.service "$repo"/deploy/linux/ideashub-*.timer; do
  name="$(basename "$src")"
  filled="$(sed -e "s|@REPO@|$repo|g" -e "s|@PNPM@|$pnpm_bin|g" -e "s|@PATH@|$unit_path|g" \
    -e "s|@XVFB@|$xvfb_bin|g" -e "s|@CLOUDFLARED@|$cloudflared_bin|g" "$src")"
  if [ "$dry" = 1 ]; then
    printf '[dry-run] write %s/%s:\n%s\n\n' "$dest" "$name" "$filled"
  else
    printf '%s\n' "$filled" > "$dest/$name"
    echo "==> wrote $dest/$name"
  fi
done

run loginctl enable-linger "$USER"
run systemctl --user daemon-reload
run systemctl --user enable --now ideashub-xvfb.service ideashub-web.service ideashub-worker.service ideashub-watchdog.timer
if [ -f "$HOME/.cloudflared/ideas-hub.yml" ]; then
  [ -x "$cloudflared_bin" ] || fail "cloudflared not found"
  run systemctl --user enable --now ideashub-tunnel.service
else
  echo "note: ~/.cloudflared/ideas-hub.yml not found; tunnel unit installed but not enabled (docs/ops/linux-trial.md, \"Tunnel\")"
fi
run systemctl --user --no-pager status ideashub-xvfb.service ideashub-web.service ideashub-worker.service ideashub-watchdog.timer
