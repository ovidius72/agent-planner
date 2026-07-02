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

**Why it happened:** Status updates were originally a "soft" expectation in the system prompt.
There was no enforcement and no convenient entry point. The agent had to remember to call
`task_update` with `status=in-progress` / `status=done` on its own.

**Implemented:**
1. Explicit lifecycle commands/tools:
   - Pi: `/planner task start <id>` and `/planner task complete <id>`.
   - MCP/Claude Code: `planner-task-start` and `planner-task-complete`.
   - Direct `task_update` to `in-progress`/`done` is blocked in Pi; use lifecycle tools instead.
2. Pi hard guard:
   - `tool_call` blocks `bash`/`edit`/`write` when `.planner/` exists, tasks exist, and no task is `in-progress`.
3. Claude Code hard guard:
   - `agent-plan setup claude-code` installs a `PreToolUse` hook for `Bash|Edit|Write`.
   - The hook blocks implementation tools when `.planner/` exists, tasks exist, and no task is `in-progress`.
4. Prompt/router reinforcement:
   - Pi context injection shows current focus and tells the agent to call task start/complete.
   - Claude Code `/planner` router maps task lifecycle commands to MCP tools.
5. Lifecycle timestamps:
   - `startedAt` and `completedAt` are maintained by lifecycle tools.

**Remaining validation:**
- Runtime validation in a fresh Pi session.
- Runtime validation in Claude Code that the installed hook blocks `Bash|Edit|Write` until `/planner task start <id>` is called.
- Optional future enhancement: surface a TUI/web warning for stale in-progress tasks.

**Status:** Implemented; pending runtime validation. **No longer blocks:** basic reliable resume / dashboard status correctness once hooks are installed.

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

### [P3-6] Zed editor integration
Integrate Agent Plan with Zed later. Zed supports MCP context servers, so the first integration should be MCP-first and avoid initializing `.planner/` during setup.

**Option A — MCP context server only (recommended first step):**
- Add `agent-plan setup zed`.
- Update Zed user settings, normally `~/.config/zed/settings.json`.
- Merge conservatively into existing JSON:
  ```json
  {
    "context_servers": {
      "agent-plan": {
        "command": "agent-plan",
        "args": ["mcp"],
        "env": {}
      }
    }
  }
  ```
- Support local development mode:
  ```json
  {
    "context_servers": {
      "agent-plan": {
        "command": "node",
        "args": [
          "/Users/antonio/projects/agent-plan/packages/agent-plan/dist/index.js",
          "mcp"
        ],
        "env": {}
      }
    }
  }
  ```
- Proposed CLI flags:
  - `agent-plan setup zed`
  - `agent-plan setup zed --local`
  - `agent-plan setup zed --settings /path/to/settings.json`
  - maybe `--force` to replace existing `context_servers.agent-plan`.
- Setup must not create `.planner/`. Project initialization remains explicit through `agent-plan init` or an MCP `planner-init` call from the Zed Agent Panel.

**Option B — Zed Agent usage instructions:**
- Document prompts such as:
  - “Use `planner-init` to initialize Agent Plan in this project.”
  - “Use Agent Plan to show the current project plan.”
  - “Start task `<id>` with Agent Plan before editing.”
- Mention that Zed models may need explicit references to the `agent-plan` MCP server/tool names.

**Option C — Zed Agent profile:**
- Optionally generate a profile that enables Agent Plan MCP tools and keeps built-in editing/terminal tools under normal confirmation.
- Investigate Zed `agent.profiles` and `agent.tool_permissions.default` to see if a safer Agent Plan profile is useful.

**Option D — Slash-command-like UX via Zed Skills / extension:**
- Later, explore a Zed Skill or Zed extension to provide a `/planner`-like workflow.
- Possible deliverables:
  - packaged MCP server config,
  - prompt/skill named `planner`,
  - user-facing usage docs inside Zed.
- Do not implement this before the simpler MCP setup is validated.

**Option E — Task guard / enforcement:**
- Unlike Claude Code, Zed does not currently provide an obvious equivalent to Claude `PreToolUse` hooks for hard-blocking `terminal`/`edit_file` when no task is `in-progress`.
- Phase 1 should rely on MCP tools, documentation, prompts, and maybe agent profile/tool permissions.
- Hard enforcement would require deeper Zed extension support or another Zed-specific mechanism discovered later.

**Acceptance criteria for first Zed phase:**
- `agent-plan setup zed` safely updates existing Zed settings without destroying unrelated config.
- Zed Agent Panel shows the `agent-plan` MCP server active.
- Zed can call `planner-show` and `planner-task-start` from the MCP server.
- Setup does not create `.planner/`.
- README/docs include Zed setup and current guard limitations.

**Status:** Deferred. Do later.

---

## Done (this session)
- Status rollup auto-sync (`enableAutoSync`/`maybeAutoSync`) + self-heal on open
- Rollup logic fix: `planned` tasks no longer count as active
- Dashboard Work Tree rewrite (filters, persistence, animations, latest completed tasks)
- Task lifecycle timestamps `startedAt`/`completedAt`
- Handoff system (`.planner/HANDOFF.md`, auto hooks, UI page, commands/tools)
- Phase ID modeling fix: feature-scoped ids + migration + integrity validation
- Governance gates on feature/phase `in-progress` (discussedAt OR contextReady+reason)