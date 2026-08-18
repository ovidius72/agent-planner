# Zed setup — Agent Plan MCP

Agent Plan works in Zed through the same stdio MCP server used by Claude Code and Codex. No Zed extension is required; you add `@agent-plan/mcp` as a custom/local context server in Zed settings.

## What is configured

Zed's Agent Panel sees atomic `planner-*` tools:

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

## Add the context server in Zed

Open Zed settings (`zed: open settings file`) and add:

```json
{
  "context_servers": {
    "agent-plan": {
      "command": "npx",
      "args": ["agent-plan", "mcp"],
      "env": {}
    }
  }
}
```

Then open **Settings → AI → MCP Servers**. The `agent-plan` server should show a green dot and tooltip **"Server is active"**.

## Per-project initialization

Agent Plan does **not** auto-initialize a planner. In a project where you want planning enabled, ask the Zed Agent:

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

By default the MCP server uses `.planner/` in the process current working directory (the project opened in Zed). For testing or advanced use:

```bash
AGENT_PLAN_ROOT=/absolute/path/to/.planner agent-plan mcp
```

In Zed settings you can pass the same override through `env`:

```json
{
  "context_servers": {
    "agent-plan": {
      "command": "npx",
      "args": ["agent-plan", "mcp"],
      "env": {
        "AGENT_PLAN_ROOT": "/absolute/path/to/.planner"
      }
    }
  }
}
```

## Using the planner in Zed Agent Panel

Once the server is active, mention the planner by name when you need it, for example:

```text
Run planner-show to see the current project state.
Run planner-task-start on the Zed integration task.
Run planner-handoff-write to capture the current work context.
```

Zed currently supports MCP **Tools** and **Prompts** only. The Agent Plan MCP server exposes only tools, which is the correct surface for Zed.

### Encourage the agent to use planner tools

Zed's agent may prefer its built-in file tools over MCP tools. To force planner-only tooling for a specific workflow, create a custom agent profile in settings:

```json
{
  "agent": {
    "profiles": {
      "agent-plan": {
        "name": "Agent Plan",
        "tools": {
          "fetch": true,
          "copy_path": false,
          "find_path": false,
          "delete_path": false,
          "create_directory": false,
          "list_directory": false,
          "diagnostics": false,
          "read_file": false,
          "move_path": false,
          "grep": false,
          "edit_file": false,
          "terminal": false
        },
        "enable_all_context_servers": false,
        "context_servers": {
          "agent-plan": {
            "tools": {
              "planner-init": true,
              "planner-show": true,
              "planner-recap": true,
              "planner-feature-list": true,
              "planner-feature-add": true,
              "planner-phase-list": true,
              "planner-phase-add": true,
              "planner-task-list": true,
              "planner-task-start": true,
              "planner-task-complete": true,
              "planner-handoff-write": true,
              "planner-web": true
            }
          }
        }
      }
    }
  }
}
```

Use this profile when you want the agent to plan and operate exclusively through the planner tools.

## Task guard model

Zed does not currently expose a project-level `PreToolUse` hook. The same guard used by Claude Code can be applied manually from the terminal if desired:

```bash
agent-plan guard pre-tool-use
```

This blocks `Edit`/`Write` operations unless a task is `in-progress` or a bypass is active. Until Zed exposes an equivalent hook, enforcement remains manual or policy-based.

## Reloading the server after updates

`npx agent-plan mcp` always fetches the latest published `agent-plan` from npm. If the tool list changes, the server emits the MCP `notifications/tools/list_changed` notification and Zed reloads the tool list automatically.

## Public references

- Planner JSON schema: [`planner-schema.json`](./planner-schema.json)
- Claude Code setup: [`setup-claude-code.md`](./setup-claude-code.md)
- Codex setup: [`setup-codex.md`](./setup-codex.md)
- Core package: `@agent-plan/core`
- MCP package: `@agent-plan/mcp`
