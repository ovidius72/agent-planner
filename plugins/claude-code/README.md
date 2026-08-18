# Agent Plan — Claude Code Plugin

Structured project planning for Claude Code: manage **features**, **phases**,
**tasks**, and a live **web dashboard**, with the planner lifecycle exposed
as MCP tools (`@agent-plan/mcp`) and a `/planner` skill.

## Install (self-hosted marketplace — no approval required)

```
/plugin marketplace add ovidius72/agent-planner
/plugin install agent-plan@agent-plan-marketplace
```

The marketplace file lives at `.claude-plugin/marketplace.json` in the repo
root; this plugin lives at `./plugins/claude-code`.

Updates: push to the repo, then `/plugin marketplace update`.

## Local development / testing

```
claude --plugin-dir ./plugins/claude-code --debug
```

Or add the repo as a local marketplace:

```
/plugin marketplace add ./.
/plugin install agent-plan@agent-plan-marketplace
```

## What it bundles

- **MCP server** (`.mcp.json`): `@agent-plan/mcp` via `npx -y @agent-plan/mcp`,
  exposing the 35 `planner-*` tools.
- **`/planner` skill** (`skills/planner/SKILL.md`): routes `/planner`
  subcommands to the MCP tools.
- **SessionStart hook** (`hooks/hooks.json` → `scripts/notify-session-start.sh`):
  prints a **non-blocking** notification that the planner is available. It does
  NOT start the planner or the web.
- **PreToolUse write guard** (`hooks/hooks.json` → `scripts/guard-pre-tool-use.sh`):
  blocks `Edit`/`Write` when a `.planner/` exists, tasks exist, and no task is
  `in-progress`, unless a temporary bypass is authorized. `bash` stays free so
  `git pull`, build, and test always work. Delegates to
  `agent-plan guard pre-tool-use` (via `npx -y agent-plan`).

## Behavior

- The planner is **disabled by default** at startup. Nothing auto-starts.
- `/planner load` — enable the planner, start the web dashboard (LAN-bound,
  dynamic port), and emit a recap (project status + handoff + Web UI address).
- `/planner stop` (alias `/planner disable`) — disable the planner and stop the
  web dashboard.
- `/planner web status` — print the current Web UI address without starting or
  stopping anything.
- The Web UI address is shown **only** in the `/planner load` recap and via
  `/planner web status` (not appended to every message).
- Planner operations (handoff, plan CRUD) are **not** code edits and are always
  allowed regardless of task state.

## Layout

```
plugins/claude-code/
├── .claude-plugin/plugin.json      # plugin manifest
├── .mcp.json                        # @agent-plan/mcp stdio server
├── skills/planner/SKILL.md          # /planner routing (derived from _shared/)
├── hooks/hooks.json                 # SessionStart notify + PreToolUse write guard
├── scripts/notify-session-start.sh  # derived from _shared/
├── scripts/guard-pre-tool-use.sh    # derived from _shared/ (delegates to agent-plan guard)
└── README.md                        # this file
```

## Plan root

The MCP server resolves the plan root from `AGENT_PLAN_ROOT` or `cwd()/.planner`.
In Claude Code the server runs with the project cwd, so it targets the current
project's `.planner/`.

## Reference

- Shared templates: `plugins/_shared/`
- Marketplace (repo root): `.claude-plugin/marketplace.json`
- Plugin docs: https://code.claude.com/docs/en/plugins