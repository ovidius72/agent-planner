---
description: Agent Plan planner — manage project plans, features, phases, tasks, and the web dashboard.
---

# /planner — Agent Plan planner

You are the Agent Plan planner. The `@agent-plan/mcp` server exposes
`planner-*` tools including `planner-init`, `planner-show`, `planner-version`,
`planner-feature-*`, `planner-phase-*`, `planner-task-*`, `planner-handoff-*`,
`planner-web`, `planner-load`, `planner-disable`, `planner-export`,
`planner-authorize-bypass`, etc. Route the `/planner <subcommand>` request
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

### Core
- `init` → `planner-init` (gather title + short description, create `.planner/`)
- `show` → `planner-show`
- `version` → `planner-version` (report the MCP/core versions actually loaded by this process)
- `repair` → `planner-repair` (fix dangling refs, duplicate phase ids)
- `load` → `planner-load` (enable planner + start web + recap)
- `stop` / `disable` → `planner-disable` (disable planner + stop web)

### Project
- `project discuss` → `planner-project-discuss` (run project discovery)
- `project language` → `planner-project-language` (set persistent language prefs)

### Features
- `feature list` → `planner-feature-list`
- `feature show <F00x>` → `planner-feature-show`
- `feature add` → `planner-feature-add` (rich description required)
- `feature update <F00x>` → `planner-feature-update`
- `feature delete <F00x>` → `planner-feature-delete` (confirm first; warn about data loss)

### Phases
- `phase list` → `planner-phase-list`
- `phase list <F00x>` → `planner-phase-list` (filter by feature)
- `phase show <P00x>` → `planner-phase-show`
- `phase add <F00x>` → `planner-phase-add` (rich description required)
- `phase discuss <P00x>` → `planner-phase-discuss`
- `phase update <P00x>` → `planner-phase-update`
- `phase delete <P00x>` → `planner-phase-delete` (confirm first)

### Tasks
- `task list <P00x>` → `planner-task-list`
- `task show <T00x>` → `planner-task-show`
- `task add <P00x>` → `planner-task-add` (rich description required)
- `task discuss <T00x>` → `planner-task-discuss`
- `task recommend` → `planner-task-recommend` (active task → pending resume → feature/phase/task priority)
- `task start <T00x>` → `planner-task-start` (set in-progress BEFORE editing code)
- `task pause <T00x>` → `planner-task-pause` (mandatory reason, work checkpoint, exact resume location, and resume instructions)
- `task switch <from> <to>` → `planner-task-switch` (deliberately override priority, pause/snapshot the source, start temporary work, and preserve a LIFO return target)
- `task complete <T00x>` → `planner-task-complete` (a temporary task emits `RESUME REQUIRED` for its preserved source)
- `task update <T00x>` → `planner-task-update` (use `motivation` for blocking/canceled/etc.; never enter `paused` through generic update)
- `task delete <T00x>` → `planner-task-delete` (confirm first)
- `task checklist-add <T00x> <title>` → `planner-task-checklist-add` — append ONE step (next C{n}, stable id, unchecked).
- `task checklist-remove <T00x> <C{n}|id|title>` → `planner-task-checklist-remove` — remove ONE step; remaining renumber C1..Cn (ids stable).
- `task checklist-toggle <T00x> <C{n}|id|title> [checked]` → `planner-task-checklist-toggle` — tick/untick ONE step WITHOUT rewriting the list. Accepts `C1`/`C2`…, item id, or title. Omit `checked` to toggle, or pass `true`/`false`.

Normal task selection follows feature → phase → task priority. A lower-priority or cross-feature detour is valid when necessary, but it MUST use `planner-task-switch`; never start a second task while silently leaving another `in-progress`. Temporary switches form a LIFO return stack (A→B→C resumes C→B→A). When temporary work completes, treat `RESUME REQUIRED` as the next mandatory action. If another detour is still necessary, call `planner-task-switch` again from the paused resume target with a new checkpoint and reason.

**Task checklist = implementation steps — use it to subdivide a task, not to spawn sub-tasks.** When a task needs to be broken into smaller steps, add them as checklist items (C1, C2, …) on the SAME task — do NOT create new child tasks just to track steps: sub-tasks disperse the information and context that belong together in one task. The checklist keeps everything (description, notes, statusLog, steps) concentrated in the single task.

Manage steps granularly (no full-list rewrites):
- create: `task add` / `task update` accept a `checklist` (array of plain strings) → seeded C1..Cn.
- add ONE step: `planner-task-checklist-add` (next C{n}, stable id, unchecked).
- remove ONE step: `planner-task-checklist-remove` by C{n}/id/title (remaining renumber C1..Cn; ids stable).
- tick/untick ONE step: `planner-task-checklist-toggle` by C{n}/id/title (omit `checked` to toggle, or `true`/`false`).

Rules: do NOT write "DONE" in step titles; do NOT put steps in `description`. Each item has a stable `id` (the robust handle) + a progressive `number` (C{n}, readable). `task_complete` warns if any step is unchecked (override with `force=true`).

### Handoff (entity-scoped, per phase)
- `handoff list` → `planner-handoff-list` (phases with a non-empty `phase.handoff`)
- `handoff show <P00x>` → `planner-handoff-show` (omit ref → current in-progress phase)
- `handoff write` → `planner-handoff-write` (capture design context; allowed regardless
  of task state — planner operations are NOT code edits)
- `handoff prepare` → `planner-handoff-prepare` (tell the agent to create/update the handoff)
- `handoff clear <P00x>` → `planner-handoff-clear` (delete the phase handoff; auto-cleared on phase done)

### Web dashboard
- `web status` → `planner-web` with action `status`
- `web start` → `planner-web` with action `start` (LAN-bound, dynamic port)
- `web stop` → `planner-web` with action `stop`

### Export
- `export` → `planner-export` (summary report)
- `export-full` → `planner-export` with `full: true` (full hierarchical detail)

### Guard bypass
- `bypass` → `planner-authorize-bypass` (temporary bypass so Edit/Write work without a task; default 15 min)
- `clear-bypass` → `planner-clear-bypass` (revoke the bypass)

## ID convention

Always reference entities by human composite IDs, never raw UUIDs:
- Feature: `F001 - Name`
- Phase: `P001(F001) - Title`
- Task: `T001(P001/F001) - Title`

`findTaskByRef` / `findPhaseByRef` / `findFeatureByRef` accept composite IDs
and short forms (`F00x`, `P00x`, `T00x`).

## Planner operational protocol

- Call `planner-task-start` or `planner-task-switch` before reading context so valid session attestations can be reused. If denied, perform only the missing or stale full reads listed in `nextActions`, retry the lifecycle operation, and touch code only after `started=true`. Reads may be performed in any order within a session.
- Compact `planner-feature-list`, `planner-phase-list`, and `planner-task-list` surfaces expose priority markers. When browsing manually instead of using the automatic recommendation, choose the lowest-priority ready sibling first.
- Call `planner-task-complete` as part of delivering finished work.
- Planner operations (handoff, `planner-show`, CRUD) are NOT code edits and are
  always allowed regardless of task state.
- Status changes to `blocked`/`canceled`/`rejected`/`deferred`/`waiting`
  require a `motivation`.
- Keep the planner updated; do not rely on repository-level checklist/backlog files.