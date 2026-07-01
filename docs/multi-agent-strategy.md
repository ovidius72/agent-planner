# Multi-Agent Strategy: porting agent-plan to Claude Code, Codex, OpenClaude, Hermes

> Status: proposal — 2026-07-01
> Owner: agent-plan platform
> Goal: make the planner usable from multiple AI coding agents, not only Pi.

## 1. Executive summary

agent-plan is currently bound to Pi via `pi-adapter`. The good news: **~90% of the value is already portable** (`plan-core`, `plan-server`, `plan-web-ui` have zero Pi dependencies). The only Pi-specific coupling lives in `pi-adapter`.

The four target agents (**Claude Code, Codex, OpenClaude, Hermes**) all support **MCP (Model Context Protocol)** as the shared standard for exposing external tools. The recommended path is therefore not to write four separate adapters, but to expose agent-plan's tools behind **a single MCP server** and point each client at it.

- **MCP** = portable tool/data integrations across hosts and vendors.
- **Agent-specific hooks** = deep, host-native lifecycle behavior (gating, guardrails, startup summaries).

We use MCP for the tool surface, and a thin per-host shim for the lifecycle behaviors Pi currently owns.

## 2. Target agent landscape

| Agent | Tool extension | Lifecycle extension | Config location |
|---|---|---|---|
| **Claude Code** | MCP servers | Hooks: `PreToolUse`, `PostToolUse`, `SessionStart`, etc. | `~/.claude/settings.json`, project `.claude/settings.json` |
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

## 5. MCP server design (`packages/plan-mcp`)

### Tool surface (maps 1:1 to existing adapter tools)
- `plan_render`
- `project_get` / `project_set` / `project_set_language_preferences`
- `feature_create` / `feature_update` / `feature_list`
- `phase_create` / `phase_update` / `phase_discuss`
- `task_create` / `task_update` / `task_start` / `task_complete`
- `handoff_prepare` / `handoff_show` / `handoff_write` / `handoff_clear`

Each tool handler is a thin wrapper around `PlanStore` methods (the same ones `pi-adapter` calls today). No business logic duplication: the MCP server depends on `plan-core` directly.

### Transport
- **stdio** (default): for local CLI agents (Claude Code, Codex, OpenClaude, Hermes).
- **SSE/HTTP** (optional): reuse `plan-server`'s existing HTTP server and add an MCP-over-SSE endpoint, so the same server serves both the Web UI and MCP clients.

### SDK
- `@modelcontextprotocol/sdk` (TypeScript).
- `server.registerTool(name, config, handler)` for each tool.
- Handler signature: receives params, returns `{ content: [{ type: "text", text }] }`.

### Packaging
- `npx agent-plan` launches the stdio MCP server.
- Each agent registers it in its own config:
  - Claude Code: `.claude/settings.json` → `mcpServers`.
  - Codex: MCP config.
  - Hermes/OpenClaude: toolset config.

## 6. Per-host lifecycle shims

### Claude Code
- **Tools**: MCP server in `.claude/settings.json` `mcpServers`.
- **Guardrail**: `PreToolUse` hook blocks `bash`/`edit`/`write` when a planner exists, tasks exist, and no task is `in-progress` (same rule as the current `pi-adapter` `tool_call` guard).
- **Startup**: `SessionStart` hook emits the resume summary.
- **Gating**: handled via the hook (prompt on first run) or a one-time `AGENTS.md` instruction.

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

## 7. Migration plan (phased)

### Phase 1 — MCP server (highest ROI)
- Create `packages/plan-mcp`.
- Register existing tools as MCP tools (handlers wrap `PlanStore`).
- Transport: stdio.
- Test with **Claude Code** (most mature MCP client).
- **Result**: agent-plan works on Claude Code, Codex, OpenClaude, Hermes (tool level).
- **Effort**: ~1–2 days (tools already exist; it's a wrapper).

### Phase 2 — Per-host lifecycle/governance
- Claude Code: `PreToolUse` + `SessionStart` hooks.
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

## 8. Risks & open questions

- **Governance enforcement varies by host**: Claude Code hooks can *enforce*; Codex/OpenClaude/Hermes rely on *advisory* instructions. Decide whether hard enforcement is required or advisory is acceptable for non-Pi hosts.
- **UI access from non-Pi hosts**: the Web UI is already independent (HTTP server). Non-Pi agents can open it in a browser; live updates work via the existing `writeNotifyHook` + HTTP `/internal/notify` fallback.
- **Gating UX**: Pi's two-step prompt (enable → start web) is Pi-specific. For other hosts, decide whether gating is needed at all or whether the MCP server simply runs on demand.
- **Transport choice**: stdio is simplest for CLI agents; SSE/HTTP would let one server serve both Web UI and MCP. Decide whether to unify or keep two transports.

## 9. Recommendation

Start with **Phase 1** (MCP server) immediately — it's the highest-leverage step and unblocks all four target agents at once. Defer the per-host lifecycle shims until the MCP tool surface is validated against at least one non-Pi client (Claude Code).