# Multi-Agent Strategy: porting agent-plan to Claude Code, Codex, OpenClaude, Hermes

> Status: proposal — 2026-07-01
> Owner: agent-plan platform
> Goal: make the planner usable from multiple AI coding agents, not only Pi.

## 1. Executive summary

agent-plan is currently bound to Pi via `pi-adapter`. The good news: **~90% of the value is already portable** (`plan-core`, `plan-server`, `plan-web-ui` have zero Pi dependencies). The only Pi-specific coupling lives in `pi-adapter`.

The broader target agents (**Claude Code, Codex, OpenClaude, Hermes**) all support **MCP (Model Context Protocol)** as the shared standard for exposing external tools. The recommended long-term path is therefore not to write four separate adapters, but to expose agent-plan's tools behind **a single MCP server** and point each client at it.

However, the first implementation phase is intentionally narrower: **Claude Code only**. This lets us validate naming, lifecycle hooks, and MCP ergonomics before committing to other hosts.

- **MCP** = portable tool/data integrations across hosts and vendors.
- **Agent-specific hooks** = deep, host-native lifecycle behavior (gating, guardrails, startup summaries).

We use MCP for the tool surface, and a thin per-host shim for the lifecycle behaviors Pi currently owns.

## 2. Target agent landscape

| Agent | Tool extension | Lifecycle extension | Config location |
|---|---|---|---|
| **Claude Code** | MCP servers | Hooks: `PreToolUse`, `PostToolUse`, `SessionStart`, etc. | project `.mcp.json` for MCP servers; settings/hooks in Claude config |
| **Codex (OpenAI)** | MCP servers | `AGENTS.md` instructions (no native hooks) | MCP config + `AGENTS.md` |
| **OpenClaude** | MCP + web tools | Agent/workflow config | project README / config |
| **Hermes** | MCP + configurable toolsets (`"web,terminal,skills"`) | CLI/TUI toolset config | `hermes` CLI config |

Key takeaway: **MCP is the common denominator.** Every target agent can consume the same MCP server; only the lifecycle/governance layer differs per host.

## 3. Current architecture vs target

### Today
```
Pi runtime
  └─ pi-adapter (ExtensionAPI)
       ├─ ctx.ui.notify / ctx.ui.input
       ├─ pi.on("session_start" | "tool_call" | "message_end")
       ├─ pi.sendMessage / pi.appendEntry
       └─ calls PlanStore directly (plan-core)
plan-core   → schema, PlanStore, renderer        (portable)
plan-server → HTTP + WebSocket                   (portable)
plan-web-ui → React dashboard                    (portable)
```

### Target
```
                 ┌─────────────────────────────────┐
                 │  packages/plan-mcp               │  ← new
                 │  MCP server (tools via MCP SDK)  │
                 └──────────────┬──────────────────┘
                                │ same MCP server
       ┌────────────┬───────────┼───────────┬────────────┐
       ▼            ▼           ▼           ▼            ▼
   Claude Code   Codex    OpenClaude    Hermes      Pi (thin adapter)
   (MCP client)  (MCP)    (MCP)         (MCP)       (pi-adapter → MCP)
```

Three layers:
1. **Portable core** (already exists): `plan-core` + `plan-server` + `plan-web-ui`.
2. **MCP server** (new): `packages/plan-mcp` registers each planner tool via `server.registerTool(name, config, handler)`. Transport: stdio (local CLI agents) + optional SSE/HTTP.
3. **Thin per-host shims**:
   - **Pi**: `pi-adapter` becomes a thin wrapper that starts the MCP server in-process and adds only Pi-unique behavior (gating, startup summary, guardrail, `ctx.ui.notify`).
   - **Claude Code**: hooks for guardrails; MCP config for tools.
   - **Codex**: `AGENTS.md` for workflow rules; MCP config for tools.
   - **OpenClaude / Hermes**: toolset/MCP config.

## 4. What is Pi-specific vs portable

| Capability | Pi-specific | Portable via MCP |
|---|---|---|
| `task_create`, `feature_create`, `phase_create`, `plan_render`, `task_start`, `task_complete` | no | yes (MCP tools) |
| Governance (`contextReady`, governance checks) | no | yes (logic in core) |
| Status rollup (`syncTaskStatusRollup`) | no | yes (in core) |
| Live WebSocket UI | no | yes (plan-server) |
| Atomic persistence + busy signaling | no | yes (plan-core + plan-server) |
| Gating "Enable planner? (y/n/always)" | **yes (Pi)** | rewritten per-host |
| Startup/resume summary injection | **yes (Pi)** | rewritten per-host |
| `tool_call` guardrail (block `bash`/`edit` when no task is `in-progress`) | **yes (Pi)** | Claude: `PreToolUse` hook; others: `AGENTS.md` rules |
| `ctx.ui.notify` / `ctx.ui.input` | **yes (Pi)** | MCP text output + tool prompts |
| Language preferences persistence | no | yes (in `project.json`) |

