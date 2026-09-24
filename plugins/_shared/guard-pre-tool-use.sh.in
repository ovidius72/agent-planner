#!/usr/bin/env sh
# Agent Plan — Claude Code PreToolUse guard (derived from
# plugins/_shared/guard-pre-tool-use.sh.in; do not edit the derived file).
#
# Asks before Edit/Write/NotebookEdit/write-shaped Bash outside .planner/ when
# a .planner/ exists, tasks exist, and no task is in-progress, unless the user
# authorized a temporary bypass. Anything inside .planner/ is always allowed
# (writing a handoff or task state must never be blocked). Read-only commands
# (git pull, build, test, ls, grep, find, ...) stay free. Delegates the
# decision to the agent-plan CLI guard, which reads the Claude Code
# PreToolUse event from stdin and emits the hookSpecificOutput JSON on
# stdout.
exec npx -y agent-plan guard pre-tool-use
