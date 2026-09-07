#!/usr/bin/env node
/**
 * Pack every public package, install the tarballs into a fresh temporary app,
 * and exercise the installed CLI, core, Pi adapter, server, and MCP startup.
 * Nothing imports workspace dist and no real project is opened.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageDirs = ["plan-core", "plan-server", "plan-mcp", "agent-plan", "pi-adapter"];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
  return result.stdout.trim();
}

async function packArtifacts(packDir) {
  for (const packageDir of packageDirs) {
    run("pnpm", ["pack", "--pack-destination", packDir], { cwd: join(root, "packages", packageDir) });
  }
  const tarballs = (await readdir(packDir))
    .filter((name) => name.endsWith(".tgz"))
    .map((name) => join(packDir, name));
  assert.equal(tarballs.length, packageDirs.length, "every public package must produce one tarball");
  return tarballs;
}

function smokeProgram() {
  return `
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PlanStore } from "@agent-plan/core";
import * as serverPackage from "@agent-plan/server";
import piAdapter from "@agent-plan/pi-adapter";

assert.equal(typeof PlanStore, "function");
assert.equal(typeof serverPackage.serve, "function");
assert.equal(typeof piAdapter, "function");
const piTools = new Map();
const piCommands = new Map();
const piHooks = new Map();
piAdapter({
  registerTool(definition) { piTools.set(definition.name, definition); },
  registerCommand(name, definition) { piCommands.set(name, definition); },
  on(event, handler) { piHooks.set(event, handler); },
  appendEntry() {},
  sendUserMessage() {},
});
assert.ok(piTools.has("planner-load"), "installed Pi adapter registers planner-load");
assert.ok(piCommands.has("planner"), "installed Pi adapter registers /planner");
assert.ok(piHooks.has("session_start"), "installed Pi adapter registers startup lifecycle");

const projectRoot = join(process.cwd(), "fresh-project");
const planRoot = join(projectRoot, ".planner");
await mkdir(projectRoot, { recursive: true });
const store = new PlanStore(planRoot);
await store.init("Installed artifact smoke");

const mcpEntry = join(process.cwd(), "node_modules", "@agent-plan", "mcp", "dist", "index.js");
const client = new Client({ name: "installed-smoke", version: "1.0.0" }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [mcpEntry],
  cwd: projectRoot,
  env: { ...process.env, AGENT_PLAN_ROOT: planRoot },
  stderr: "pipe",
});
try {
  await client.connect(transport);
  const result = await client.callTool({ name: "planner-load", arguments: {} });
  const text = (result.content ?? []).map((entry) => entry.text ?? "").join("\\n");
  const structured = result.structuredContent ?? {};
  assert.match(text, /Installed artifact smoke/);
  assert.match(text, /🌐 Web UI: http:\\/\\//);
  assert.equal(structured.loaded, true);
  assert.equal(structured.recap?.text, text);
  assert.equal(structured.webUi?.running, true);
  assert.match(structured.webUi?.address ?? "", /^http:\\/\\//);
  assert.equal(typeof structured.webUi?.host, "string");
  assert.equal(typeof structured.webUi?.port, "number");

  const longDescription = "src/installed-smoke.ts:1 installed package behavior with concrete state, goals, and preservation constraints for a valid rich planner entity description.";
  await client.callTool({ name: "planner-feature-add", arguments: { name: "Closeout feature", description: longDescription } });
  await client.callTool({ name: "planner-phase-add", arguments: { feature: "F001", title: "Closeout phase", description: longDescription } });
  await client.callTool({ name: "planner-task-add", arguments: { feature: "F001", phase: "P001", title: "Closeout task", description: longDescription } });
  await mkdir(join(planRoot, "docs"), { recursive: true });
  await writeFile(join(planRoot, "docs", "p001-closeout.md"), "# Installed closeout\\n", "utf8");
  const phase = (await store.loadAllPhases())[0];
  const task = phase.tasks[0];
  await store.setPhaseHandoff(phase.id, "# Installed terminal handoff\\n\\n- [.planner/docs/p001-closeout.md](.planner/docs/p001-closeout.md)");
  await store.updateTask(phase.id, task.id, (current) => ({ ...current, status: "done" }));
  await store.syncTaskStatusRollup(phase.id);
  const archived = await client.callTool({ name: "planner-handoff-show", arguments: { phaseRef: "P001" } });
  const archivedText = (archived.content ?? []).map((entry) => entry.text ?? "").join("\\n");
  assert.match(archivedText, /Archived terminal-phase handoff/);
  assert.match(archivedText, /.planner\\/docs\\/p001-closeout\\.md/);
  assert.equal(archived.structuredContent?.archived, true);
} finally {
  await transport.close();
}
console.log("installed artifact smoke passed");
`;
}

export async function main() {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-plan-installed-smoke-"));
  try {
    const packDir = join(tempRoot, "packs");
    const appDir = join(tempRoot, "app");
    await mkdir(packDir, { recursive: true });
    await mkdir(appDir, { recursive: true });
    await writeFile(join(appDir, "package.json"), JSON.stringify({ name: "agent-plan-installed-smoke", private: true, type: "module" }, null, 2));
    const tarballs = await packArtifacts(packDir);
    run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...tarballs], { cwd: appDir });
    const cliPath = join(appDir, "node_modules", "agent-plan", "dist", "index.js");
    assert.match(run(process.execPath, [cliPath, "--version"], { cwd: appDir }), /^agent-plan \d+\.\d+\.\d+/);
    const smokePath = join(appDir, "smoke.mjs");
    await writeFile(smokePath, smokeProgram());
    run(process.execPath, [smokePath], { cwd: appDir });
    console.log("[installed-smoke] ✓ packed packages installed and exercised from a fresh temporary app");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[installed-smoke] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
