#!/usr/bin/env node
import { PlanStore, ExportService, loadCanonicalPlannerSkill, packageVersionFromModule, resolvedPackageVersion, runtimeCapabilities, runtimePackagesDiagnostic, classifyGuardedTool, decideGuardPreToolUse, isEntirelyInsidePlannerRoot, type GuardEventInput } from "@agent-plan/core";
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
  version: boolean;
}

function usage(): string {
  return [
    "agent-plan",
    "",
    "Usage:",
    "  agent-plan --version | -v",
    "  agent-plan version",
    "  agent-plan mcp",
    "  agent-plan init [project name] [--yes]",
    "  agent-plan setup claude-code [--user|--project] [--force] [--local]",
    "  agent-plan setup codex      [--user|--project] [--force] [--local]",
    "  agent-plan export [--full]",
    "",
    "Commands:",
    "  version                     Print loaded package provenance and compatibility capabilities.",
    "  mcp                         Start the stdio MCP server.",
    "  init                        Initialize .planner/ in the current project.",
    "  setup claude-code           Add Agent Plan to Claude Code (project .mcp.json by default, user scope with --user).",
    "  setup codex                 Add Agent Plan to Codex / Copilot CLI (project .codex/mcp.json by default, user scope with --user).",
    "  guard pre-tool-use          Claude Code hook: ask before an edit outside .planner/ when no task is in-progress and no bypass is authorized (read-only commands stay free; .planner/ writes always allowed).",
    "",
    "Options:",
    "  --version, -v               Print the installed agent-plan CLI version.",
    "  --yes, -y                   Accept defaults / initialize when needed.",
    "  --force                     Overwrite existing agent-plan MCP config entry.",
    "  --local                     Write config pointing to this built local CLI instead of npx agent-plan.",
    "  --user                      Install MCP and /planner command at Claude Code or Codex user scope.",
    "  --project                   Install MCP and /planner command in the current project (default).",
  ].join("\n");
}

function cliRuntimeDiagnosticsText(): string {
  const cliPackage = packageVersionFromModule(import.meta.url, "agent-plan");
  const corePackage = resolvedPackageVersion("@agent-plan/core", import.meta.url);
  const mcpPackage = resolvedPackageVersion("@agent-plan/mcp", import.meta.url);
  const packages = runtimePackagesDiagnostic([cliPackage, corePackage, mcpPackage]);
  const capabilities = runtimeCapabilities();
  return [
    "Agent Plan runtime diagnostics",
    "Runtime packages (loaded package manifests):",
    `- ${cliPackage.name}: loaded ${packages[cliPackage.name]?.loadedVersion ?? cliPackage.version}`,
    `- ${corePackage.name}: loaded ${packages[corePackage.name]?.loadedVersion ?? corePackage.version}`,
    `- ${mcpPackage.name}: loaded ${packages[mcpPackage.name]?.loadedVersion ?? mcpPackage.version}`,
    `Plan schema: manifest schemaVersion ${capabilities.planSchema.manifestSchemaVersion}`,
    `Allocation registry: v${capabilities.allocationRegistry.version}; supported kinds: ${capabilities.allocationRegistry.supportedKinds.join(", ")}`,
  ].join("\n");
}

