# Codex setup — Agent Plan MCP

> Status: Codex support is in early alignment; this doc describes the intended integration using the same MCP stdio server that Claude Code uses.

Agent Plan exposes a stdio MCP server (`agent-plan mcp`) that can be wired to any harness that supports the Model Context Protocol, including Codex once Codex MCP server configuration is available.

## What is configured

The MCP server provides atomic `planner-*` tools for reading and mutating the local `.planner/` workspace:

- `planner-init`
- `planner-show`
- `planner-recap`
- `planner-repair`
- `planner-web` (status / start / stop, LAN-bound dynamic port)
- `planner-feature-list`, `planner-feature-add`, `planner-feature-update`, `planner-feature-delete`
- `planner-phase-list`, `planner-phase-add`, `planner-phase-update`, `planner-phase-delete`
- `planner-task-list`, `planner-task-add`, `planner-task-update`, `planner-task-start`, `planner-task-complete`, `planner-task-delete`
- `planner-handoff-prepare`, `planner-handoff-write`, `planner-handoff-show`, `planner-handoff-clear`
- `planner-authorize-bypass`, `planner-clear-bypass`

## Install Agent Plan

```bash
npm install -g agent-plan
```

## Codex MCP configuration (when supported)

Add the MCP server to Codex settings. The exact file path depends on the Codex release, but the server block is:

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

If Codex supports project-local MCP configuration, place the same block in the target project so it is automatically picked up when `codex` runs from that directory.

## Per-project initialization

Agent Plan does **not** auto-initialize a planner. In a project where you want planning enabled, ask Codex to run:

```text
Run planner-init to set up Agent Plan for this project.
```

This creates:

```text
my-project/
  .planner/
    manifest.json
    project.json
    features.json
    requirements.json
    phases/
    resume.json
```

## Planner root resolution

By default the MCP server uses `.planner/` in the process current working directory. For testing or advanced use:

```bash
AGENT_PLAN_ROOT=/absolute/path/to/.planner agent-plan mcp
```

## Task guard model

Codex MCP hooks are not standardized yet. When Codex exposes a pre-tool-use hook, the same guard script used by Claude Code can be reused:

```bash
agent-plan guard pre-tool-use
```

The guard blocks `Edit`/`Write` unless a task is `in-progress` or a bypass has been authorized. Until Codex exposes such a hook, the guard must be applied at the project policy level or via custom Codex configuration.

## Public references

- Planner JSON schema: [`planner-schema.json`](./planner-schema.json)
- Claude Code setup: [`setup-claude-code.md`](./setup-claude-code.md)
- Zed setup: [`setup-zed.md`](./setup-zed.md)
- Core package: `@agent-plan/core`
- MCP package: `@agent-plan/mcp`
