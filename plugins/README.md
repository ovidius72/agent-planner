# Plugins

Harness-specific bundles for Agent Plan. Each subdirectory is a self-contained
plugin for a coding-agent harness (Claude Code, Codex, ...). Plugins are static
bundles (JSON + Markdown + shell) and are **not** npm packages — the reusable
libraries live in `packages/` and are published to npm; plugins reference them.

## Index

| Plugin | Harness | Status | Install |
|---|---|---|---|
| `claude-code/` | Claude Code | scaffold | `/plugin marketplace add ovidius72/agent-planner` → `/plugin install agent-plan@agent-plan-marketplace` |
| `codex/` | Codex | planned (TBD) | TBD — Codex extension API |
| `_shared/` | — | shared templates | consumed by plugins at build/sync time |

## Distribution model

We use a **self-hosted marketplace** (no Anthropic approval required):

1. `.claude-plugin/marketplace.json` (at the **repo root**) lists the
   `agent-plan` plugin and points to its source at `./plugins/claude-code`.
2. Users add the marketplace:
   `/plugin marketplace add ovidius72/agent-planner`
3. Users install the plugin:
   `/plugin install agent-plan@agent-plan-marketplace`
4. Updates: push to the repo; users run `/plugin marketplace update`.

> Note: per the Claude Code plugin spec, `marketplace.json` must live at the
> repo root in `.claude-plugin/`, not inside the plugin directory.

Optional future step: submit to the official `claude-plugins-official`
directory via the Anthropic submission form for maximum reach (requires public
repo, `claude plugin validate` green, automated review). Not required for
functionality.

## Layout convention

```
plugins/
├── README.md                      # this index
├── claude-code/                   # Claude Code plugin
│   ├── .claude-plugin/plugin.json
│   ├── .mcp.json
│   ├── skills/planner/SKILL.md
│   ├── hooks/hooks.json
│   ├── scripts/notify-session-start.sh
│   └── README.md
├── codex/                         # Codex plugin (TBD)
│   └── README.md
└── _shared/                       # shared templates (single source of truth)
    ├── planner-skill.md.in
    └── notify-session-start.sh.in
```

The **marketplace** lives at the repo root (not under `plugins/`):

```
.claude-plugin/marketplace.json   # lists the agent-plan plugin → ./plugins/claude-code
```

## Development / local testing

```
claude --plugin-dir ./plugins/claude-code --debug
```

## Syncing shared content

`scripts/sync-plugins.sh` (planned) regenerates each plugin's
`skills/planner/SKILL.md` and `scripts/notify-session-start.sh` from the
templates in `_shared/`, so the `/planner` command routing and the
SessionStart notification have a single source of truth across harnesses.