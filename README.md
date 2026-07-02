# Agent Plan

Agent Plan is a local, project-scoped planning platform for AI coding agents.

It gives a project a structured planning workspace in `.planner/`, then exposes that workspace through multiple surfaces:

- a core TypeScript library (`@agent-plan/core`);
- a local HTTP/WebSocket server and React dashboard;
- a Pi adapter with a grouped `/planner ...` command;
- a Claude Code MCP server with `planner-*` tools;
- a Claude Code `/planner ...` slash command router;
- a CLI (`agent-plan`) for setup, MCP startup, and project initialization.

The goal is to make planning durable, inspectable, and shared across agents without coupling the core planning model to any one harness.

---

## Status

This project is under active development.

Current focus:

- Pi integration is available through a grouped `/planner` command.
- Claude Code Phase 1 is available through MCP and a generated `/planner` slash command.
- The canonical project data directory is `.planner/`.
- Agent Plan intentionally does **not** read, migrate, or use `.plan/`; that directory belongs to other tools such as GSD/get-shit-done.

---

## Core concepts

### `.planner/` is the source of truth

Agent Plan stores structured planning data in the target project:

```text
my-project/
  .planner/
    manifest.json
    project.json
    features.json
    requirements.json
    phases/
      <phase-id>.json
    resume.json
    HANDOFF.md
    generated/
      PLAN.md
      features/
      phases/
```

JSON files are the source of truth. Markdown files under `.planner/generated/` are generated views for humans and agents.

### `.plan/` is never used

Agent Plan only owns `.planner/`.

It does not fall back to `.plan/`, migrate `.plan/`, or treat `.plan/` as a planner root. If `.plan/` exists, it is ignored during scanning so data from other tools is not accidentally imported into Agent Plan.

### Hierarchy

The public planning hierarchy is:

```text
project → features → phases → tasks
```

Requirements currently exist as internal/project seed data and are not exposed as public Claude Code commands in Phase 1.

### Harness-agnostic core

The core planning model lives outside Pi, Claude Code, or any other harness. Adapters should call shared planning logic rather than owning business rules.

---

## Installation model

There are two separate actions:

1. **Install Agent Plan for an agent/harness**.
2. **Initialize `.planner/` inside a specific project when you want planning there**.

These are intentionally separate.

Installing Agent Plan into Claude Code should not create `.planner/` in every repository. A project is initialized only when the user explicitly runs `/planner init` or `agent-plan init` inside that project.

---

## Recommended Claude Code setup

### 1. Install once

After publication, the intended installation is:

```bash
npm install -g agent-plan
```

Then configure Claude Code once at user scope:

```bash
agent-plan setup claude-code --user
```

This does two things:

1. registers the Agent Plan MCP server in Claude Code user scope;
2. writes the Claude Code slash command router:

```text
~/.claude/commands/planner.md
```

After this, `/planner ...` is available from Claude Code projects.

### 2. Initialize a project only when needed

Open a project with Claude Code:

```bash
cd my-project
claude
```

Then initialize planning explicitly:

```text
/planner init
```

This creates:

```text
my-project/.planner/
```

If a project is not initialized, Agent Plan tools should report that `.planner/` is missing and suggest `/planner init`.

---

## Claude Code commands

Claude Code receives two layers:

1. **MCP tools** named `planner-*`.
2. A generated slash command `/planner ...` that routes natural command text to those tools.

Examples:

```text
/planner init
/planner show
/planner reload
/planner feature list
/planner feature add Auth flow
/planner phase add Login API
/planner task start <task-id>
/planner task complete <task-id>
/planner handoff prepare
```

The slash command is a prompt router. It tells Claude Code which MCP tool to call. It is not the same mechanism as Pi's native command implementation.

---

## Claude Code MCP tools

The MCP server exposes public tools using the `planner-*` namespace.

Current Phase 1 tools include:

### Core

- `planner-init`
- `planner-show`
- `planner-repair`
- `planner-load`
- `planner-disable`
- `planner-web`

### Project

- `planner-project-discuss`
- `planner-project-language`

### Features

- `planner-feature-list`
- `planner-feature-add`
- `planner-feature-show`
- `planner-feature-update`
- `planner-feature-delete`

### Phases

- `planner-phase-add`
- `planner-phase-show`
- `planner-phase-discuss`
- `planner-phase-update`
- `planner-phase-delete`

### Tasks

- `planner-task-add`
- `planner-task-show`
- `planner-task-discuss`
- `planner-task-update`
- `planner-task-delete`
- `planner-task-start`
- `planner-task-complete`

### Handoff

- `planner-handoff-prepare`
- `planner-handoff-show`
- `planner-handoff-write`
- `planner-handoff-clear`

Requirements are intentionally not exposed as `planner-requirement-*` in Phase 1.

---

## Claude Code setup modes

### User-scope setup, recommended

Use this once per machine/user:

```bash
agent-plan setup claude-code --user
```

This keeps the MCP server and slash command available across projects.

It does not create `.planner/` in any project.

### Project-local setup

Use this when you want a repository-local Claude Code configuration, for example for a team, a pinned version, or local development:

```bash
agent-plan setup claude-code --project
```

This creates or updates:

```text
.mcp.json
.claude/commands/planner.md
```

Example `.mcp.json`:

