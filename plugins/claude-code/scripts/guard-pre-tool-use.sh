#!/usr/bin/env sh
# Agent Plan — Claude Code PreToolUse guard (derived from
# plugins/_shared/guard-pre-tool-use.sh.in; do not edit the derived file).
#
# Never blocks and never prompts. When Edit/Write/NotebookEdit or a
# write-shaped Bash changes project code (inside the project, outside
# .planner/) while tasks exist and none is in-progress, it passes a warning
# to the agent. Planner changes (.planner/) and writes outside the project
# (/dev/null, ~/.claude, temp dirs) never warn; an authorized bypass
# silences the warning. Delegates to the agent-plan CLI guard, which reads
# the Claude Code PreToolUse event from stdin and prints the
# hookSpecificOutput JSON on stdout.
exec npx -y agent-plan guard pre-tool-use
