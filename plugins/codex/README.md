# Codex plugin (planned)

Harness-specific plugin bundle for OpenAI Codex (or other Codex-based agents).

## Status

**TBD** — the Codex extension/plugin API needs to be explored before this
plugin can be scaffolded. This directory is a placeholder.

## Plan

When the Codex plugin API is understood, this directory will mirror the
structure of `plugins/claude-code/` (manifest, command/skill routing,
lifecycle hooks, MCP server reference) reusing the shared templates from
`plugins/_shared/` so the `/planner` routing and SessionStart notification
stay consistent across harnesses.

## Reference

- Shared templates: `plugins/_shared/`
- Sibling plugin: `plugins/claude-code/`