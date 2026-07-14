#!/usr/bin/env bash
# Copy the Vite production build of the web UI into the pi-adapter package so
# it ships with the dashboard. ONLY the bundled artifacts (index.html + assets/)
# are copied — not the tsc -b declaration/js output that also lands in dist/
# (plan-web-ui is a composite project, so `tsc -b` emits there too). The
# pi-adapter serves this folder as a static site and never imports those files.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SRC="$PROJECT_ROOT/packages/plan-web-ui/dist"
DST="$PROJECT_ROOT/packages/pi-adapter/web-ui-dist"
DST2="$PROJECT_ROOT/packages/plan-server/web-ui-dist"

if [ ! -f "$SRC/index.html" ] || [ ! -d "$SRC/assets" ]; then
  echo "Vite build not found at $SRC (expected index.html + assets/)." >&2
  echo "Run 'pnpm build:web-ui' first." >&2
  exit 1
fi

copy_to () {
  local dest="$1"
  rm -rf "$dest"
  mkdir -p "$dest/assets"
  cp "$SRC/index.html" "$dest/index.html"
  cp -r "$SRC/assets/." "$dest/assets/"
}
echo "Copying Vite build from $SRC to $DST and $DST2"
copy_to "$DST"
copy_to "$DST2"
echo "Done. ($DST: $(du -sh "$DST" | cut -f1); $DST2: $(du -sh "$DST2" | cut -f1))"
