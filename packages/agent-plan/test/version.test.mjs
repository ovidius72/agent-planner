import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
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

test("CLI help documents both version aliases", () => {
  const result = runCli(["help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--version, -v/);
  assert.match(result.stdout, /agent-plan --version \| -v/);
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

test("Claude and Codex setup preserve manifest-based version routing", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-plan-setup-version-"));
  roots.push(cwd);

  const codex = runCli(["setup", "codex", "--project", "--local"], { cwd });
  assert.equal(codex.status, 0, codex.stderr);
  const codexConfig = JSON.parse(readFileSync(join(cwd, ".codex", "mcp.json"), "utf-8"));
  assert.equal(codexConfig.mcpServers["agent-plan"].command, "node");
  assert.deepEqual(codexConfig.mcpServers["agent-plan"].args.slice(-1), ["mcp"]);

  const claude = runCli(["setup", "claude-code", "--project", "--local"], { cwd });
  assert.equal(claude.status, 0, claude.stderr);
  const claudeConfig = JSON.parse(readFileSync(join(cwd, ".mcp.json"), "utf-8"));
  assert.equal(claudeConfig.mcpServers["agent-plan"].command, "node");
  const plannerCommand = readFileSync(join(cwd, ".claude", "commands", "planner.md"), "utf-8");
  assert.match(plannerCommand, /`version` → call `planner-version`/);
  const claudeSettings = JSON.parse(readFileSync(join(cwd, ".claude", "settings.json"), "utf-8"));
  assert.ok(claudeSettings.hooks.PreToolUse.some((group) => group.matcher === "Edit|Write"));
});

test("Claude guard ignores non-writing tools without requiring planner state", () => {
  const result = runCli(["guard", "pre-tool-use"], {
    input: JSON.stringify({ tool_name: "Bash" }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});
