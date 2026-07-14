# Shared templates for Agent Plan plugins

These templates are the **single source of truth** for content reused across
harness-specific plugins. A sync script regenerates each plugin's derived
files from these templates, so the `/planner` command routing and the
SessionStart notification stay consistent across Claude Code, Codex, and
future harnesses.

## Files

- `planner-skill.md.in` — template for the `/planner` skill (command routing
  to MCP tools). Consumed by `skills/planner/SKILL.md` in each plugin.
- `notify-session-start.sh.in` — template for the SessionStart notification
  script. Consumed by `scripts/notify-session-start.sh` in each plugin.

## Placeholders

Templates use `{{HARNESS}}` and `{{LOAD_COMMAND}}` tokens that the sync script
substitutes per harness (e.g. `Claude Code` / `/planner load`).

## Sync

```
node scripts/sync-plugins.sh
```

Regenerates derived files in every plugin directory under `plugins/`.