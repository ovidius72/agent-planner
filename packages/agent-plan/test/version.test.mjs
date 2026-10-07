import { after, test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(packageRoot, "dist", "index.js");
const packageVersion = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8")).version;
const roots = [];

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf-8",
    ...options,
  });
}

after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

for (const flag of ["--version", "-v"]) {
  test(`agent-plan ${flag} reports the installed CLI package version`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), "agent-plan-version-"));
    roots.push(cwd);

    const result = runCli([flag], { cwd });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.trim(), `agent-plan ${packageVersion}`);
    assert.equal(existsSync(join(cwd, ".planner")), false, "version lookup must not initialize planner state");
  });
}

test("CLI help documents both version aliases and diagnostics command", () => {
  const result = runCli(["help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--version, -v/);
  assert.match(result.stdout, /agent-plan --version \| -v/);
  assert.match(result.stdout, /agent-plan version/);
});

test("agent-plan version reports loaded runtime provenance and compatibility", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-plan-version-diagnostics-"));
  roots.push(cwd);

  const result = runCli(["version"], { cwd });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, new RegExp(`agent-plan: loaded ${packageVersion.replaceAll(".", "\\.")}`));
  assert.match(result.stdout, /@agent-plan\/core: loaded /);
  assert.match(result.stdout, /@agent-plan\/mcp: loaded /);
  assert.match(result.stdout, /Plan schema: manifest schemaVersion 1/);
  assert.match(result.stdout, /Allocation registry: v1; supported kinds: feature, phase, task, idea/);
  assert.equal(existsSync(join(cwd, ".planner")), false, "version diagnostics must not initialize planner state");
});

test("CLI init and export operate on an isolated workspace", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-plan-cli-smoke-"));
  roots.push(cwd);

  const initialized = runCli(["init", "Version Smoke", "--yes"], { cwd });
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.match(initialized.stdout, /Initialized \.planner\/ for "Version Smoke"/);
  assert.equal(existsSync(join(cwd, ".planner", "manifest.json")), true);

  const exported = runCli(["export"], { cwd });
  assert.equal(exported.status, 0, exported.stderr);
  assert.match(exported.stdout, /Export saved to/);
  assert.equal(existsSync(join(cwd, ".planner", "EXPORT.md")), true);
});

