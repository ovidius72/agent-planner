#!/usr/bin/env node
import { PlanStore, ExportService } from "@agent-plan/core";
import { startStdioServer } from "@agent-plan/mcp";
import { basename, dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

interface CliFlags {
  yes: boolean;
  force: boolean;
  local: boolean;
  user: boolean;
  full: boolean;
}

function usage(): string {
  return [
    "agent-plan",
    "",
    "Usage:",
    "  agent-plan mcp",
    "  agent-plan init [project name] [--yes]",
    "  agent-plan setup claude-code [--user|--project] [--force] [--local]",
    "  agent-plan export [--full]",
    "",
    "Commands:",
    "  mcp                         Start the stdio MCP server.",
    "  init                        Initialize .planner/ in the current project.",
    "  setup claude-code           Add Agent Plan to Claude Code (project .mcp.json by default, user scope with --user).",
    "  guard pre-tool-use          Claude Code hook: block Edit/Write unless a task is in-progress or a bypass is authorized (bash stays free).",
    "",
    "Options:",
    "  --yes, -y                   Accept defaults / initialize when needed.",
    "  --force                     Overwrite existing agent-plan MCP config entry.",
    "  --local                     Write config pointing to this built local CLI instead of npx agent-plan.",
    "  --user                      Install MCP and /planner command at Claude Code user scope.",
    "  --project                   Install MCP and /planner command in the current project (default).",
  ].join("\n");
}

function parseFlags(args: string[]): { positional: string[]; flags: CliFlags } {
  const flags: CliFlags = { yes: false, force: false, local: false, user: false, full: false };
  const positional: string[] = [];
  for (const arg of args) {
    if (arg === "--yes" || arg === "-y") flags.yes = true;
    else if (arg === "--force") flags.force = true;
    else if (arg === "--local") flags.local = true;
    else if (arg === "--user") flags.user = true;
    else if (arg === "--project") flags.user = false;
    else if (arg === "--full") flags.full = true;
    else positional.push(arg);
  }
  return { positional, flags };
}

function projectCwd(): string {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

function plannerRoot(cwd = projectCwd()): string {
  return join(cwd, ".planner");
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function initPlanner(projectNameArg: string | undefined, flags: CliFlags): Promise<void> {
  const root = plannerRoot();
  const st = new PlanStore(root);
  st.enableAutoSync(true);
  if (await st.exists()) {
    console.log(`.planner/ already exists at ${root}`);
    return;
  }

  let projectName = projectNameArg?.trim();
  if (!projectName) {
    projectName = flags.yes ? basename(process.cwd()) : await prompt(`Project name [${basename(process.cwd())}]: `);
  }
  if (!projectName) projectName = basename(process.cwd());

  await st.init(projectName);
  await st.writeGenerated();
  console.log(`Initialized .planner/ for "${projectName}" at ${root}`);
}

async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  if (!existsSync(path)) return {};
  const raw = await readFile(path, "utf-8");
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function localCliPath(): string {
  return resolve(process.argv[1] ?? "packages/agent-plan/dist/index.js");
}

function localCliArgs(): string[] {
  return [localCliPath(), "mcp"];
}

function defaultMcpConfig(flags: CliFlags): Record<string, unknown> {
  if (flags.local) {
    return {
      command: "node",
      args: localCliArgs(),
    };
  }
  return {
    command: "npx",
    args: ["agent-plan", "mcp"],
  };
}

function plannerCommandTemplate(): string {
  return `---
description: Route Agent Plan planner commands to MCP tools
argument-hint: "init | show | reload | load | recap | disable | repair | export [--full] | web <status|start|stop> | feature <list|add|show|update|delete> | phase <add|show|discuss|update|delete> | task <add|show|discuss|update|delete|start|complete> | handoff <prepare|show|write|clear> | project <discuss|language> | bypass | clear-bypass"
---

You are handling the Agent Plan slash command for this project.

User command arguments:

\`\`\`
$ARGUMENTS
\`\`\`

Use the Agent Plan MCP tools. Do not treat this as a shell command.

Route common commands as follows:

- \`init\` → call \`planner-init\`; if required fields are missing, ask for a concise project name first
- \`show\` → call \`planner-show\`
- \`reload\` → call \`planner-load\`, then present the returned recap to the user (state, active task, pending handoff, web URL)
- \`load\` → call \`planner-load\`; it starts the web dashboard on LAN and returns a consolidated recap. Present the recap to the user **in this reply only**. If a pending handoff is included in the result, read it, summarize it to the user, then call \`planner-handoff-clear\` to remove it. End **this recap reply** with a prominent final line showing the web URL, e.g. \`🌐 Web UI: <url>\`. Do NOT show the web URL in any other reply, and do NOT start the planner/web unless the user runs \`load\`/\`recap\`/\`web status\`.
- \`recap\` → call \`planner-load\` (same as \`load\`: returns the recap + handoff + web URL); present it to the user
- \`disable\` → call \`planner-disable\`
- \`repair\` → call \`planner-repair\`
- \`bypass\` → call \`planner-authorize-bypass\` (default 15 min); only when the user authorizes proceeding without a task
- \`clear-bypass\` → call \`planner-clear-bypass\`
- \`export\` → call \`planner-export\` with \`full=false\`
- \`export --full\`, \`export full\`, or \`export-full\` → call \`planner-export\` with \`full=true\`
- \`web\`, \`web status\`, \`web start\`, \`web stop\` → call \`planner-web\` with action \`status\`, \`start\`, or \`stop\`; default to \`status\`
- \`project discuss\` → call \`planner-project-discuss\` after asking for any missing project fields
- \`project language\` → call \`planner-project-language\`
- \`feature list\` → call \`planner-feature-list\`
- \`feature add <name>\` → call \`planner-feature-add\`
- \`feature show <id|name>\` → call \`planner-feature-show\`
- \`feature update <id|name>\` → call \`planner-feature-update\`
- \`feature delete <id|name>\` → call \`planner-feature-delete\`
- \`phase add <title>\` → call \`planner-phase-add\`
- \`phase show <id|name>\` → call \`planner-phase-show\`
- \`phase discuss <id|name>\` → call \`planner-phase-discuss\` after asking for any missing discovery details
- \`phase update <id|name>\` → call \`planner-phase-update\`
- \`phase delete <id|name>\` → call \`planner-phase-delete\`
- \`task add <phase> <title>\` → call \`planner-task-add\`
- \`task show <id|name>\` → call \`planner-task-show\`
- \`task discuss <id|name>\` → call \`planner-task-discuss\`
- \`task update <id|name>\` → call \`planner-task-update\`
- \`task delete <id|name>\` → call \`planner-task-delete\`
- \`task start <id|name>\` → call \`planner-task-start\`
- \`task complete <id|name>\` → call \`planner-task-complete\`
- \`handoff prepare\` → call \`planner-handoff-prepare\`, then draft the handoff and call \`planner-handoff-write\`
- \`handoff show\` → call \`planner-handoff-show\`
- \`handoff write\` → call \`planner-handoff-write\` after drafting or asking for content
- \`handoff clear\` → call \`planner-handoff-clear\`

If arguments are empty, call \`planner-show\` and then list suggested next planner commands.
If the command is ambiguous or missing required values, ask one concise clarification before calling tools.
Requirements are internal in Phase 1: do not invent \`planner-requirement-*\` commands.
`;
}

async function writeClaudePlannerCommand(scope: "project" | "user"): Promise<string> {
  const commandDir = scope === "user"
    ? join(homedir(), ".claude", "commands")
    : join(process.cwd(), ".claude", "commands");
  await mkdir(commandDir, { recursive: true });
  const commandPath = join(commandDir, "planner.md");
  await writeFile(commandPath, plannerCommandTemplate(), "utf-8");
  return commandPath;
}

function mcpCommandParts(flags: CliFlags): { command: string; args: string[] } {
  const config = defaultMcpConfig(flags);
  return {
    command: String(config.command),
    args: Array.isArray(config.args) ? config.args.map(String) : [],
  };
}

function guardHookCommand(flags: CliFlags): { command: string; args: string[] } {
  if (flags.local) return { command: "node", args: [localCliPath(), "guard", "pre-tool-use"] };
  return { command: "npx", args: ["agent-plan", "guard", "pre-tool-use"] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAgentPlanGuardHook(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const command = String(value.command ?? "");
  const args = Array.isArray(value.args) ? value.args.map(String) : [];
  return args.includes("guard") && args.includes("pre-tool-use") && (command === "npx" || command === "node" || command === "agent-plan");
}

async function writeClaudeTaskGuard(scope: "project" | "user", flags: CliFlags): Promise<string> {
  const settingsPath = scope === "user"
    ? join(homedir(), ".claude", "settings.json")
    : join(process.cwd(), ".claude", "settings.json");
  await mkdir(dirname(settingsPath), { recursive: true });

  const settings = await readJsonFile(settingsPath);
  const hooksRoot = isRecord(settings.hooks) ? { ...settings.hooks } : {};
  const preToolUse = Array.isArray(hooksRoot.PreToolUse) ? [...hooksRoot.PreToolUse] : [];
  const { command, args } = guardHookCommand(flags);

  const cleaned = preToolUse.map((group) => {
    if (!isRecord(group)) return group;
    const hooks = Array.isArray(group.hooks) ? group.hooks.filter((hook) => !isAgentPlanGuardHook(hook)) : group.hooks;
    return { ...group, hooks };
  }).filter((group) => !(isRecord(group) && Array.isArray(group.hooks) && group.hooks.length === 0));

  cleaned.push({
    matcher: "Edit|Write",
    hooks: [
      {
        type: "command",
        command,
        args,
        timeout: 10,
        statusMessage: "Checking Agent Plan task status",
      },
    ],
  });

  hooksRoot.PreToolUse = cleaned;
  settings.hooks = hooksRoot;
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
  return settingsPath;
}

function setupClaudeCodeUser(flags: CliFlags): void {
  const { command, args } = mcpCommandParts(flags);
  if (flags.force) {
    spawnSync("claude", ["mcp", "remove", "agent-plan", "--scope", "user"], { stdio: "ignore" });
  }
  const result = spawnSync("claude", ["mcp", "add", "agent-plan", "--scope", "user", "--", command, ...args], { stdio: "inherit" });
  if (result.error || result.status !== 0) {
    const manual = `claude mcp add agent-plan --scope user -- ${[command, ...args].join(" ")}`;
    throw new Error(`Failed to register Claude Code user-scope MCP server. Run manually:\n${manual}`);
  }
}

async function setupClaudeCodeProject(flags: CliFlags): Promise<string> {
  const settingsPath = join(process.cwd(), ".mcp.json");
  const settings = await readJsonFile(settingsPath);
  const currentMcpServers = settings.mcpServers;
  const mcpServers: Record<string, unknown> = currentMcpServers && typeof currentMcpServers === "object" && !Array.isArray(currentMcpServers)
    ? { ...(currentMcpServers as Record<string, unknown>) }
    : {};

  if (mcpServers["agent-plan"] && !flags.force) {
    throw new Error(`Claude Code already has mcpServers.agent-plan in ${settingsPath}. Re-run with --force to overwrite.`);
  }

  mcpServers["agent-plan"] = defaultMcpConfig(flags);
  settings.mcpServers = mcpServers;
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
  return settingsPath;
}

async function setupClaudeCode(flags: CliFlags): Promise<void> {
  if (flags.user) {
    setupClaudeCodeUser(flags);
    const commandPath = await writeClaudePlannerCommand("user");
    const hookPath = await writeClaudeTaskGuard("user", flags);
    console.log(`Configured Claude Code user-scope slash command in ${commandPath}`);
    console.log(`Configured Claude Code user-scope task guard hook in ${hookPath}`);
    console.log(flags.local ? "Mode: local built CLI" : "Mode: agent-plan mcp");
    return;
  }

  const settingsPath = await setupClaudeCodeProject(flags);
  const commandPath = await writeClaudePlannerCommand("project");
  const hookPath = await writeClaudeTaskGuard("project", flags);
  console.log(`Configured Claude Code project MCP server in ${settingsPath}`);
  console.log(`Configured Claude Code project slash command in ${commandPath}`);
  console.log(`Configured Claude Code project task guard hook in ${hookPath}`);
  if (!existsSync(plannerRoot())) {
    console.log("Note: .planner/ is not initialized yet. In Claude Code, run `/planner init` when you want to enable planning for this project.");
  }
  console.log(flags.local ? "Mode: local built CLI" : "Mode: npx agent-plan mcp");
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function guardPreToolUse(): Promise<void> {
  const raw = await readStdin();
  let event: Record<string, unknown> = {};
  try {
    event = raw.trim() ? JSON.parse(raw) as Record<string, unknown> : {};
  } catch {
    return;
  }

  const toolName = String(event.tool_name ?? event.toolName ?? "");
  // Guard only the code-writing tools (Edit/Write). Bash stays free so that
  // git pull, build, test, ls, etc. always work. This mirrors the Pi adapter.
  if (toolName !== "Edit" && toolName !== "Write") return;

  const root = plannerRoot();
  const st = new PlanStore(root);
  if (!(await st.exists().catch(() => false))) return;

  let plan;
  try {
    plan = await st.loadAll();
  } catch {
    return;
  }

  const allTasks = plan.phases.flatMap((phase) => phase.tasks.map((task) => ({ phase, task })));
  if (allTasks.length === 0) return; // nothing to enforce yet
  if (allTasks.some(({ task }) => task.status === "in-progress")) return; // a task is open → allow
  if (await st.isGuardBypassed().catch(() => false)) return; // user authorized → allow

  const focus = allTasks.find(({ task }) => !["done", "canceled", "rejected"].includes(task.status));
  const startHint = focus
    ? ` Start a task with /planner task start ${focus.task.id} (${focus.task.title}), OR`
    : " Start a task with /planner task start, OR";
  const reason = `Agent Plan guard: no task is in-progress, so ${toolName} is blocked.${startHint} ask the user to authorize a one-time bypass (they can run /planner bypass, or you can call planner-authorize-bypass). After authorization, ${toolName} will be allowed for a short window.`;

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }));
}

async function main(): Promise<void> {
  const { positional, flags } = parseFlags(process.argv.slice(2));
  const [command, subcommand, ...rest] = positional;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }

  if (command === "mcp") {
    await startStdioServer();
    return;
  }

  if (command === "guard" && subcommand === "pre-tool-use") {
    await guardPreToolUse();
    return;
  }

  if (command === "export") {
    const isFull = flags.full || positional.includes("--full");
    const root = plannerRoot();
    const st = new PlanStore(root);
    if (!(await st.exists())) {
      console.error("No .planner/ found. Run agent-plan init first.");
      process.exit(1);
    }
    const plan = await st.loadAll();
    const exportService = new ExportService();
    const markdown = exportService.exportToMarkdown(plan, isFull);

    const fs = await import("node:fs/promises");
    await fs.writeFile(join(root, "EXPORT.md"), markdown, "utf-8");

    console.log(markdown);
    console.log(`\nExport saved to ${join(root, "EXPORT.md")}`);
    return;
  }

  if (command === "init") {
    await initPlanner([subcommand, ...rest].filter(Boolean).join(" ") || undefined, flags);
    return;
  }

  if (command === "setup" && subcommand === "claude-code") {
    await setupClaudeCode(flags);
    return;
  }

  throw new Error(`Unknown command: ${[command, subcommand, ...rest].filter(Boolean).join(" ")}\n\n${usage()}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
