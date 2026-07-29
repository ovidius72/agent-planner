#!/usr/bin/env sh
# Agent Plan — Claude Code PreToolUse guard (derived from
# plugins/_shared/guard-pre-tool-use.sh.in; do not edit the derived file).
#
# Blocks Edit/Write when a .planner/ exists, tasks exist, and no task is
# in-progress, unless the user authorized a temporary bypass. Bash stays free
# (git pull, build, test, search always work). Delegates the decision to the
# agent-plan CLI guard, which reads the Claude Code PreToolUse event from
# stdin and emits the hookSpecificOutput JSON on stdout.
exec npx -y agent-plan guard pre-tool-use