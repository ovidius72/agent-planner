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
import { PlanStore, splitPlannerLoadText } from "@agent-plan/core";
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
  // One text: the recap for the user, then agent-only context, each once.
  // Claude Code shows only structuredContent, so it must carry the text too.
  const { recap, agentContext } = splitPlannerLoadText(text);
  assert.match(recap, /Installed artifact smoke/);
  assert.match(recap, /🌐 Web UI: http:\\/\\//);
  assert.doesNotMatch(recap, /Project context v1/, "agent-only context stays out of the recap");
  assert.match(agentContext, /Project context v1/);
  assert.equal(text.split("Project context v1").length - 1, 1, "project context is sent once");
  assert.equal(structured.text, text, "structuredContent carries the reply text");
  assert.equal(structured.loaded, true);
  assert.equal(structured.projectContext?.contextComplete, true);
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

  // Real independent installed MCP processes exercise ownership, focus and recovery.
  const callers = [];
  async function openCaller(name) {
    const nextClient = new Client({ name, version: "1.0.0" }, { capabilities: {} });
    const nextTransport = new StdioClientTransport({ command: process.execPath, args: [mcpEntry], cwd: projectRoot, env: { ...process.env, AGENT_PLAN_ROOT: planRoot }, stderr: "pipe" });
    callers.push(nextTransport);
    await nextClient.connect(nextTransport);
    return nextClient;
  }
  async function readContext(caller, ref) {
    await caller.callTool({ name: "planner-task-show", arguments: { task: ref, full: true } });
    await caller.callTool({ name: "planner-phase-show", arguments: { phase: "P001", full: true } });
    await caller.callTool({ name: "planner-feature-show", arguments: { feature: "F001", full: true } });
    await caller.callTool({ name: "planner-requirement-list", arguments: { phaseRef: "P001" } });
  }
  try {
    for (const title of ["Owned task", "Independent task", "First detour", "Nested detour", "Contended task"]) {
      await client.callTool({ name: "planner-task-add", arguments: { feature: "F001", phase: "P001", title, description: longDescription } });
    }
    const independent = await openCaller("independent-owner");
    const restarted = await openCaller("restart-owner");
    await readContext(client, "T002");
    await readContext(independent, "T003");
    await readContext(restarted, "T002");
    assert.equal((await client.callTool({ name: "planner-task-start", arguments: { task: "T002" } })).structuredContent.started, true);
    assert.equal((await independent.callTool({ name: "planner-task-start", arguments: { task: "T003" } })).structuredContent.started, true);
    const denied = await restarted.callTool({ name: "planner-task-start", arguments: { task: "T002" } });
    assert.equal(denied.isError, true);
    assert.equal(denied.structuredContent.started, false);
    assert.equal(denied.structuredContent.errorCode, "TASK_OWNED_BY_ANOTHER_SESSION");
    for (const [from_task, to_task] of [["T002", "T004"], ["T004", "T005"]]) {
      await readContext(client, to_task);
      const switched = await client.callTool({ name: "planner-task-switch", arguments: { from_task, to_task, reason: "Installed nested detour", what_was_being_done: "Source work", resume_location: "src/smoke.ts:1", how_to_resume: "Continue source" } });
      assert.notEqual(switched.isError, true);
    }
    const beforeRecovery = (await store.loadAllPhases())[0].tasks;
    const oldOwner = beforeRecovery[4].activeOwnerSession;
    assert.deepEqual((await store.loadResume(oldOwner)).inProgressTaskIds, [beforeRecovery[4].id]);
    const live = await restarted.callTool({ name: "planner-session-recover", arguments: { task: "T005", confirmed: true } });
    assert.equal(live.structuredContent.errorCode, "SESSION_OWNER_ACTIVE");
    await transport.close();
    const recovered = await restarted.callTool({ name: "planner-session-recover", arguments: { task: "T005", confirmed: true } });
    assert.equal(recovered.structuredContent.recovered, true);
    const afterRecovery = (await store.loadAllPhases())[0].tasks;
    assert.notEqual(afterRecovery[4].activeOwnerSession, oldOwner);
    assert.deepEqual(afterRecovery[2], beforeRecovery[2], "other installed caller retains ownership");
    for (const index of [1, 3]) assert.deepEqual(afterRecovery[index].pauseSnapshot, beforeRecovery[index].pauseSnapshot);
    for (const [completed, resume] of [["T005", "T004"], ["T004", "T002"]]) {
      await readContext(restarted, completed);
      assert.equal((await restarted.callTool({ name: "planner-task-start", arguments: { task: completed } })).structuredContent.started, true);
      const finished = await restarted.callTool({ name: "planner-task-complete", arguments: { task: completed, description_update: "Installed nested detour verified and completed." } });
      assert.match(finished.structuredContent.text, new RegExp("RESUME REQUIRED:.*" + resume));
      await readContext(restarted, resume);
      assert.equal((await restarted.callTool({ name: "planner-task-start", arguments: { task: resume } })).structuredContent.started, true);
    }
    const contenders = await Promise.all([openCaller("claim-a"), openCaller("claim-b")]);
    await Promise.all(contenders.map((caller) => readContext(caller, "T006")));
    const claims = await Promise.all(contenders.map((caller) => caller.callTool({ name: "planner-task-start", arguments: { task: "T006" } })));
    assert.equal(claims.filter((reply) => reply.structuredContent.started).length, 1);
    assert.equal(claims.filter((reply) => reply.isError && reply.structuredContent.started === false).length, 1);
    console.log("installed session ownership, focus and nested restart recovery passed");
  } finally {
    await Promise.all(callers.map((caller) => caller.close()));
  }
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