## 5. Claude Code Phase 1 plan

Before implementing MCP, clean up the Pi command UX and define the public action names.

### Decisions

- First non-Pi target: **Claude Code only**.
- Public action namespace: **`planner-*`**, because the extension/product is `planner`, not `plan`.
- Pi human UX should not expose ~30 top-level flat slash commands by default.
- Pi should prefer one grouped command:
  - `/planner <TAB>` → hierarchical subcommand suggestions.
  - `/planner` + Enter → navigable command menu, similar in spirit to `/settings`.
- Claude Code MCP can expose atomic public tools named `planner-*`.
- Requirements stay internal for now; they are seed/project data, not public command UX.
- Features are first-class public entities and must be exposed: hierarchy is **features → phases → tasks**.

### Pi command grouping target

Primary human command:

- `/planner`

Hierarchical subcommands under `/planner`:

- `init`
- `show`
- `repair`
- `project discuss`
- `project language`
- `feature list`
- `feature add`
- `feature show`
- `feature update`
- `feature delete`
- `phase add`
- `phase show`
- `phase discuss`
- `phase update`
- `phase delete`
- `task add`
- `task show`
- `task discuss`
- `task update`
- `task delete`
- `task start`
- `task complete`
- `handoff prepare`
- `handoff show`
- `handoff write`
- `handoff clear`
- `web start`
- `web stop`
- `web status`
- `load`
- `disable`

Flat `planner-*` slash commands are not registered in Pi to avoid global autosuggest noise. The intended Pi UX is grouped under `/planner`. Claude Code MCP may still expose atomic `planner-*` tool names because MCP tools are a separate, agent-facing surface.

### MCP public action surface for Claude Code

MCP tool names should match the canonical public action names, using hyphenated `planner-*` names:

- `planner-init`
- `planner-show`
- `planner-repair`
- `planner-project-discuss`
- `planner-project-language`
- `planner-feature-list`
- `planner-feature-add`
- `planner-feature-show`
- `planner-feature-update`
- `planner-feature-delete`
- `planner-phase-add`
- `planner-phase-show`
- `planner-phase-discuss`
- `planner-phase-update`
- `planner-phase-delete`
- `planner-task-add`
- `planner-task-show`
- `planner-task-discuss`
- `planner-task-update`
- `planner-task-delete`
- `planner-task-start`
- `planner-task-complete`
- `planner-handoff-prepare`
- `planner-handoff-show`
- `planner-handoff-write`
- `planner-handoff-clear`
- `planner-web`
- `planner-load`
- `planner-disable`

Not exposed in Claude Code Phase 1:

- `planner-requirement-*`
- legacy internal names such as `plan_render`, `task_start`, `feature_create`, `plan_write_handoff`

## 6. MCP server design (`packages/plan-mcp`)

Each MCP tool handler is a thin wrapper around `PlanStore` methods or shared planner action handlers. No business logic duplication: the MCP server depends on `plan-core` directly.

### Transport
- **stdio** (default): for local CLI agents (Claude Code, Codex, OpenClaude, Hermes).
- **SSE/HTTP** (optional): reuse `plan-server`'s existing HTTP server and add an MCP-over-SSE endpoint, so the same server serves both the Web UI and MCP clients.

### SDK
- `@modelcontextprotocol/sdk` (TypeScript).
- `server.registerTool(name, config, handler)` for each tool.
- Handler signature: receives params, returns `{ content: [{ type: "text", text }] }`.

### Packaging
- `npx agent-plan mcp` launches the stdio MCP server.
- `npx agent-plan setup claude-code` creates/updates project-local `.mcp.json` with the MCP server config and `.claude/commands/planner.md` with a `/planner` slash-command router.
- Each agent registers it in its own config:
  - Claude Code: project `.mcp.json` → `mcpServers`.
  - Codex: MCP config.
  - Hermes/OpenClaude: toolset config.

## 7. Per-host lifecycle shims

