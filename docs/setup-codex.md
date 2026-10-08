# Codex setup — Agent Plan MCP and skill

Agent Plan works in Codex through the same stdio MCP server used by Claude Code
and OpenCode. Codex sees atomic `planner-*` MCP tools plus `agent-plan` and
`planner` skills that contain the planner operating guide.

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
agent-plan setup codex --user --force
```

Local development from a built checkout:

```bash
agent-plan setup codex --project --force --local
```

The command writes:

- `.codex/config.toml` for project scope, or `~/.codex/config.toml` for user
  scope.
- `.codex/skills/agent-plan/SKILL.md` and `.codex/skills/planner/SKILL.md` for
  project scope, or the same paths under `~/.codex/skills/` for user scope.
- For user scope, the Codex marketplace plugin is also registered and installed
  when the `codex` CLI is available.

Use `--force` to repair an existing Codex install. It rewrites the Agent Plan
MCP entry and removes legacy per-tool approval tables under
`[mcp_servers.agent-plan.tools.*]` that can make Codex ask for permission on
every planner tool call. Restart Codex after setup; existing sessions keep their
already-started MCP process. Verify the loaded runtime from inside Codex with
`planner-version`.

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
`/planner ...` slash commands with segment-level autosuggestion. Use `$planner`
or `$agent-plan` in the skill picker, or natural language prompts such as:

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
- `skills/planner/SKILL.md` — generated alias guide for `$planner`.

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
