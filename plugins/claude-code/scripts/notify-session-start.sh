#!/usr/bin/env bash
# Derived from _shared/notify-session-start.sh.in for Claude Code (load command: /planner load).
# This hook is NON-BLOCKING: it only prints a notification. It does NOT start
# the planner or the web dashboard. The planner stays disabled until the user
# explicitly runs /planner load.
set -euo pipefail
cat <<'EOF'
---
Agent Plan planner available.
The planner is disabled by default. Run /planner load to enable the
planner and start the web dashboard, or /planner web status to check.
---
EOF