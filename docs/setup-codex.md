# Codex setup — Agent Plan MCP and skill

Agent Plan works in Codex through the same stdio MCP server used by Claude Code
and OpenCode. Codex sees atomic `planner-*` MCP tools plus an `agent-plan`
skill that contains the planner operating guide.

## Install Agent Plan

```bash
npm install -g agent-plan
```

## Configure Codex

Project scope:

```bash
agent-plan setup codex --project
```

User scope:

```bash
agent-plan setup codex --user
```

Local development from a built checkout:

```bash
agent-plan setup codex --project --force --local
```

The command writes:

- `.codex/config.toml` for project scope, or `~/.codex/config.toml` for user
  scope.
- `.codex/skills/agent-plan/SKILL.md` for project scope, or
  `~/.codex/skills/agent-plan/SKILL.md` for user scope.
- For user scope, the Codex marketplace plugin is also registered and installed
  when the `codex` CLI is available.

The MCP config block is:

```toml
[mcp_servers.agent-plan]
command = "npx"
args = ["agent-plan", "mcp"]
```

With `--local`, `command` becomes `node` and `args` point at the resolved built
CLI path plus `mcp`; the Codex marketplace source is the local repository
checkout.

Agent Plan never auto-starts the planner or web dashboard. Ask Codex to load
Agent Plan when you want planner context; this routes to `planner-load`.

## Slash commands and autosuggestion

Codex plugins/configuration currently expose Agent Plan through MCP tools and
skills. The public Codex plugin/config surface does not register custom
`/planner ...` slash commands with segment-level autosuggestion. Use the
`agent-plan` skill or natural language prompts such as:

```text
Load Agent Plan for this project.
Show the next recommended Agent Plan task.
Start Agent Plan task P001(F001)/T001.
```

Those prompts should route to the corresponding `planner-*` tools.

## Codex plugin bundle

The repository also ships `plugins/codex/`:

- `plugin.json` — portable Agent Plugins manifest.
- `.codex-plugin/plugin.json` — Codex compatibility fallback.
- `mcp.json` / `.mcp.json` — Agent Plan MCP server wiring through
  `npx -y @agent-plan/mcp`.
- `skills/agent-plan/SKILL.md` — generated Agent Plan operating guide.

Codex discovers that bundle through the repo-root marketplace catalog:

```text
.agents/plugins/marketplace.json
```

Manual install equivalent:

```bash
codex plugin marketplace add https://github.com/ovidius72/agent-planner --ref main --sparse .agents/plugins --sparse plugins/codex
codex plugin add agent-plan@agent-plan
```

For local development from this repository:

```bash
codex plugin marketplace add .
codex plugin add agent-plan@agent-plan
```

## Planner root resolution

By default the MCP server uses `.planner/` in the process current working
directory. For testing or advanced use:

```bash
AGENT_PLAN_ROOT=/absolute/path/to/.planner agent-plan mcp
```

## Task guard model

Codex does not currently expose the same project-level `PreToolUse` hook that
Claude Code uses. The Agent Plan guard remains available as:

```bash
agent-plan guard pre-tool-use
```

The guard never blocks: when a call changes project code while no task is
`in-progress` and no bypass is authorized, it only warns the agent.

## Public references

- Planner JSON schema: [`planner-schema.json`](./planner-schema.json)
- Claude Code setup: [`setup-claude-code.md`](./setup-claude-code.md)
- OpenCode setup: [`setup-opencode.md`](./setup-opencode.md)
- Core package: `@agent-plan/core`
- MCP package: `@agent-plan/mcp`
