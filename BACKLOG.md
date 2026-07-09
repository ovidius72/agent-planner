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
2. Pi write guard:
   - `tool_call` blocks `edit`/`write` when `.planner/` exists, tasks exist, and no task is `in-progress`.
   - `bash` stays free so `git pull`, build, test and inspection commands still work.
3. Claude Code write guard:
   - `agent-plan setup claude-code` installs a `PreToolUse` hook for `Edit|Write`.
   - The hook blocks write tools when `.planner/` exists, tasks exist, and no task is `in-progress`.
4. Temporary bypass, shared across harnesses:
   - `resume.json` now stores `guardBypassUntil`.
   - Pi exposes `/planner bypass`, `/planner clear-bypass`, `plan_authorize_bypass`, `plan_clear_bypass`.
   - MCP exposes `planner-authorize-bypass` and `planner-clear-bypass`.
   - The guard respects the bypass window, so the user can explicitly authorize work without opening a task.
5. Prompt/router reinforcement:
   - Pi context injection shows current focus and tells the agent to call task start/complete.
   - Pi appends a tool-result reminder to call `task_complete` after edit/write work when a task is active.
   - Claude Code `/planner` router maps task lifecycle commands and bypass commands to MCP tools.
6. Lifecycle timestamps:
   - `startedAt` and `completedAt` are maintained by lifecycle tools.

**Remaining validation:**
- Runtime validation in a fresh Pi session.
- Runtime validation in Claude Code that the installed hook blocks `Edit|Write` until `/planner task start <id>` is called, unless bypass is authorized.
- Optional future enhancement: surface a TUI/web warning for stale in-progress tasks.

**Status:** Implemented; pending runtime validation. **No longer blocks:** basic reliable resume / dashboard status correctness once hooks are installed. The remaining work is validation, not design.

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

### [P2-6] Richer task descriptions with code references at creation + evolution at completion
**Reported by:** heca subagent chat (subagent-chat-019f4178)

**Problem:** Task descriptions are too sparse (one-liners) and lack code context. An agent resuming a task sees a paraphrase, not a traceable reference. The codebase evolves, the planner stays stale.

**Requirements:**
1. **At creation**: the agent must include code references (file:line), current state, actual work steps, and behaviors to preserve — not a one-liner. Context must be traceable and verifiable.
2. **At completion**: the agent updates the task/phase description with what was actually done, which files were touched, decisions made, commit hashes, and updated code references (new line numbers).

The planner should be a living traceable source of truth, not a static index of one-liners.

**Acceptance criteria:**
- Task/phase/feature creation tools validate that descriptions are at least 50 characters (prevent one-liners) unless prefixed with 'design-only'.
- Task completion workflow accepts `description_update` parameter that appends post-hoc details to the task description (commit hashes, files touched, decisions, updated code refs).
- Export/render shows enriched descriptions.

**Implemented:**
- MCP: `planner-feature-add`, `planner-phase-add`, `planner-task-add` — description now required with `z.string().min(50)` validation.
- Pi adapter: `feature_create`, `phase_create`, `task_create` — description now required with `Type.String({ minLength: 50 })`.
- MCP: `planner-task-complete` — new optional `description_update` parameter; appends completion summary to task description with separator.
- Pi adapter: `task_complete` — new optional `description_update` parameter; same append logic.
- Tool descriptions and parameter descriptions all updated to guide the agent toward rich, traceable context.

**Status:** Implemented.
Still open from original checklist. Requirements CRUD is in the server but no UI page.
**Status:** Not started.

### [P2-4] README + usage guide maintenance
`README.md` now exists and covers install, setup, CLI, MCP tools, Pi usage and troubleshooting.
It must be kept in sync when new commands/tools are added (e.g. tool count, CLI commands, slash command list).
**Status:** Ongoing (README exists; keep it in sync).

### [P2-5] Web UI: Route restoration after modal close
When opening an edit modal (e.g. for a task), the route changes. When the modal is closed (via cancel or save), the app does not return to the previous route/state, leaving the user on a potentially empty or mismatched page.
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