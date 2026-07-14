# Decisions — Multi-Plugin Architecture & Claude Code Plugin

Detailed record of every decision made for this improvement, with rationale
and implementation notes. Source of truth is `.planner/` (`acceptedDecisions`
on feature F001 / F002); this file is a human-readable companion.

## F001 — Claude Code Plugin & Multi-Plugin Structure

### D1 — Plugins separated from packages
**Decision.** Plugin bundles live in a top-level `plugins/` directory, separate
from `packages/` (which holds publishable npm libraries).

**Rationale.** Plugins are static bundles (JSON + Markdown + shell), not npm
packages. Keeping them out of the pnpm workspace avoids polluting the
publishable set and cleanly separates "libraries" from "harness bundles".

**Implementation.** `plugins/` at repo root; `packages/` unchanged. Each plugin
is self-contained and distributable via its harness mechanism.

### D2 — One subdirectory per harness + _shared/ templates
**Decision.** `plugins/` has one subdirectory per harness (`claude-code/`,
`codex/`) plus `_shared/` holding single-source-of-truth templates.

**Rationale.** Supports multiple harnesses without duplication; `_shared/`
ensures the `/planner` routing and SessionStart notification stay consistent
across harnesses.

**Implementation.** `plugins/_shared/planner-skill.md.in` and
`notify-session-start.sh.in` use `{{HARNESS}}`/`{{LOAD_COMMAND}}` placeholders
substituted by `scripts/sync-plugins.cjs`. Adding a harness = one entry in the
`HARNESSES` table.

### D3 — Planner logic stays in @agent-plan/mcp
**Decision.** The planner tools remain in the `@agent-plan/mcp` npm package;
plugins reference it via `.mcp.json` using `npx -y @agent-plan/mcp`.

**Rationale.** Single implementation of `planner-*` tools reused by every
harness plugin; no logic duplication; consistent with the harness-agnostic
core principle (AGENTS.md §3).

**Implementation.** `plugins/claude-code/.mcp.json` declares the stdio MCP
server; auto-starts when the plugin is enabled. Plan root resolves from
`AGENT_PLAN_ROOT` or `cwd()/.planner`.

### D4 — Planner disabled by default; web does not auto-start
**Decision.** The planner and its web dashboard are disabled by default at
startup. Nothing starts automatically.

**Rationale.** Explicit user constraint: *"il planner non deve partire
automaticamente ma solo se l'utente chiama load"*. Avoids unwanted server
processes and respects user control.

**Implementation.** SessionStart hook is notification-only; the planner is
enabled only via `/planner load`. The marketplace entry sets
`defaultEnabled: false`.

### D5 — /planner load and /planner stop semantics
**Decision.** `/planner load` enables the planner, starts the web dashboard
LAN-bound, and emits a recap (status + handoff + Web UI address).
`/planner stop` (alias `disable`) disables the planner and stops the web
dashboard.

**Rationale.** Mirrors the Pi adapter behavior for cross-harness parity;
gives the user a single explicit on/off switch.

**Implementation.** Routes to `planner-load` and `planner-stop` MCP tools. Web
binds to `0.0.0.0` with a dynamic OS-assigned port.

### D6 — Web UI address only on load recap or web status
**Decision.** The Web UI address is shown only in the `/planner load` recap
and via `/planner web status`. It is NOT appended to every assistant message.

**Rationale.** Claude Code has no `message_end` hook equivalent to modify the
final assistant message (unlike Pi). This matches the user's accepted
behavior (URL only on load/status) and avoids noisy repetition on every turn.

**Implementation.** Recap URL comes from the `planner-load` tool response;
`/planner web status` from the `planner-web` status action.

### D7 — SessionStart hook is non-blocking notification only
**Decision.** The SessionStart hook prints a non-blocking notification
("Planner available — run /planner load") and does NOT start the planner,
the web, or inject a recap.

**Rationale.** Parity with the Pi `session_start` notify; respects the
no-auto-start constraint; gives discoverability without forcing startup.

**Implementation.** `hooks/hooks.json` SessionStart → command running
`scripts/notify-session-start.sh`; always exits 0. Uses
`${CLAUDE_PLUGIN_ROOT}` for portability.

### D8 — Self-hosted marketplace distribution (no approval)
**Decision.** Distribute via a self-hosted marketplace (channel 2):
`marketplace.json` in the repo, users add via
`/plugin marketplace add ovidius72/agent-planner`. The official directory
(channel 3) is an optional future step.

**Rationale.** Channel 2 requires no Anthropic approval and is immediate;
channel 3 requires public repo + automated review and only adds reach, not
functionality.

**Implementation.** `.claude-plugin/marketplace.json` (at the **repo root**,
per the Claude Code plugin spec) lists the `agent-plan` plugin, source
`./plugins/claude-code`. Users run
`/plugin marketplace add ovidius72/agent-planner` then
`/plugin install agent-plan@agent-plan-marketplace`.

> **Correction during implementation.** The agreed plan originally placed
> `marketplace.json` inside `plugins/claude-code/`. The official docs require
> it at the repo root in `.claude-plugin/`. Adjusted accordingly; the plugin
> itself stays at `./plugins/claude-code`.

### D9 — Planner operations are not code edits
**Decision.** Planner operations (`plan_write_handoff`, `plan_get`,
feature/phase/task CRUD) are NOT code edits and are always allowed regardless
of task state.

**Rationale.** Prevents the guard from blocking handoff writing or planning
when no task is in-progress (user-reported blocker). Aligns with AGENTS.md
operational protocol.

**Implementation.** Documented in the `/planner` skill operational protocol;
a future PostToolUse guard (if added) would skip `.planner/` paths.

### D10 — Composite IDs in chat, never raw UUIDs
**Decision.** Entity references in chat use human composite IDs (`F001`,
`P001(F001)`, `T001(P001/F001)`); tools emit composite IDs;
`findTaskByRef`/`findPhaseByRef`/`findFeatureByRef` accept composite IDs and
short forms.

**Rationale.** AGENTS.md §9 communication rule; eliminates agents referencing
UUIDs invisible in the Web UI (user-reported issue).

**Implementation.** Routing in the `/planner` skill instructs composite IDs;
relies on the core composite-ID tooling.

---

## F002 — Expose planner web lifecycle as agent tools (pi-adapter)

### F002-D1 — Web lifecycle exposed as agent tools
**Decision.** Register `planner-web`, `planner-load`, `planner-stop` as agent
tools in the pi-adapter, wrapping the same internal helpers used by the
`/planner` slash commands.

**Rationale.** The `/planner` slash commands are not intercepted when the
planner is disabled (default), so neither user nor agent can start the web.
Exposing the lifecycle as agent tools lets the Pi agent manage the web
directly, matching Claude Code's `@agent-plan/mcp` `planner-web` tool.

**Implementation.** 3 new `pi.registerTool` calls in
`packages/pi-adapter/src/index.ts`; reuse
`startServer`/`stopServer`/`getWebStatus`/`buildStartupResumeSummary`; return
shapes mirror `@agent-plan/mcp` for cross-harness parity. Bumped
`@agent-plan/pi-adapter` 0.2.13 → 0.2.14 (PR #17).

---

## Distribution channels (reference)

| Channel | Approval? | Reach | Mechanism |
|---|---|---|---|
| 1. Direct install | none | selective | `claude --plugin-dir ./plugins/claude-code` or `/plugin install <git-url>` |
| 2. Self-hosted marketplace | none | opt-in | `/plugin marketplace add ovidius72/agent-planner` (chosen now) |
| 3. Official directory | yes (automated review) | all users | Anthropic submission form (optional future) |