### Claude Code
- **Tools**: MCP server in project `.mcp.json` `mcpServers`, or user-scope MCP via `claude mcp add`.
- **Slash command**: `agent-plan setup claude-code` writes `.claude/commands/planner.md` (project) or `~/.claude/commands/planner.md` (user) as a `/planner ...` router to MCP tools.
- **Guardrail**: setup installs a `PreToolUse` hook for `Bash|Edit|Write`; it blocks implementation tools when a planner exists, tasks exist, and no task is `in-progress`.
- **Startup**: `SessionStart` resume summary remains future work.
- **Gating**: explicit project initialization via `/planner init`; setup does not create `.planner/`.

### Codex
- **Tools**: MCP server in Codex MCP config.
- **Guardrail**: `AGENTS.md` instruction (no native hooks) — the agent is told not to run `bash`/`edit` without an in-progress task; enforcement is advisory.
- **Startup**: `AGENTS.md` instructs the agent to emit a resume summary at session start.

### OpenClaude
- **Tools**: MCP + web tools config.
- **Guardrail/Startup**: agent/workflow config (TBD against OpenClaude's config schema).

### Hermes
- **Tools**: MCP via configurable toolset (`"web,terminal,planner"`).
- **Guardrail/Startup**: CLI/TUI toolset config.

### Pi (refactored)
- `pi-adapter` starts the MCP server in-process and delegates tool calls to it.
- Keeps only: two-step gating, startup/resume summary injection, `tool_call` guardrail, `ctx.ui.notify`.
- Removes direct `PlanStore` calls (they move into `plan-mcp` handlers).

## 8. Migration plan (phased)

### Phase 0 — Pi command grouping and naming alignment
- Make `/planner` the primary human UX.
- Improve `/planner <TAB>` hierarchical completions.
- Add `/planner` + Enter interactive menu.
- Add missing feature subcommands under `/planner feature`: list/add/update/delete.
- Keep requirements internal.
- Remove existing flat `planner-*` commands from global slash command registration.
- **Result**: Pi UX is clean before MCP mirrors the public action model.

### Phase 1 — Claude Code MCP server
- Create `packages/plan-mcp`.
- Register canonical `planner-*` MCP tools listed above.
- Transport: stdio.
- Test with **Claude Code**.
- Add `agent-plan` CLI with `mcp`, `init`, and `setup claude-code`.
- Generate Claude Code slash command `.claude/commands/planner.md` so users can type `/planner ...` and route to MCP tools.
- Document setup in `docs/setup-claude-code.md`.
- Current caveat: `planner-web` is exposed as a guidance/no-op tool in MCP stdio; web server lifecycle remains handled by Pi or plan-server CLI.
- **Result**: agent-plan works on Claude Code at tool level.
- **Effort**: ~1–2 days after command/action handlers are aligned.

### Phase 2 — Per-host lifecycle/governance
- Claude Code: `PreToolUse` task guard is implemented by setup; `SessionStart` resume summary remains to be designed.
- Codex: `AGENTS.md` template.
- Hermes/OpenClaude: toolset config templates.
- **Effort**: ~1 day per host.

### Phase 3 — Pi-adapter refactor (thin)
- `pi-adapter` calls the MCP server in-process instead of `PlanStore` directly.
- Keeps Pi-unique behavior only.
- Eliminates tool-handler duplication.
- **Effort**: ~1 day.

### Phase 4 — Packaging & docs
- `npx agent-plan` launcher.
- Per-host setup docs (`docs/setup-claude-code.md`, `docs/setup-codex.md`, ...).
- **Effort**: ~0.5 day.

## 9. Risks & open questions

- **Governance enforcement varies by host**: Claude Code hooks can *enforce*; Codex/OpenClaude/Hermes rely on *advisory* instructions. Decide whether hard enforcement is required or advisory is acceptable for non-Pi hosts.
- **UI access from non-Pi hosts**: the Web UI is already independent (HTTP server). Non-Pi agents can open it in a browser; live updates work via the existing `writeNotifyHook` + HTTP `/internal/notify` fallback.
- **Gating UX**: Pi's two-step prompt (enable → start web) is Pi-specific. For other hosts, decide whether gating is needed at all or whether the MCP server simply runs on demand.
- **Transport choice**: stdio is simplest for CLI agents; SSE/HTTP would let one server serve both Web UI and MCP. Decide whether to unify or keep two transports.

## 10. Recommendation

Start with **Phase 0**: clean up Pi command grouping and naming first. Then implement **Phase 1** for **Claude Code only** using canonical `planner-*` MCP tool names. Defer Codex, OpenClaude, and Hermes until the Claude Code path is validated.
