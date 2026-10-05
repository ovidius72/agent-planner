# Codex plugin

Codex bundle for Agent Plan. It packages:

- `plugin.json` — portable Agent Plugins manifest.
- `.codex-plugin/plugin.json` — Codex compatibility fallback.
- `mcp.json` / `.mcp.json` — Agent Plan MCP server wiring.
- `skills/agent-plan/SKILL.md` — generated Agent Plan operating guide.

The MCP server uses `npx -y @agent-plan/mcp`, so the plugin does not duplicate
planner logic. The planner and dashboard stay disabled until the user asks the
agent to load the planner.

## Install

Preferred setup from a published npm install:

```bash
agent-plan setup codex --user --force
```

Manual marketplace install:

```bash
codex plugin marketplace add https://github.com/ovidius72/agent-planner --ref main --sparse .agents/plugins --sparse plugins/codex
codex plugin add agent-plan@agent-plan
```

Local checkout install:

```bash
codex plugin marketplace add .
codex plugin add agent-plan@agent-plan
```

Codex exposes this bundle as MCP tools plus the `agent-plan` skill. As of the
current public Codex plugin/config surface, plugins package skills, MCP servers,
and hooks; they do not register custom `/planner ...` slash commands with
segment-level autosuggestion. Use the skill or natural language such as
"load Agent Plan" to route to `planner-load`.
