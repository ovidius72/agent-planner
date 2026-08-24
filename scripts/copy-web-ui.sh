#!/usr/bin/env bash
# Copy the Vite production build of the web UI into EVERY harness package that
# serves it. Any package under packages/ that contains a `web-ui-dist/` folder
# is treated as a web-UI consumer — today that is the Pi adapter and the plan
# server, and tomorrow it is any new harness server package (e.g. a Codex
# server) WITHOUT having to edit this script. Each consumer resolves its own
# `web-ui-dist` relative to its package directory, so deploying to every
# `packages/*/web-ui-dist` keeps all supported harnesses in sync from one build.
#
# ONLY the bundled artifacts (index.html + assets/) are copied — not the tsc -b
# declaration/js output that also lands in dist/ (plan-web-ui is a composite
# project, so `tsc -b` emits there too). Consumers serve this folder as a static
# site and never import those files.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SRC="$PROJECT_ROOT/packages/plan-web-ui/dist"

if [ ! -f "$SRC/index.html" ] || [ ! -d "$SRC/assets" ]; then
  echo "Vite build not found at $SRC (expected index.html + assets/)." >&2
  echo "Run 'pnpm build:web-ui' first." >&2
  exit 1
fi

# Discover every packages/<pkg>/web-ui-dist consumer (excludes node_modules).
CONSUMERS="$(find "$PROJECT_ROOT/packages" -type d -name web-ui-dist -not -path '*/node_modules/*' | sort)"
if [ -z "$CONSUMERS" ]; then
  echo "No web-ui-dist consumers found under packages/." >&2
  exit 1
fi

copy_to () {
  local dest="$1"
  rm -rf "$dest"
  mkdir -p "$dest/assets"
  cp "$SRC/index.html" "$dest/index.html"
  cp -r "$SRC/assets/." "$dest/assets/"
}

echo "Copying Vite build from $SRC to web-ui-dist consumers:"
while IFS= read -r dest; do
  [ -z "$dest" ] && continue
  echo "  -> $dest"
  copy_to "$dest"
done <<< "$CONSUMERS"
echo "Done."
