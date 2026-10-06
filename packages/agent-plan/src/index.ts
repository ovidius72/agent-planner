#!/usr/bin/env node
import { PlanStore, ExportService, loadCanonicalPlannerSkill, packageVersionFromModule, resolvedPackageVersion, runtimeCapabilities, runtimePackagesDiagnostic, classifyGuardedTool, loadNoTaskGuardState, noTaskWarning, type GuardEventInput } from "@agent-plan/core";
import { startStdioServer } from "@agent-plan/mcp";
import { basename, dirname, join, resolve } from "node:path";
import { existsSync, realpathSync } from "node:fs";
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
    "  agent-plan setup opencode   [--user|--project] [--force] [--local]",
    "  agent-plan export [--full]",
    "",
    "Commands:",
    "  version                     Print loaded package provenance and compatibility capabilities.",
    "  mcp                         Start the stdio MCP server.",
    "  init                        Initialize .planner/ in the current project.",
    "  setup claude-code           Add Agent Plan to Claude Code (project .mcp.json by default, user scope with --user).",
    "  setup codex                 Add Agent Plan to Codex (project .codex/config.toml by default, user scope with --user).",
    "  setup opencode              Add Agent Plan to OpenCode (project opencode.json by default, user scope with --user).",
    "  guard pre-tool-use          Claude Code hook: warn the agent (never block or prompt) when a call changes project code while no task is in-progress. Planner changes and writes outside the project never warn.",
    "",
    "Options:",
    "  --version, -v               Print the installed agent-plan CLI version.",
    "  --yes, -y                   Accept defaults / initialize when needed.",
    "  --force                     Overwrite existing agent-plan MCP config entry.",
    "  --local                     Write config pointing to this built local CLI instead of npx agent-plan.",
    "  --user                      Install MCP and planner routing at harness user scope.",
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

