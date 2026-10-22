#!/usr/bin/env bash
# Linux side of the trial, part 2 (docs/ops/production.md, step 7). Installs the systemd user units from
# deploy/linux into ~/.config/systemd/user with this checkout's paths filled in, links ideashub-deploy,
# ideashub-backup and ideashub-sizes into ~/.local/bin (so they follow the checkout), enables lingering
# unless it is on already, and enables and
# starts: the Xvfb display, the web app, the worker, the watchdog timer, the auto-deploy timer (phase 2
# plan Step 2a), and the tunnel when ~/.cloudflared/ideas-hub.yml exists. The backup, drill and sizes timers
# are written but stay disabled until phase 2 Step 5, the pilot's acceptance timer until Step 8. Only
# ideashub-* units are written; POD Studio's units and tunnel are never touched. ONLY after the owner's go-ahead, with Windows stopped.
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
need() { command -v "$1" || fail "$1 is not installed (${2:-see docs/ops/production.md})"; }

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

run mkdir -p "$HOME/.local/bin"
for f in ideashub-deploy ideashub-backup ideashub-sizes; do
  run ln -sfn "$repo/scripts/linux/$f" "$HOME/.local/bin/$f"
done
# Root turned lingering on when it created the user (phase 2 plan Step 3); enable-linger as the user
# would need polkit.
if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" = yes ]; then
  echo "note: lingering is already on for $USER"
else
  run loginctl enable-linger "$USER"
fi
run systemctl --user daemon-reload
run systemctl --user enable --now ideashub-xvfb.service ideashub-web.service ideashub-worker.service ideashub-watchdog.timer ideashub-deploy.timer
if [ -f "$HOME/.cloudflared/ideas-hub.yml" ]; then
  [ -x "$cloudflared_bin" ] || fail "cloudflared not found"
  run systemctl --user enable --now ideashub-tunnel.service
else
  echo "note: ~/.cloudflared/ideas-hub.yml not found; tunnel unit installed but not enabled (docs/ops/production.md, \"Tunnel\")"
fi
run systemctl --user --no-pager status ideashub-xvfb.service ideashub-web.service ideashub-worker.service ideashub-watchdog.timer ideashub-deploy.timer
