# OpenCode plugin

OpenCode bundle for Agent Plan. OpenCode v2 can route slash commands through
project or user configuration, so `agent-plan setup opencode` is the preferred
install path:

```bash
agent-plan setup opencode --project
agent-plan setup opencode --user --force --local
```

The setup command writes:

- `mcp.servers.agent-plan` using the same stdio MCP server as Claude Code and
  Codex.
- `commands.planner`, so `/planner load`, `/planner task start ...`, and the
  rest of the planner command text route to Agent Plan MCP tools.
- Flat discovery shortcuts such as `/planner-load`, `/planner-task-start`, and
  `/planner-web-status` for OpenCode command autosuggestion.

OpenCode's v2 command API registers a single slash command name with prompt
arguments. It does not expose nested segment-level autosuggestion for a command
shape like `/planner task start <ref>`, so Agent Plan provides flat aliases for
the common planner paths.

The generated `skills/agent-plan/SKILL.md` mirrors the canonical planner guide
for users or plugin package maintainers who want to include the workflow guide
alongside OpenCode commands.
