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
- Claude Code integration is available both as a self-hosted plugin (marketplace) and via MCP + a generated `/planner` slash command.
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

### Hierarchy

The public planning hierarchy is:

```text
project → features → phases → tasks
```

Requirements currently exist as internal/project seed data and are not exposed as public Claude Code commands in Phase 1.

### Harness-agnostic core

The core planning model lives outside Pi, Claude Code, or any other harness. Adapters should call shared planning logic rather than owning business rules.

---

## Plugins

Agent Plan is distributed to AI coding harnesses through a **self-hosted plugin marketplace**. Plugins are static bundles (JSON + Markdown + shell scripts) living in the top-level `plugins/` directory, separate from the npm packages in `packages/`.

### How plugins work

A plugin does **not** reimplement planning logic. It wires a harness to the shared planning core (`@agent-plan/mcp`, the MCP stdio server, backed by `@agent-plan/core`) and provides harness-specific integration: a slash-command router, a non-blocking session-start notification, and the MCP server declaration.

```text
plugins/
  claude-code/                 Claude Code plugin (ready)
    .claude-plugin/plugin.json   plugin manifest
    .mcp.json                     @agent-plan/mcp stdio server (npx)
    skills/planner/SKILL.md       /planner routing (derived from _shared/)
    hooks/hooks.json              SessionStart non-blocking notify
    scripts/notify-session-start.sh
  codex/                      Codex plugin (planned)
  _shared/                    single-source-of-truth templates
    planner-skill.md.in
    notify-session-start.sh.in
.claude-plugin/marketplace.json   marketplace catalog (repo root, per Claude Code spec)
```

Per-harness behavior (consistent across harnesses):

- The planner is **disabled by default**; nothing auto-starts.
- `/planner load` — enable the planner, start the web dashboard (LAN-bound, dynamic port), emit a recap (status + handoff + Web UI address).
- `/planner stop` (alias `/planner disable`) — disable the planner and stop the web.
- The Web UI address is shown **only** on the `load` recap or via `/planner web status` — never appended to every message.
- Planner operations (handoff, plan CRUD) are **not** code edits and are always allowed regardless of task state.

### Install (Claude Code, self-hosted marketplace — no approval required)

```text
/plugin marketplace add ovidius72/agent-planner
/plugin install agent-plan@agent-plan-marketplace
```

Updates: push to the repo, then `/plugin marketplace update`.

### Local development / testing

```bash
claude --plugin-dir ./plugins/claude-code --debug
```

Or add the repo itself as a local marketplace:

```text
/plugin marketplace add ./
/plugin install agent-plan@agent-plan-marketplace
```

### Scaffolding a new harness plugin

1. Add a subdirectory under `plugins/<harness>/` with `.claude-plugin/plugin.json`, `.mcp.json`, `skills/`, `hooks/`.
2. Add an entry to the `HARNESSES` table in `scripts/sync-plugins.cjs`.
3. Edit the templates in `plugins/_shared/` (never edit derived files directly).
4. Run `pnpm plugins:sync` to regenerate derived files (`pnpm plugins:check` for the CI drift guard).

See `plugins/README.md` and `plugins/DECISIONS.md` for the full design and decision record.

---

## Recommended Claude Code setup

