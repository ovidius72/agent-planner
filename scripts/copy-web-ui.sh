#!/usr/bin/env bash
# Copy built web UI artifacts into pi-adapter package so it ships with the dashboard.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SRC="$PROJECT_ROOT/packages/plan-web-ui/dist"
DST="$PROJECT_ROOT/packages/pi-adapter/web-ui-dist"

if [ ! -d "$SRC" ]; then
  echo "Web UI dist not found at $SRC. Run 'pnpm build:web-ui' first."
  exit 1
fi

echo "Copying web UI from $SRC to $DST"
rm -rf "$DST"
cp -r "$SRC" "$DST"
echo "Done. ($(du -sh "$DST" | cut -f1))"