```json
{
  "mcpServers": {
    "agent-plan": {
      "command": "npx",
      "args": ["agent-plan", "mcp"]
    }
  }
}
```

Project-local setup also does not initialize `.planner/`. Run `/planner init` when you want planning enabled in that repo.

### Local development setup

Before npm publication, use the built local CLI:

```bash
pnpm --filter @agent-plan/mcp build
pnpm --filter agent-plan build
```

Project-local local setup:

```bash
node /Users/antonio/projects/agent-plan/packages/agent-plan/dist/index.js setup claude-code --project --local
```

User-scope local setup:

```bash
node /Users/antonio/projects/agent-plan/packages/agent-plan/dist/index.js setup claude-code --user --local
```

---

## CLI

The CLI package is `agent-plan`.

```bash
agent-plan help
agent-plan mcp
agent-plan init
agent-plan setup claude-code --user
agent-plan setup claude-code --project
```

### `agent-plan mcp`

Starts the stdio MCP server.

This is what Claude Code launches after setup.

### `agent-plan init`

Initializes `.planner/` in the current working directory.

```bash
cd my-project
agent-plan init
```

This is equivalent in intent to running `/planner init` from an agent UI.

### `agent-plan setup claude-code`

Configures Claude Code integration.

Useful options:

```bash
--user      install at Claude Code user scope
--project   install in the current project; this is the default
--local     point config to the local built CLI instead of npx/global package
--force     overwrite an existing agent-plan MCP entry
```

---

## Pi usage

Pi exposes Agent Plan as one grouped command:

```text
/planner
```

Examples:

```text
/planner init
/planner show
/planner feature list
/planner feature add
/planner phase add
/planner phase discuss
/planner task start
/planner task complete
/planner handoff prepare
/planner web start
```

Older flat slash commands such as `planner-task-start` were removed from Pi's global command registration to avoid autocomplete noise. Pi users should use the grouped `/planner ...` form.

---

## Web UI

Agent Plan includes a local web UI served by `plan-server` and used by the Pi adapter.

The web UI visualizes:

- project summary;
- features;
- phases;
- tasks;
- status rollups;
- accepted decisions;
- handoff state.

In MCP Phase 1, `planner-web` is exposed as a guidance/no-op tool. Full web lifecycle management from Claude Code is not finalized yet; use Pi or the server CLI for now.

---

## Handoff workflow

Agent Plan supports a canonical session handoff file:

```text
.planner/HANDOFF.md
```

Claude Code tools:

```text
/planner handoff prepare
/planner handoff show
/planner handoff clear
```

MCP tools:

- `planner-handoff-prepare`
- `planner-handoff-show`
- `planner-handoff-write`
- `planner-handoff-clear`

The handoff should describe current focus, work in progress, resume steps, files touched, blockers, next steps, and recent decisions.

---

## Task status discipline

Agent Plan relies on explicit task lifecycle transitions.

Before implementation work:

```text
/planner task start <task-id>
```

After completed work:

```text
/planner task complete <task-id>
```

Phase and feature statuses are derived from child task/phase state. Agents should not directly mutate parent status unless there is a specific reason.

---

## Repository structure

```text
packages/
  agent-plan/      CLI: agent-plan mcp/init/setup
  plan-core/       schemas, persistence, rendering, status logic
  plan-server/     local HTTP/WebSocket server
  plan-web-ui/     React dashboard
  plan-mcp/        MCP stdio server for Claude Code
  pi-adapter/      Pi extension adapter
```

Important docs:

```text
PROJECT.md
ROADMAP.md
CHECKLIST.md
docs/multi-agent-strategy.md
docs/setup-claude-code.md
```

---

## Development

Install dependencies:

```bash
pnpm install
```

Build/check all packages:

```bash
pnpm check
```

Build MCP and CLI only:

```bash
pnpm --filter @agent-plan/mcp build
pnpm --filter agent-plan build
```

Smoke test MCP tools locally:

```bash
node packages/agent-plan/dist/index.js mcp
```

For automated MCP smoke testing, use the MCP SDK client to call `listTools`; the expected Phase 1 count is currently 29 public `planner-*` tools.

---

## Troubleshooting

### `/planner` is not available in Claude Code

Check that the slash command exists:

User scope:

```text
~/.claude/commands/planner.md
```

Project scope:

```text
.claude/commands/planner.md
```

Then restart Claude Code in the project.

### MCP tools are not available in Claude Code

For project-local setup, check:

```text
.mcp.json
```

For user-scope setup, check Claude Code's MCP list:

```bash
claude mcp list
```

If needed, re-run:

```bash
agent-plan setup claude-code --user --force
```

### `.planner/` does not exist

That is expected until a project is initialized.

Run:

```text
/planner init
```

or:

```bash
agent-plan init
```

### `.plan/` exists

Agent Plan ignores `.plan/`. It is not an Agent Plan directory.

Do not rename or migrate `.plan/` into `.planner/` unless you intentionally know what you are doing outside Agent Plan.

---

## Design principles

- `.planner/` is project-local and explicit.
- Markdown is generated, not the source of truth.
- Core planning logic must remain harness-agnostic.
- Pi, Claude Code, and future agents are adapters over the same planning model.
- Installation should be global/user-level when possible; project initialization should remain explicit.
- Public naming uses `planner-*` for MCP tools and `/planner ...` for human command UX.