> **Prefer the plugin** — the self-hosted marketplace plugin (see [Plugins](#plugins) above) is now the recommended install path: `/plugin marketplace add ovidius72/agent-planner` then `/plugin install agent-plan@agent-plan-marketplace`. The CLI-based setup below remains a valid manual alternative and is still used to register the MCP server, slash command, and write guard hook at user/project scope.

### 1. Install once

After publication, the intended installation is:

```bash
npm install -g agent-plan
```

Then configure Claude Code once at user scope:

```bash
agent-plan setup claude-code --user
```

This does three things:

1. registers the Agent Plan MCP server in Claude Code user scope;
2. writes the Claude Code slash command router:

```text
~/.claude/commands/planner.md
```

1. installs a Claude Code `PreToolUse` task guard hook in:

```text
~/.claude/settings.json
```

After this, `/planner ...` is available from Claude Code projects and implementation tools are guarded when a project has an active `.planner/`.

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

## User commands — Claude Code

Claude Code supports a slash command `/planner ...` that routes natural command text to the underlying MCP tools.

### Core

- `/planner init` — Initialize planner
- `/planner show` — Show planner overview
- `/planner repair` — Repair planner integrity
- `/planner load` — Re-enable planner
- `/planner disable` — Disable planner for this session

### Project

- `/planner project discuss` — Run project discovery
- `/planner project language` — Set persistent language preferences

### Features

- `/planner feature list` — List features
- `/planner feature add <name>` — Create a feature
- `/planner feature show <id>` — Show a feature
- `/planner feature update <id>` — Update a feature
- `/planner feature delete <id>` — Delete a feature

### Phases

- `/planner phase add <title>` — Add a phase
- `/planner phase show <id>` — Show a phase
- `/planner phase discuss <id>` — Discuss a phase
- `/planner phase update <id>` — Update a phase
- `/planner phase delete <id>` — Delete a phase

### Tasks

- `/planner task add <title>` — Add a task
- `/planner task show <id>` — Show a task
- `/planner task discuss <id>` — Discuss a task
- `/planner task update <id>` — Update a task
- `/planner task delete <id>` — Delete a task
- `/planner task start <id>` — Mark a task in-progress
- `/planner task complete <id>` — Mark a task done

### Handoff

- `/planner handoff prepare` — Tell the agent to create/update the handoff
- `/planner handoff show` — Show the current handoff
- `/planner handoff write` — Write handoff from planner data
- `/planner handoff clear` — Delete the current handoff

### Export & Web

- `/planner export` — Export plan summary as Markdown
- `/planner export-full` — Export full detailed plan as Markdown
- `/planner web start|stop|status` — Manage the web UI

### Guard bypass

- `/planner bypass` — Authorize edit/write without a task (15 min)
- `/planner clear-bypass` — Revoke the bypass

---

## Agent tools (MCP)

The MCP server exposes public tools using the `planner-*` namespace. These tools are called **by AI agents** (Claude Code, Codex, Zed), not by humans. Human users should use the `/planner ...` slash commands instead.

Current Phase 1 tools include:

### Core

- `planner-init`
- `planner-show`
- `planner-repair`
- `planner-load`
- `planner-disable`
- `planner-web`
- `planner-export`

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

### Export

- `planner-export` (with optional `full` boolean for detailed hierarchical output)

### Guard bypass

- `planner-authorize-bypass` (temporary bypass so Edit/Write work without a task in-progress)
- `planner-clear-bypass`

Requirements are intentionally not exposed as `planner-requirement-*` in Phase 1.

The current Phase 1 count is **32** public `planner-*` tools.

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
.claude/settings.json
```

The settings file contains a Claude Code `PreToolUse` hook for `Edit|Write` and the shared guard-bypass flow.

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
agent-plan export [--full]
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

### `agent-plan export`

Generates a Markdown export of the plan and writes it to `.planner/EXPORT.md`.

```bash
agent-plan export          # summary report
agent-plan export --full   # full hierarchical detail (features → phases → tasks)
```

In Pi and Claude Code the same report is available via:

```text
/planner export
/planner export-full
```

The web UI also exposes an `Export` dropdown with `Summary` and `Full` options that download the generated Markdown file.

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

## User commands — Pi

Pi exposes Agent Plan as one grouped command:

```text
/planner
```

### Core

- `/planner init` — Initialize planner in this project
- `/planner show` — Show planner overview
- `/planner repair` — Repair planner integrity
- `/planner load` — Re-enable planner and start web UI
- `/planner disable` — Disable planner and stop web UI for this session (alias: `/planner stop`)

### Project

- `/planner project discuss` — Run project discovery
- `/planner project language` — Set persistent language preferences

### Features

- `/planner feature list` — List features
- `/planner feature add` — Create a feature
- `/planner feature show` — Show a feature
- `/planner feature update` — Update a feature
- `/planner feature delete` — Delete a feature

### Phases

- `/planner phase add` — Add a phase
- `/planner phase show` — Show a phase
- `/planner phase discuss` — Discuss a phase
- `/planner phase update` — Update a phase
- `/planner phase delete` — Delete a phase

### Tasks

- `/planner task add` — Add a task
- `/planner task show` — Show a task
- `/planner task discuss` — Discuss a task
- `/planner task update` — Update a task
- `/planner task delete` — Delete a task
- `/planner task start` — Mark a task in-progress
- `/planner task complete` — Mark a task done

### Handoff

- `/planner handoff prepare` — Tell the agent to create/update the handoff
- `/planner handoff show` — Show the current handoff
- `/planner handoff write` — Write handoff directly from planner data
- `/planner handoff clear` — Delete the current handoff

### Web

- `/planner web start` — Start the web UI
- `/planner web stop` — Stop the web UI
- `/planner web status` — Show web UI status

### Export

- `/planner export` — Export plan summary as Markdown
- `/planner export-full` — Export full detailed plan as Markdown

### Guard bypass

- `/planner bypass` — Authorize edit/write without a task in-progress (15 min)
- `/planner clear-bypass` — Revoke the guard bypass

### Pi startup behavior and resume

The planner is **disabled by default** at Pi startup. No enablement or web-UI prompt is shown — nothing auto-starts. To enable the planner, the user (or agent) runs `/planner load`; to disable it, `/planner stop` (alias `/planner disable`).

Why this exists:

- Pi sessions should be quick to resume without blocking prompts;
- the planner must not start automatically — only on explicit request;
- the same model applies consistently across harnesses (Pi, Claude Code, Codex).

When the planner is loaded, the startup resume summary includes the dashboard URL (LAN address + port). The Web UI address appears **only** in that `load` recap or via `/planner web status` — never appended to every message.

If no feature/phase/task is actually `in-progress`, the resume summary must not invent a current focus from the handoff. In that case, the handoff is treated as a **previous-session hint to validate** against the current plan state, ordering, and dependencies.

### Stable planning order and visible numbering

Agent Plan now persists explicit planning order for:

- features → `feature.number`
- phases → `phase.number`
- tasks → `task.number`

This order is displayed as stable human-friendly labels:

- `F001`, `F002`, ...
- `P001`, `P002`, ...
- `T001`, `T002`, ...

Why this exists:

- UUIDs are stable but hard to reason about visually;
- resume, handoff, export, and Work Tree must agree on the same ordering;
- teams need a clear sense of sequence and priority, not just identity.

For older projects, the numbering is normalized automatically from the current planner structure and persisted back into `.planner/`.

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

The `planner-web` MCP tool fully manages the web lifecycle (start / status / stop) in-process, binding LAN (`0.0.0.0`) with a dynamic OS-assigned port. The same lifecycle is exposed in the Pi adapter as agent tools (`planner-web`, `planner-load`, `planner-stop`) and as `/planner web` / `/planner load` / `/planner stop` slash commands.

### Planner housekeeping

Agent Plan now creates a project-local ignore file at:

```text
.planner/.gitignore
```

It ignores transient planner artifacts such as:

- `*.bak`
- `*.tmp.*`

Why this exists:

- `PlanStore` uses atomic writes and backup files for safety;
- backup/temp artifacts should not pollute `git status`;
- planner recovery should stay safe without requiring manual cleanup.

At Pi session start, orphan `.bak` and `*.tmp.*` files are also cleaned up asynchronously in the background. This is automatic; there is no manual command to run.

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

Why this matters:

- the dashboard header and Work Tree use active task state;
- feature/phase rollups are derived from child tasks;
- resume focus and handoff quality depend on correct task lifecycle transitions;
- if an agent edits code without moving a task to `in-progress`/`done`, the whole planner tree becomes stale.

For this reason, Agent Plan provides dedicated lifecycle tools and blocks the wrong path:

- use `task_start` / `planner-task-start` / `/planner task start` to begin work;
- use `task_complete` / `planner-task-complete` / `/planner task complete` to finish work;
- do **not** use `task_update` to move a task directly to `in-progress` or `done`.

### Write guard and temporary bypass

Agent Plan enforces task discipline only where it matters most: **write operations**.

The guard exists because agents often need to inspect the repo, run tests, or pull changes before opening a task. Blocking all shell access was too restrictive. The current model therefore:

- keeps `bash` free for `git pull`, build, test, search, and inspection;
- blocks only `edit` / `write` when a planner exists, tasks exist, and no task is `in-progress`;
- allows an explicit **temporary bypass** when the user authorizes proceeding without opening a task.

Recommended workflow:

1. Start the task normally:

```text
/planner task start <task-id>
```

1. If the user explicitly wants work without opening a task, authorize a temporary bypass:

```text
/planner bypass
```

1. Do the edit/write work.

2. Revoke the bypass when you want normal discipline back:

```text
/planner clear-bypass
```

The same flow is available through low-level tools:

- Pi/runtime tools: `plan_authorize_bypass`, `plan_clear_bypass`
- Claude/MCP tools: `planner-authorize-bypass`, `planner-clear-bypass`

The bypass is stored in `.planner/resume.json` as `guardBypassUntil`, so it is shared across harnesses and auto-expires.

### Claude Code task guard

`agent-plan setup claude-code` installs a Claude Code `PreToolUse` hook for `Edit|Write` (bash is intentionally not guarded, so `git pull`, build and test always work).

The hook **blocks Edit/Write when no task is in-progress**, unless the user has authorized a temporary bypass. The block is not a dead wall: the agent can start a task with `/planner task start`, OR the user can authorize a one-time bypass so Edit/Write proceeds without a task.

Authorize a bypass:

```text
/planner bypass
```

or via MCP:

```text
planner-authorize-bypass  (default 15 minutes)
```

Revoke:

```text
/planner clear-bypass
planner-clear-bypass
```

The bypass is harness-agnostic (stored in `resume.json`), so Pi, Claude Code, Codex and other adapters all respect it.

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
plugins/
  claude-code/     Claude Code plugin (marketplace bundle)
  codex/           Codex plugin (planned)
  _shared/         single-source-of-truth templates for plugins
.claude-plugin/marketplace.json   self-hosted marketplace catalog (repo root)
scripts/
  release.cjs      unified release helper (pnpm release)
  sync-plugins.cjs regenerate plugin derived files from _shared/
  copy-web-ui.sh   copy Vite build into server/adapter web-ui-dist
```

Important docs:

```text
PROJECT.md
ROADMAP.md
CHECKLIST.md
AGENTS.md
plugins/README.md
plugins/DECISIONS.md
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

For automated MCP smoke testing, use the MCP SDK client to call `listTools`; the expected Phase 1 count is currently 32 public `planner-*` tools.

### Runtime implementation notes

These behaviors are mainly relevant to contributors extending the adapters:

- Pi caches its injected planner context block between turns and rebuilds it only on the first turn or after planner writes. This reduces repeated I/O and large prompt regeneration on steady turns.
- Pi appends a reminder after successful `edit`/`write` work when a task is active, nudging the agent to call `task_complete` when implementation is truly finished.
- The write guard is intentionally harness-agnostic: the shared source of truth is `.planner/resume.json`, not a Pi-only in-memory flag.
- The startup resume summary must mention the dashboard URL when the web UI is active, and must treat handoff targets as hints rather than current focus when nothing is actually in progress.

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

### Bash/Edit/Write is blocked in Claude Code

This is expected if `.planner/` exists, tasks exist, and no task is `in-progress`.

Run:

```text
/planner task start <task-id>
```

Then retry the implementation action.

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

---

## Design principles

- `.planner/` is project-local and explicit.
- Markdown is generated, not the source of truth.
- Core planning logic must remain harness-agnostic.
- Pi, Claude Code, and future agents are adapters over the same planning model.
- Installation should be global/user-level when possible; project initialization should remain explicit.
- Public naming uses `planner-*` for MCP tools and `/planner ...` for human command UX.

---

## Build and publish

This repository is a pnpm workspace. Only some packages are published to npm.

### Packages

**Published (public npm)**:

- `@agent-plan/core` — schemas, persistence, ordering, status rollups, rendering
- `@agent-plan/mcp` — MCP stdio server
- `@agent-plan/server` — local HTTP/WebSocket server
- `agent-plan` — CLI (`init`, `mcp`, `setup claude-code`, `export`, `guard pre-tool-use`)
- `@agent-plan/pi-adapter` — Pi extension adapter

**Private (not published)**:

- `@agent-plan/web-ui` — Vite application, served as a build artifact, not a standalone npm package

### Prerequisites

- Node.js and pnpm installed
- `npm login` performed (or `NPM_TOKEN` configured) on the account that owns the `@agent-plan` scope

### Build and validate

From the repository root:

```bash
pnpm install
pnpm release:validate
```

`release:validate` runs the full build and the TypeScript check:

```bash
pnpm build
pnpm check
```

### Inspect the published tarballs

Before publishing, inspect what would actually be packaged:

```bash
pnpm release:pack-dry-run
```

Important: use `pnpm pack` (or `pnpm release:pack-dry-run`), **not** `npm pack`.

`pnpm pack`/`pnpm publish` rewrite `workspace:*` dependency ranges to the real
published versions inside the tarball. `npm pack` leaves `workspace:*` verbatim,
which makes the resulting tarball uninstallable.

The expected tarball contents for each public package are:

- `dist/**/*.js`, `dist/**/*.d.ts`, `dist/**/*.d.ts.map`
- `README.md`
- `LICENSE`
- `package.json`

`src/`, `tsconfig.json`, and `dist/.tsbuildinfo` must NOT appear in the tarball.

### Publish to npm

Publishing is automated by GitHub Actions. The workflow `.github/workflows/publish.yml` runs **only** on merge of a release PR into `main` (`push: branches:[main]`). It publishes all five public packages in dependency order using `pnpm publish` (which rewrites `workspace:*` ranges to the resolved versions). Merging into `develop` does **not** publish — `develop` is staging.

Do **not** run `npm publish` manually per package: it would publish stale `workspace:*` ranges that npm cannot install.

### Versioning & release

All public packages share a **single unified version** per release. Releases are driven by the `release` script (`scripts/release.cjs`).

From a clean `develop` branch, up to date with `origin`:

```bash
pnpm release              # patch (default)
pnpm release -- minor      # minor
pnpm release -- major      # major
pnpm release -- 1.0.0      # explicit version
pnpm release -- --dry-run  # preview only
```

The script does everything:

1. **Pre-flight** — clean working tree, on `develop`, up to date with `origin/develop`.
2. **Compute the unified target version** — `bump(max(current versions), level)` with a downgrade guard.
3. **Create `release/v<version>`** from `develop` and bump all 5 packages to that version.
4. **Verify** — `pnpm install` + `pnpm -r build` + `pnpm check` (rolls back the branch on failure).
5. **Commit, push, and open a PR → `main`**.

Merge the release PR into `main` to trigger `publish.yml` (npm publish). Then sync `develop`:

```bash
git switch develop && git pull && git merge origin/main && git push
```

See `AGENTS.md` §12 (Branching & Release) for the full rules.

### Install the published CLI

After publishing, end users install once:

```bash
npm install -g agent-plan
```

Then configure an agent harness, e.g. for Claude Code at user scope:

```bash
agent-plan setup claude-code --user
```

Project initialization stays explicit and is done later inside a project with
`/planner init` or `agent-plan init`.