function parseFlags(args: string[]): { positional: string[]; flags: CliFlags } {
  const flags: CliFlags = { yes: false, force: false, local: false, user: false, full: false, version: false };
  const positional: string[] = [];
  for (const arg of args) {
    if (arg === "--version" || arg === "-v") flags.version = true;
    else if (arg === "--yes" || arg === "-y") flags.yes = true;
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

async function plannerCommandTemplate(): Promise<string> {
  const canonicalSkill = await loadCanonicalPlannerSkill();
  const skillBody = canonicalSkill.replace(/^---\n[\s\S]*?\n---\n/, "").trimStart();
  return `---
description: Route Agent Plan planner commands to MCP tools
argument-hint: "load | show | feature | phase | task | handoff | project | web | export | repair | disable"
---

You are handling the Agent Plan slash command for this project.

User command arguments:

\`\`\`
$ARGUMENTS
\`\`\`

Use the Agent Plan MCP tools. Do not treat this as a shell command. Route the requested operation through the exact MCP inventory in the canonical project-local guide below. If arguments are empty, call \`planner-show\` and suggest relevant next commands. Ask one concise clarification when required values are ambiguous.

${skillBody}`;
}

async function writeClaudePlannerCommand(scope: "project" | "user"): Promise<string> {
  const commandDir = scope === "user"
    ? join(homedir(), ".claude", "commands")
    : join(process.cwd(), ".claude", "commands");
  await mkdir(commandDir, { recursive: true });
  const commandPath = join(commandDir, "planner.md");
  await writeFile(commandPath, await plannerCommandTemplate(), "utf-8");
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
    matcher: "Edit|Write|NotebookEdit|Bash",
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

async function setupCodex(flags: CliFlags): Promise<void> {
  const scope = flags.user ? "user" : "project";
  const baseDir = scope === "user" ? join(homedir(), ".codex") : join(process.cwd(), ".codex");
  const settingsPath = join(baseDir, "mcp.json");
  await mkdir(baseDir, { recursive: true });

  const settings = await readJsonFile(settingsPath);
  const currentMcpServers = settings.mcpServers;
  const mcpServers: Record<string, unknown> =
    currentMcpServers && typeof currentMcpServers === "object" && !Array.isArray(currentMcpServers)
      ? { ...(currentMcpServers as Record<string, unknown>) }
      : {};

  if (mcpServers["agent-plan"] && !flags.force) {
    throw new Error(`Codex already has mcpServers.agent-plan in ${settingsPath}. Re-run with --force to overwrite.`);
  }

  mcpServers["agent-plan"] = defaultMcpConfig(flags);
  settings.mcpServers = mcpServers;
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
  console.log(`Configured Codex MCP server in ${settingsPath}`);
  if (!existsSync(plannerRoot())) {
    console.log("Note: .planner/ is not initialized yet. Run `agent-plan init` when you want to enable planning for this project.");
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

/** Build the harness-agnostic guard event from a Claude Code PreToolUse
 * payload. Field names cover both the documented snake_case shape
 * (`tool_name`, `tool_input.file_path`) and a defensive camelCase fallback. */
function guardEventFromClaudeCodePayload(event: Record<string, unknown>, cwd: string, root: string): GuardEventInput {
  const toolInput = (event.tool_input ?? event.toolInput ?? {}) as Record<string, unknown>;
  const stringField = (value: unknown): string | undefined => typeof value === "string" && value ? value : undefined;
  const filePath = stringField(toolInput.file_path ?? toolInput.filePath);
  const notebookPath = stringField(toolInput.notebook_path ?? toolInput.notebookPath);
  const command = stringField(toolInput.command);
  return {
    toolName: String(event.tool_name ?? event.toolName ?? ""),
    cwd,
    plannerRoot: root,
    ...(filePath !== undefined ? { filePath } : {}),
    ...(notebookPath !== undefined ? { notebookPath } : {}),
    ...(command !== undefined ? { command } : {}),
  };
}

async function guardPreToolUse(): Promise<void> {
  const raw = await readStdin();
  let event: Record<string, unknown> = {};
  try {
    event = raw.trim() ? JSON.parse(raw) as Record<string, unknown> : {};
  } catch {
    return;
  }

  const cwd = projectCwd();
  const root = plannerRoot(cwd);
  const guardEvent = guardEventFromClaudeCodePayload(event, cwd, root);

  // Cheap, I/O-free pre-check: tool calls the guard doesn't cover (Read,
  // Grep, MCP calls, read-only Bash, ...) and anything that resolves
  // entirely inside .planner/ are decided from the event alone. Writing a
  // handoff or recording task state must never be blocked or ask, even when
  // no task is in progress — that write IS how an agent reports what it did.
  const classification = classifyGuardedTool(guardEvent);
  if (!classification.guarded || isEntirelyInsidePlannerRoot(classification.paths, root, cwd)) return;

  const st = new PlanStore(root);
  const hasPlannerDir = await st.exists().catch(() => false);
  if (!hasPlannerDir) return;

  let plan;
  try {
    plan = await st.loadAll();
  } catch {
    return;
  }

  const allTasks = plan.phases.flatMap((phase) => phase.tasks.map((task) => ({ phase, task })));
  const hasInProgressTask = allTasks.some(({ task }) => task.status === "in-progress");
  const guardBypassed = await st.isGuardBypassed().catch(() => false);

  const focus = allTasks.find(({ task }) => !["done", "canceled", "rejected"].includes(task.status));
  const startHint = focus
    ? ` Start a task with /planner task start ${focus.task.id} (${focus.task.title}), OR`
    : " Start a task with /planner task start, OR";

  const decision = decideGuardPreToolUse(guardEvent, {
    hasPlannerDir,
    totalTasks: allTasks.length,
    hasInProgressTask,
    guardBypassed,
    startHint,
  });
  if (decision.decision === "allow") return;

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision.decision,
      permissionDecisionReason: decision.reason,
    },
  }));
}

async function main(): Promise<void> {
  const { positional, flags } = parseFlags(process.argv.slice(2));
  const [command, subcommand, ...rest] = positional;

  if (flags.version) {
    const pkg = packageVersionFromModule(import.meta.url, "agent-plan");
    console.log(`${pkg.name} ${pkg.version}`);
    return;
  }

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }

  if (command === "version") {
    console.log(cliRuntimeDiagnosticsText());
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

  if (command === "setup" && subcommand === "codex") {
    await setupCodex(flags);
    return;
  }

  throw new Error(`Unknown command: ${[command, subcommand, ...rest].filter(Boolean).join(" ")}\n\n${usage()}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