test("Claude, Codex, and OpenCode setup preserve manifest-based version routing", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-plan-setup-version-"));
  roots.push(cwd);

  const codex = runCli(["setup", "codex", "--project", "--local"], { cwd });
  assert.equal(codex.status, 0, codex.stderr);
  const codexConfig = readFileSync(join(cwd, ".codex", "config.toml"), "utf-8");
  assert.match(codexConfig, /\[mcp_servers\.agent-plan\]/);
  assert.match(codexConfig, /command = "node"/);
  assert.match(codexConfig, /args = \[".*index\.js", "mcp"\]/);
  const codexSkill = readFileSync(join(cwd, ".codex", "skills", "agent-plan", "SKILL.md"), "utf-8");
  assert.match(codexSkill, /# Agent Plan operating guide/);
  assert.match(codexSkill, /^description:/m);
  const plannerSkill = readFileSync(join(cwd, ".codex", "skills", "planner", "SKILL.md"), "utf-8");
  assert.match(plannerSkill, /^name: planner$/m);
  assert.match(plannerSkill, /^description:/m);
  assert.match(codex.stdout, /Configured Codex Agent Plan skills/);

  const claude = runCli(["setup", "claude-code", "--project", "--local"], { cwd });
  assert.equal(claude.status, 0, claude.stderr);
  const claudeConfig = JSON.parse(readFileSync(join(cwd, ".mcp.json"), "utf-8"));
  assert.equal(claudeConfig.mcpServers["agent-plan"].command, "node");
  const plannerCommand = readFileSync(join(cwd, ".claude", "commands", "planner.md"), "utf-8");
  assert.match(plannerCommand, /# Agent Plan operating guide/);
  assert.match(plannerCommand, /`planner-version`/);
  // These pin that the lifecycle protocol survives generation into
  // planner.md, not its exact prose. P104(F005)/T420 reordered the section
  // so reading comes before the call, and two assertions that quoted whole
  // sentences broke — undetected, because this package's suite is not one
  // of the four run during that phase. Match the durable claim instead.
  assert.match(plannerCommand, /`task_start` \/ `planner-task-start`/);
  assert.match(plannerCommand, /Perform only the missing or stale reads listed in `nextActions`/);
  assert.match(plannerCommand, /Reads may be completed in any order/);
  assert.match(plannerCommand, /Follow the lowest visible ready priority/);
  assert.match(plannerCommand, /DESCRIPTION_MARKDOWN_FALLBACK_REQUIRED/);
  assert.match(plannerCommand, /retry with a concise inline summary plus `descriptionRef`/);
  assert.match(plannerCommand, /## Project Guidelines/);
  assert.match(plannerCommand, /`planner-project-guidelines-show`/);
  assert.match(plannerCommand, /## Handoff protocol/);
  assert.match(plannerCommand, /exact focus and resume point; current\/partial state/);
  assert.match(plannerCommand, /planner records derived evidence as structured metadata/);
  assert.match(plannerCommand, /compact paginated index of active handoffs/);
  assert.match(plannerCommand, /latest terminal archive/);
  assert.doesNotMatch(plannerCommand, /read the exact lineage in this order/);
  const claudeSettings = JSON.parse(readFileSync(join(cwd, ".claude", "settings.json"), "utf-8"));
  assert.ok(claudeSettings.hooks.PreToolUse.some((group) => group.matcher === "Edit|Write|NotebookEdit|Bash"));

  writeFileSync(join(cwd, "opencode.json"), `${JSON.stringify({
    command: {
      "planner/load": { template: "obsolete slash alias" },
      "planner/web/start": { template: "obsolete slash alias" },
      unrelated: { template: "keep me" },
    },
    commands: {
      "planner/task/start": { template: "obsolete slash alias" },
      unrelatedLegacy: { template: "keep me too" },
    },
  }, null, 2)}\n`);
  const opencode = runCli(["setup", "opencode", "--project", "--local"], { cwd });
  assert.equal(opencode.status, 0, opencode.stderr);
  assert.match(opencode.stdout, /Configured OpenCode MCP server and \/planner command/);
  assert.match(opencode.stdout, /Mode: local built CLI/);
  assert.doesNotMatch(opencode.stdout, /Autosuggestion/);
  assert.doesNotMatch(opencode.stdout, /\.planner\/ is not initialized/);
  const opencodeConfig = JSON.parse(readFileSync(join(cwd, "opencode.json"), "utf-8"));
  assert.deepEqual(opencodeConfig.mcp.servers["agent-plan"].command.slice(-1), ["mcp"]);
  assert.equal(opencodeConfig.mcp.servers["agent-plan"].command[0], "node");
  assert.equal(opencodeConfig.command.unrelated.template, "keep me");
  assert.equal(opencodeConfig.commands.unrelatedLegacy.template, "keep me too");
  assert.equal(opencodeConfig.commands["planner/task/start"], undefined);
  assert.match(opencodeConfig.command.planner.template, /\/planner \$ARGUMENTS/);
  assert.doesNotMatch(opencodeConfig.command.planner.template, /# Agent Plan operating guide/);
  assert.match(opencodeConfig.command.planner.template, /Use the installed Agent Plan skill or the project-local \.planner\/SKILL\.md only when you need deeper routing rules/);
  assert.match(opencodeConfig.command["planner-load"].template, /\/planner load/);
  assert.match(opencodeConfig.command["planner-task-start"].template, /\/planner task start \$ARGUMENTS/);
  assert.match(opencodeConfig.command["planner-web-start"].template, /\/planner web start/);
  assert.equal(opencodeConfig.command["planner/load"], undefined);
  assert.equal(opencodeConfig.command["planner/task/start"], undefined);
  assert.equal(opencodeConfig.command["planner/web/start"], undefined);
});

test("Codex user setup installs the Agent Plan plugin through a Codex marketplace", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-plan-codex-plugin-"));
  roots.push(cwd);
  const bin = join(cwd, "bin");
  const log = join(cwd, "codex-args.log");
  writeFileSync(log, "");
  await mkdir(bin, { recursive: true });
  const codexShim = join(bin, "codex");
  writeFileSync(codexShim, `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.CODEX_ARGS_LOG, process.argv.slice(2).join(" ") + "\\n");
process.exit(0);
`);
  chmodSync(codexShim, 0o755);

  const result = runCli(["setup", "codex", "--user", "--force", "--local"], {
    cwd,
    env: {
      ...process.env,
      HOME: cwd,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      CODEX_ARGS_LOG: log,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Installed Codex Agent Plan plugin/);
  assert.equal(existsSync(join(cwd, ".codex", "config.toml")), true);
  assert.equal(existsSync(join(cwd, ".codex", "skills", "agent-plan", "SKILL.md")), true);
  assert.equal(existsSync(join(cwd, ".codex", "skills", "planner", "SKILL.md")), true);
  const codexCalls = readFileSync(log, "utf-8");
  assert.match(codexCalls, /^--version$/m);
  assert.match(codexCalls, /^plugin marketplace remove agent-plan --json$/m);
  assert.match(codexCalls, /^plugin marketplace add .* --json$/m);
  assert.match(codexCalls, /^plugin add agent-plan@agent-plan --json$/m);
});

test("local setup saves the real CLI path, not the link it was started through", async () => {
  // fnm and similar version managers start the CLI through a link in a
  // per-shell temp folder; saving that link breaks the hook once it is gone.
  const cwd = await mkdtemp(join(tmpdir(), "agent-plan-setup-link-"));
  roots.push(cwd);
  const link = join(cwd, "agent-plan-link.js");
  symlinkSync(cliPath, link);
  const result = spawnSync(process.execPath, [link, "setup", "claude-code", "--project", "--local"], { cwd, encoding: "utf-8" });
  assert.equal(result.status, 0, result.stderr);
  const settings = JSON.parse(readFileSync(join(cwd, ".claude", "settings.json"), "utf-8"));
  const hook = settings.hooks.PreToolUse.flatMap((group) => group.hooks).find((entry) => entry.args?.includes("guard"));
  assert.equal(hook.args[0], realpathSync(cliPath));
  const mcp = JSON.parse(readFileSync(join(cwd, ".mcp.json"), "utf-8"));
  assert.equal(mcp.mcpServers["agent-plan"].args[0], realpathSync(cliPath));
});

test("Claude guard ignores non-writing tools without requiring planner state", () => {
  const result = runCli(["guard", "pre-tool-use"], {
    input: JSON.stringify({ tool_name: "Bash" }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});
