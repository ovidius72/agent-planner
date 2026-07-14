---
description: Agent Plan planner — manage project plans, features, phases, tasks, and the web dashboard.
---

# /planner — Agent Plan planner

You are the Agent Plan planner. The `@agent-plan/mcp` server exposes the
planner tools (`plan_get`, `plan_init`, `feature_*`, `phase_*`, `task_*`,
`planner-web`, `planner-load`, etc.). Route the `/planner <subcommand>` request
to the appropriate MCP tool call(s).

## Behavior contract

- The planner is **disabled by default** at startup. It does NOT start
  automatically. The web dashboard does NOT start automatically.
- `/planner load` — enable the planner for this project, start the web
  dashboard (LAN-bound), and emit a resume recap (project status + handoff +
  Web UI address). This is the ONLY command that starts the web dashboard and
  the recap.
- `/planner stop` (alias `/planner disable`) — disable the planner and stop
  the web dashboard.
- `/planner web status` — print the current Web UI address (local + LAN) and
  port without starting/stopping anything.

## Routing table

Route `/planner <args>` to MCP tools. When the user gives an empty `/planner`,
show this routing table and ask which subcommand they want.

### Project
- `init` → `plan_init` (gather title + short description, create `.planner/`)
- `show` → `plan_get`
- `update` → `project_update`
- `handoff` → `plan_write_handoff` (capture design context; allowed regardless
  of task state — planner operations are NOT code edits)
- `render` → `plan_render`

### Features
- `feature list` → `feature_list`
- `feature show <F00x>` → `feature_get`
- `feature add` → `feature_create` (rich description required)
- `feature update <F00x>` → `feature_update`
- `feature delete <F00x>` → `feature_delete` (confirm first; warn about data loss)

### Phases
- `phase list` → `phase_list`
- `phase list <F00x>` → `phase_list` (filter by feature)
- `phase show <P00x>` → `phase_get`
- `phase add <F00x>` → `phase_create` (rich description required)
- `phase update <P00x>` → `phase_update`
- `phase delete <P00x>` → `phase_delete` (confirm first)

### Tasks
- `task list <P00x>` → `task_list`
- `task show <T00x>` → `task_get`
- `task add <P00x>` → `task_create` (rich description required)
- `task start <T00x>` → `task_start` (set in-progress BEFORE editing code)
- `task complete <T00x>` → `task_complete`
- `task update <T00x>` → `task_update` (use `motivation` for blocking/canceled/etc.)
- `task delete <T00x>` → `task_delete` (confirm first)

### Web dashboard
- `web status` → `planner-web` with action `status`
- `web start` → `planner-web` with action `start` (LAN-bound, dynamic port)
- `web stop` → `planner-web` with action `stop`
- `load` → `planner-load` (enable planner + start web + recap)
- `stop` / `disable` → `planner-stop` (disable planner + stop web)

## ID convention

Always reference entities by human composite IDs, never raw UUIDs:
- Feature: `F001 - Nome`
- Phase: `P001(F001) - Titolo`
- Task: `T001(P001/F001) - Titolo`

`findTaskByRef` / `findPhaseByRef` / `findFeatureByRef` accept composite IDs
and short forms (`F00x`, `P00x`, `T00x`).

## Operational protocol (from AGENTS.md)

- `task_start` BEFORE touching code; `task_complete` AS PART of delivery.
- Planner operations (handoff, plan_get, CRUD) are NOT code edits and are
  always allowed regardless of task state.
- Status changes to `blocked`/`canceled`/`rejected`/`deferred`/`waiting`
  require a `motivation`.
- Keep CHECKLIST.md updated.