async function writeJsonFile(path: string, value: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

/** The CLI's own file, with links followed. Version managers such as fnm
 * start it through a link in a per-shell temp folder that disappears later,
 * so saving that link into a hook or MCP config breaks it. */
function localCliPath(): string {
  const path = resolve(process.argv[1] ?? "packages/agent-plan/dist/index.js");
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
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

async function codexSkillTemplate(skillName = "agent-plan"): Promise<string> {
  const canonicalSkill = await loadCanonicalPlannerSkill();
  return canonicalSkill
    .replace(/^name: .+$/m, `name: ${skillName}`)
    .replace(/^summary:/m, "description:");
}

async function opencodePlannerCommandTemplate(command = "$ARGUMENTS"): Promise<string> {
  return `Use the Agent Plan MCP tools to handle this planner command:

\`\`\`
/planner ${command}
\`\`\`

Do not treat this as a shell command. Route the requested operation through the installed Agent Plan MCP tools. If the command is empty, call planner-show and suggest relevant next commands. Ask one concise clarification when required values are ambiguous.

Use the installed Agent Plan skill or the project-local .planner/SKILL.md only when you need deeper routing rules; do not paste or recap that guide in the response.`;
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

async function writeCodexSkills(scope: "project" | "user"): Promise<string[]> {
  const skillsRoot = scope === "user"
    ? join(homedir(), ".codex", "skills")
    : join(process.cwd(), ".codex", "skills");
  const written: string[] = [];
  for (const skillName of ["agent-plan", "planner"]) {
    const skillDir = join(skillsRoot, skillName);
    await mkdir(skillDir, { recursive: true });
    const skillPath = join(skillDir, "SKILL.md");
    await writeFile(skillPath, await codexSkillTemplate(skillName), "utf-8");
    written.push(skillPath);
  }
  return written;
}

function mcpCommandParts(flags: CliFlags): { command: string; args: string[] } {
  const config = defaultMcpConfig(flags);
  return {
    command: String(config.command),
    args: Array.isArray(config.args) ? config.args.map(String) : [],
  };
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function codexMcpTomlBlock(flags: CliFlags): string {
  const { command, args } = mcpCommandParts(flags);
  return [
    "[mcp_servers.agent-plan]",
    `command = ${tomlString(command)}`,
    `args = ${tomlStringArray(args)}`,
  ].join("\n");
}

async function readTextFile(path: string): Promise<string> {
  if (!existsSync(path)) return "";
  return readFile(path, "utf-8");
}

function upsertTomlTable(path: string, text: string, tableName: string, block: string, force: boolean): string {
  const lines = text.split(/\r?\n/);
  const header = `[${tableName}]`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start !== -1 && !force) {
    throw new Error(`${path} already has ${header}. Re-run with --force to overwrite.`);
  }
  let nextHeader = lines.length;
  if (start !== -1) {
    for (let i = start + 1; i < lines.length; i += 1) {
      if (/^\s*\[/.test(lines[i] ?? "")) {
        nextHeader = i;
        break;
      }
    }
  }
  const before = start === -1 ? lines : lines.slice(0, start);
  const after = start === -1 ? [] : lines.slice(nextHeader);
  const trimmedBefore = before.join("\n").trimEnd();
  const trimmedAfter = after.join("\n").trimStart();
  return [
    trimmedBefore,
    block,
    trimmedAfter,
  ].filter(Boolean).join("\n\n") + "\n";
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
  const settingsPath = join(baseDir, "config.toml");
  await mkdir(baseDir, { recursive: true });

  const current = await readTextFile(settingsPath);
  const next = upsertTomlTable(settingsPath, current, "mcp_servers.agent-plan", codexMcpTomlBlock(flags), flags.force);
  await writeFile(settingsPath, next, "utf-8");
  const skillPaths = await writeCodexSkills(scope);
  const pluginStatus = scope === "user"
    ? setupCodexMarketplacePlugin(flags)
    : "Codex plugin marketplace installation is user-scoped; run `agent-plan setup codex --user --force` to install the plugin.";

  console.log(`Configured Codex MCP server in ${settingsPath}`);
  console.log(`Configured Codex Agent Plan skills in ${skillPaths.join(", ")}`);
  console.log(pluginStatus);
  console.log("Codex exposes Agent Plan through MCP tools plus the agent-plan/planner plugin skills. Custom /planner slash-command registration is not part of the public Codex plugin/config surface.");
  if (!existsSync(plannerRoot())) {
    console.log("Note: .planner/ is not initialized yet. Run `agent-plan init` when you want to enable planning for this project.");
  }
  console.log(flags.local ? "Mode: local built CLI" : "Mode: npx agent-plan mcp");
}

function opencodeConfigPath(scope: "project" | "user"): string {
  return scope === "user"
    ? join(homedir(), ".config", "opencode", "opencode.json")
    : join(process.cwd(), "opencode.json");
}

const OPENCODE_PLANNER_ALIASES: Record<string, string> = {
  "planner/load": "load",
  "planner/stop": "stop",
  "planner/show": "show",
  "planner/feature/list": "feature list",
  "planner/phase/list": "phase list",
  "planner/task/recommend": "task recommend",
  "planner/task/start": "task start $ARGUMENTS",
  "planner/task/complete": "task complete $ARGUMENTS",
  "planner/handoff/list": "handoff list",
  "planner/web/start": "web start",
  "planner/web/status": "web status",
  "planner/web/stop": "web stop",
  "planner-load": "load",
  "planner-stop": "stop",
  "planner-show": "show",
  "planner-feature-list": "feature list",
  "planner-phase-list": "phase list",
  "planner-task-recommend": "task recommend",
  "planner-task-start": "task start $ARGUMENTS",
  "planner-task-complete": "task complete $ARGUMENTS",
  "planner-handoff-list": "handoff list",
  "planner-web-start": "web start",
  "planner-web-status": "web status",
  "planner-web-stop": "web stop",
};

const CODEX_PLUGIN_MARKETPLACE = "agent-plan";
const CODEX_PLUGIN_SELECTOR = "agent-plan@agent-plan";
const CODEX_PLUGIN_GIT_SOURCE = "https://github.com/ovidius72/agent-planner";

function findAncestorContaining(start: string, relativePath: string): string | undefined {
  let dir = start;
  while (true) {
    if (existsSync(join(dir, relativePath))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function codexMarketplaceAddArgs(flags: CliFlags): string[] {
  if (flags.local) {
    const root = findAncestorContaining(dirname(localCliPath()), join(".agents", "plugins", "marketplace.json"));
    if (!root) {
      throw new Error("Could not locate the local Agent Plan Codex marketplace. Build from a repository checkout or omit --local.");
    }
    return ["plugin", "marketplace", "add", root, "--json"];
  }
  return [
    "plugin",
    "marketplace",
    "add",
    CODEX_PLUGIN_GIT_SOURCE,
    "--ref",
    "main",
    "--sparse",
    ".agents/plugins",
    "--sparse",
    "plugins/codex",
    "--json",
  ];
}

function runCodex(args: string[], options: { ignoreFailure?: boolean } = {}): { ok: boolean; detail: string } {
  const result = spawnSync("codex", args, { encoding: "utf-8" });
  if (result.error) return { ok: false, detail: result.error.message };
  if (result.status !== 0 && !options.ignoreFailure) {
    return { ok: false, detail: `${result.stderr || result.stdout || `exit ${result.status}`}`.trim() };
  }
  return { ok: true, detail: `${result.stdout || result.stderr || ""}`.trim() };
}

function setupCodexMarketplacePlugin(flags: CliFlags): string {
  const available = runCodex(["--version"]);
  if (!available.ok) return `Codex plugin marketplace install skipped: codex CLI not found (${available.detail}).`;

  if (flags.force) {
    runCodex(["plugin", "remove", CODEX_PLUGIN_SELECTOR, "--json"], { ignoreFailure: true });
    runCodex(["plugin", "marketplace", "remove", CODEX_PLUGIN_MARKETPLACE, "--json"], { ignoreFailure: true });
  }

  const addArgs = codexMarketplaceAddArgs(flags);
  const add = runCodex(addArgs);
  if (!add.ok) {
    return [
      "Codex plugin marketplace install skipped: marketplace registration failed.",
      `Run manually: codex ${addArgs.filter((arg) => arg !== "--json").join(" ")}`,
      add.detail ? `Detail: ${add.detail}` : "",
    ].filter(Boolean).join("\n");
  }

  const install = runCodex(["plugin", "add", CODEX_PLUGIN_SELECTOR, "--json"]);
  if (!install.ok) {
    return [
      "Codex plugin marketplace registered, but plugin installation failed.",
      `Run manually: codex plugin add ${CODEX_PLUGIN_SELECTOR}`,
      install.detail ? `Detail: ${install.detail}` : "",
    ].filter(Boolean).join("\n");
  }

  return `Installed Codex Agent Plan plugin from marketplace ${CODEX_PLUGIN_MARKETPLACE} (${CODEX_PLUGIN_SELECTOR}).`;
}

function isAgentPlanOpencodeConfigured(settings: Record<string, unknown>): boolean {
  const mcp = isRecord(settings.mcp) ? settings.mcp : {};
  const servers = isRecord(mcp.servers) ? mcp.servers : {};
  const command = isRecord(settings.command) ? settings.command : {};
  const legacyCommands = isRecord(settings.commands) ? settings.commands : {};
  return Boolean(servers["agent-plan"] || command.planner || legacyCommands.planner);
}

async function setupOpencode(flags: CliFlags): Promise<void> {
  const scope = flags.user ? "user" : "project";
  const settingsPath = opencodeConfigPath(scope);
  const settings = await readJsonFile(settingsPath);
  if (isAgentPlanOpencodeConfigured(settings) && !flags.force) {
    throw new Error(`OpenCode already has Agent Plan configuration in ${settingsPath}. Re-run with --force to overwrite.`);
  }

  const mcp = isRecord(settings.mcp) ? { ...settings.mcp } : {};
  const servers = isRecord(mcp.servers) ? { ...mcp.servers } : {};
  const { command, args } = mcpCommandParts(flags);
  servers["agent-plan"] = {
    type: "local",
    command: [command, ...args],
  };
  mcp.servers = servers;
  settings.mcp = mcp;

  const commandConfig = isRecord(settings.command) ? { ...settings.command } : {};
  commandConfig.planner = {
    description: "Route Agent Plan /planner commands through the configured MCP server.",
    template: await opencodePlannerCommandTemplate(),
  };
  for (const [name, commandText] of Object.entries(OPENCODE_PLANNER_ALIASES)) {
    commandConfig[name] = {
      description: `Agent Plan shortcut for /planner ${commandText.replace(" $ARGUMENTS", " ...")}.`,
      template: await opencodePlannerCommandTemplate(commandText),
    };
  }
  settings.command = commandConfig;

  if (isRecord(settings.commands)) {
    const legacyCommands = { ...settings.commands };
    delete legacyCommands.planner;
    for (const name of Object.keys(OPENCODE_PLANNER_ALIASES)) delete legacyCommands[name];
    for (const name of Object.keys(OPENCODE_PLANNER_ALIASES)) delete legacyCommands[name.replaceAll("/", "-")];
    if (Object.keys(legacyCommands).length > 0) settings.commands = legacyCommands;
    else delete settings.commands;
  }

  await writeJsonFile(settingsPath, settings);
  console.log(`Configured OpenCode MCP server and /planner command in ${settingsPath}`);
  console.log("OpenCode supports /planner with arguments through the planner command. Autosuggestion is provided through nested slash aliases such as /planner/web/start and compatibility aliases such as /planner-web-start.");
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

  // Cheap, I/O-free pre-check: anything that cannot change project code
  // (read-only tools, writes to .planner/ or outside the project) is decided
  // from the event alone, before loading the plan.
  if (!classifyGuardedTool(guardEvent).guarded) return;

  let state;
  try {
    state = await loadNoTaskGuardState(new PlanStore(root));
  } catch {
    return;
  }
  const { warning } = noTaskWarning(guardEvent, state);
  if (!warning) return;

  // A warning for the agent only. No permissionDecision: the call goes
  // through Claude Code's normal permission flow, never blocked or prompted.
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: warning,
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

  if (command === "setup" && subcommand === "opencode") {
    await setupOpencode(flags);
    return;
  }

  throw new Error(`Unknown command: ${[command, subcommand, ...rest].filter(Boolean).join(" ")}\n\n${usage()}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
