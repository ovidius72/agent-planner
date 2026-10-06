# OpenCode setup — Agent Plan MCP and /planner command

Agent Plan works in OpenCode v2 through the same stdio MCP server used by
Claude Code and Codex. The CLI setup also adds an OpenCode slash command so
humans can use planner-style commands.

## Install Agent Plan

```bash
npm install -g agent-plan
```

## Configure OpenCode

Project scope:

```bash
agent-plan setup opencode --project
```

User scope:

```bash
agent-plan setup opencode --user
```

Local development from a built checkout:

```bash
agent-plan setup opencode --project --force --local
```

The command writes OpenCode config:

- `mcp.servers.agent-plan` with a local stdio command.
- `command.planner`, which routes `/planner ...` text to Agent Plan MCP tools.
- Flat shortcut aliases such as `/planner-load`, `/planner-task-start`, and
  `/planner-web-status` for OpenCode command autosuggestion.

Agent Plan never auto-starts the planner or web dashboard. Run `/planner load`
when you want the planner context and dashboard.

## Slash commands and autosuggestion

OpenCode command registration exposes one slash command name plus prompt
arguments. Agent Plan therefore supports:

```text
/planner load
/planner task start P001(F001)/T001
/planner web status
```

OpenCode does not currently expose nested segment autosuggestion for every
space-separated `/planner` subcommand. To improve discovery, setup also creates
flat shortcut aliases:

```text
/planner-load
/planner-task-start
/planner-web-status
```

Older slash-path aliases such as `/planner/load` are removed by setup to avoid
duplicate command suggestions.

The generated command templates are intentionally short. They do not embed the
full Agent Plan operating guide on every command invocation; the agent should
read the installed skill or `.planner/SKILL.md` only when deeper routing context
is needed.

## Manual MCP configuration

The equivalent OpenCode config block is:

```json
{
  "mcp": {
    "servers": {
      "agent-plan": {
        "type": "local",
        "command": ["npx", "agent-plan", "mcp"]
      }
    }
  }
}
```

## Public references

- Planner JSON schema: [`planner-schema.json`](./planner-schema.json)
- Claude Code setup: [`setup-claude-code.md`](./setup-claude-code.md)
- Codex setup: [`setup-codex.md`](./setup-codex.md)
- Core package: `@agent-plan/core`
- MCP package: `@agent-plan/mcp`
