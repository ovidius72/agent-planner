# Plugins

Harness-specific bundles for Agent Plan. Each subdirectory is a self-contained
plugin for a coding-agent harness (Claude Code, Codex, ...). Plugins are static
bundles (JSON + Markdown + shell) and are **not** npm packages — the reusable
libraries live in `packages/` and are published to npm; plugins reference them.

## Index

| Plugin | Harness | Status | Install |
|---|---|---|---|
| `claude-code/` | Claude Code | ready | `/plugin marketplace add ovidius72/agent-planner` → `/plugin install agent-plan@agent-plan-marketplace` |
| `codex/` | Codex | ready | `agent-plan setup codex --user --force` or `codex plugin add agent-plan@agent-plan` |
| `opencode/` | OpenCode | ready | `agent-plan setup opencode` |
| `_shared/` | — | shared templates | consumed by plugins at build/sync time |

## Distribution model

We use self-hosted marketplaces:

### Claude Code

1. `.claude-plugin/marketplace.json` (at the **repo root**) lists the
   `agent-plan` plugin and points to its source at `./plugins/claude-code`.
2. Users add the marketplace:
   `/plugin marketplace add ovidius72/agent-planner`
3. Users install the plugin:
   `/plugin install agent-plan@agent-plan-marketplace`
4. Updates: push to the repo; users run `/plugin marketplace update`.

> Note: per the Claude Code plugin spec, `marketplace.json` must live at the
> repo root in `.claude-plugin/`, not inside the plugin directory.

### Codex

1. `.agents/plugins/marketplace.json` (at the **repo root**) lists the
   `agent-plan` plugin and points to its source at `./plugins/codex`.
2. `agent-plan setup codex --user --force` registers and installs the Codex
   marketplace plugin when the `codex` CLI is available.
3. Manual equivalent:

```bash
codex plugin marketplace add https://github.com/ovidius72/agent-planner --ref main --sparse .agents/plugins --sparse plugins/codex
codex plugin add agent-plan@agent-plan
```

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
├── codex/                         # Codex plugin
│   ├── plugin.json
│   ├── .codex-plugin/plugin.json
│   ├── mcp.json
│   ├── .mcp.json
│   ├── skills/agent-plan/SKILL.md
│   ├── skills/planner/SKILL.md
│   └── README.md
├── opencode/                      # OpenCode plugin/config bundle
│   ├── skills/agent-plan/SKILL.md
│   └── README.md
└── _shared/                       # shared templates (single source of truth)
    ├── planner-skill.md.in
    └── notify-session-start.sh.in
```

The **marketplace** lives at the repo root (not under `plugins/`):

```
.claude-plugin/marketplace.json   # lists the agent-plan plugin → ./plugins/claude-code
.agents/plugins/marketplace.json  # lists the agent-plan plugin → ./plugins/codex
```

## Development / local testing

```
claude --plugin-dir ./plugins/claude-code --debug
```

## Syncing shared content

`scripts/sync-plugins.cjs` regenerates each plugin's
`skills/planner/SKILL.md` or `skills/agent-plan/SKILL.md`,
`scripts/notify-session-start.sh`, and `scripts/guard-pre-tool-use.sh` from the
templates in `_shared/`, so planner routing, the SessionStart notification, and
the PreToolUse guard have a single source of truth across harnesses.

```
pnpm plugins:sync     # regenerate derived files
pnpm plugins:check     # CI drift guard (fails if derived files are out of sync)
```
