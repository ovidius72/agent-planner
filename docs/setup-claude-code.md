# Claude Code setup — Agent Plan MCP

> Status: Phase 1 / Claude Code only

Agent Plan exposes a stdio MCP server for Claude Code and a `/planner` slash command router.

## Recommended user-level setup

Install Agent Plan once, then make it available to Claude Code globally/user-wide:

```bash
npm install -g agent-plan
agent-plan setup claude-code --user
```

This command:

1. registers the `agent-plan` MCP server in Claude Code user scope;
2. creates or updates `~/.claude/commands/planner.md`;
3. creates or updates `~/.claude/settings.json` with a `PreToolUse` task guard hook;
4. makes `/planner ...` available in Claude Code projects.

It does **not** initialize `.planner/` in any project. Project initialization is explicit and happens later with:

```text
/planner init
```

## Per-project initialization

After user-level setup, open any project with Claude Code:

```bash
cd my-project
claude
```

Then initialize Agent Plan only if/when you want planning enabled for that repo:

```text
/planner init
```

This creates:

```text
my-project/.planner/
```

## Project-local setup

For teams or pinned project configs, use project scope from the target project root:

```bash
agent-plan setup claude-code --project
```

This creates or updates:

```text
.mcp.json
.claude/commands/planner.md
```

The generated `.mcp.json` is:

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

Project setup also does **not** initialize `.planner/`. Use `/planner init` when needed.

Project setup also creates `.claude/settings.json` with a `PreToolUse` guard hook for `Bash|Edit|Write`. When `.planner/` exists and tasks exist, the hook blocks implementation tools unless at least one task is `in-progress`.

## Local development setup

When testing from this repository before publishing the npm package:

```bash
pnpm --filter @agent-plan/mcp build
pnpm --filter agent-plan build
node /Users/antonio/projects/agent-plan/packages/agent-plan/dist/index.js setup claude-code --project --local
```

For user-scope local development:

```bash
node /Users/antonio/projects/agent-plan/packages/agent-plan/dist/index.js setup claude-code --user --local
```

## Slash command

The setup creates a `planner.md` command file. This gives Claude Code:

```text
/planner init
/planner show
/planner reload
/planner web status
/planner feature list
/planner feature add Auth flow
/planner task start <id>
/planner task complete <id>
/planner handoff prepare
```

The slash command is a prompt router: it tells Claude Code which `planner-*` MCP tool to call.

## Task guard hook

The setup installs a Claude Code `PreToolUse` hook that checks `Bash|Edit|Write` calls.

Behavior:

- if `.planner/` does not exist, allow;
- if the planner has no tasks, allow;
- if at least one task is `in-progress`, allow;
- otherwise deny the tool call and tell Claude to run `/planner task start <id>` first.

This mirrors the Pi guardrail and keeps phase/feature rollups accurate.

## Other commands

```bash
agent-plan init
agent-plan mcp
agent-plan setup claude-code --user --force
agent-plan setup claude-code --project --force
```

## Public tool names

Claude Code sees atomic `planner-*` MCP tools, for example:

- `planner-init`
- `planner-show`
- `planner-feature-list`
- `planner-feature-add`
- `planner-phase-add`
- `planner-task-start`
- `planner-task-complete`
- `planner-handoff-prepare`
- `planner-handoff-write`

Requirements are intentionally not exposed in Phase 1.

## Planner root resolution

By default, Agent Plan uses `.planner/` in the process current working directory.

Advanced/testing override:

```bash
AGENT_PLAN_ROOT=/absolute/path/to/.planner agent-plan mcp
```

Normal users should not need `AGENT_PLAN_ROOT`.

## Notes

- Pi human UX remains grouped under `/planner ...`.
- Claude Code MCP uses `planner-*` tool names because MCP tools are an agent-facing surface.
- `planner-web` currently returns guidance only; web server lifecycle remains handled by Pi or the plan-server CLI.
- Agent Plan never reads or migrates `.plan/`. That directory belongs to other tools such as GSD.
