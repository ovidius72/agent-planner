# Backlog — agent-plan

Single source of truth for outstanding work. Ordered by priority.
Update this file as items move between sections. Keep `CHECKLIST.md` for the running
checklist of the current work session; this file is the durable backlog.

---

## P0 — Blocked / Must fix first

### [P0-1] Agents forget to flip task status at start and end
**Problem:** The agent (LLM) frequently starts working on a task without setting it to
`in-progress`, and finishes work without setting it to `done`. Status rollup now derives
phase/feature status from tasks automatically, but if the leaf task status is never
updated the whole tree stays stale. This breaks the Work Tree, the header active tasks,
the resume focus, and the latest-completed-tasks view.

**Why it happens:** Today status updates are a "soft" expectation in the system prompt.
There is no enforcement and no convenient entry point. The agent has to remember to call
`task_update` with `status=in-progress` / `status=done` on its own.

**Fix direction (pick / combine):**
1. Add explicit, obvious commands/tools:
   - `/planner task start <id>` → sets `in-progress` (and checks phase/feature governance)
   - `/planner task complete <id>` → sets `done` (and checks checklist completion)
   - equivalent tools `task_start` / `task_complete`
2. Enforce in the pre-flight protocol: before doing implementation work on a task, the
   agent MUST have marked that task `in-progress` (gate the work, not just remind).
3. Strengthen the system-prompt injection so the current in-progress task is shown and
   the agent is told "when you finish this, call task_complete".
4. Surface a TUI/web warning when a task has `startedAt` set but no status change for a
   long time (stale in-progress).

**Status:** Not started. **Blocks:** reliable resume, accurate dashboard.

---

## P1 — After restart validation

### [P1-1] Runtime validation of this session's work
Full Pi restart required, then tester checks in `/Users/antonio/projects/agent-plan-test2`:
- A. status rollup coherence
- B. phase ID migration visible (feature-scoped ids)
- C. handoff auto-write/read + header button + `/handoff` page
- D. `/planner handoff prepare` instructs agent correctly
**Status:** Blocked on full Pi restart.

### [P1-2] `feature discuss` flow
Governance metadata (`discussedAt`/`contextReady`) and the hard gate exist, but there is
no interactive `planner feature discuss` command (only phase/task). Needed so the agent can
mark a feature as discussed and satisfy the governance gate for `in-progress`.
**Status:** Not started.

---

## P2 — Functionality gaps

### [P2-1] UI `/handoff` delete button
The handoff page shows the file but cannot delete it from the browser.
**Status:** Not started.

### [P2-2] Cleanup orphan phases command
Phases on disk that are not referenced by any feature (orphans) have no cleanup path.
Add `/planner phase cleanup-orphans` (with confirmation) and/or a server endpoint.
**Status:** Not started.

### [P2-3] Web UI: requirements page
Still open from original checklist. Requirements CRUD is in the server but no UI page.
**Status:** Not started.

### [P2-4] README + usage guide
No end-user documentation yet.
**Status:** Not started.

---

## P3 — Tech debt / quality

### [P3-1] Align CHECKLIST.md to reality
`CHECKLIST.md` is stale: references `plan-web-v2` (superseded by `plan-web-ui`), does not
mention handoff, governance gates, phase ID migration, or the Work Tree rewrite.
**Status:** Not started.

### [P3-2] Legacy Italian workflow rules in existing .planner data
Existing `project.json` files (e.g. `agent-plan-test2`) still contain meaningless default
Italian workflow rules ("Obiettivo chiaro", "Dipendenze note", ...). Migrate/clean.
**Status:** Not started.

### [P3-3] `readJson` / `PlanStoreError` diagnostics
Currently surfaces only `read failed: <path>` without the schema validation cause.
Include the underlying Zod error so corruption is diagnosable.
**Status:** Not started.

### [P3-4] Short description editor
`project discuss` no longer asks for the short description. Decide whether the web UI
needs an explicit editor for `project.description`.
**Status:** Not started.

### [P3-5] Roadmap Fase 7 — multi-harness
`CLAUDE.md` / `CODEX.md` adapter docs + public JSON schema for `.planner/`.
**Status:** Not started (Fase 6 gates partly done).

---

## Done (this session)
- Status rollup auto-sync (`enableAutoSync`/`maybeAutoSync`) + self-heal on open
- Rollup logic fix: `planned` tasks no longer count as active
- Dashboard Work Tree rewrite (filters, persistence, animations, latest completed tasks)
- Task lifecycle timestamps `startedAt`/`completedAt`
- Handoff system (`.planner/HANDOFF.md`, auto hooks, UI page, commands/tools)
- Phase ID modeling fix: feature-scoped ids + migration + integrity validation
- Governance gates on feature/phase `in-progress` (discussedAt OR contextReady+reason)