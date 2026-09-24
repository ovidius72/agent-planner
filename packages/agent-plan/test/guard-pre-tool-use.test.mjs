/**
 * End-to-end coverage of the `agent-plan guard pre-tool-use` CLI wiring: the
 * decision logic itself is unit-tested against fabricated events in
 * @agent-plan/core (packages/plan-core/test/guard-decision.test.mjs). These
 * tests exercise the real stdin → hookSpecificOutput JSON contract against a
 * real .planner/ fixture, so a wiring regression (wrong field name, wrong
 * cwd, stale plannerRoot) is caught even though the pure decision function
 * is fine.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { PlanStore, PhaseSchema, FeatureSchema, createFeatureId, createPhaseId, createTaskId } from "@agent-plan/core";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(packageRoot, "dist", "index.js");
const roots = [];

after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

function runGuard(payload, cwd) {
  return spawnSync(process.execPath, [cliPath, "guard", "pre-tool-use"], {
    encoding: "utf-8",
    cwd,
    input: JSON.stringify(payload),
  });
}

/** A fresh .planner/ with one "planned" (not started) task, so the guard has
 * real work to reason about but nothing in-progress. */
async function fixtureWithPlannedTask() {
  const root = await mkdtemp(join(tmpdir(), "agent-plan-guard-"));
  roots.push(root);
  const store = new PlanStore(join(root, ".planner"));
  await store.init("guard fixture");
  const now = new Date().toISOString();
  const feature = FeatureSchema.parse({ id: createFeatureId(), number: 1, name: "Feat", status: "planned", createdAt: now, updatedAt: now });
  await store.saveFeature(feature);
  const phase = PhaseSchema.parse({ id: createPhaseId(), number: 1, featureId: feature.id, slug: "phase-1", title: "Phase 1", status: "planned", createdAt: now, updatedAt: now });
  await store.savePhase(phase);
  const taskId = createTaskId();
  await store.updatePhase(phase.id, (ph) => {
    ph.tasks = [{ id: taskId, number: 1, phaseId: ph.id, title: "Do the thing", shortName: "do-the-thing", status: "planned", createdAt: now, updatedAt: now }];
    return ph;
  });
  return { root, store, phaseId: phase.id, taskId };
}

test("an Edit inside .planner/ is allowed even with a planned, not-started task", async () => {
  const { root } = await fixtureWithPlannedTask();
  const result = runGuard({ tool_name: "Edit", tool_input: { file_path: join(root, ".planner", "docs", "handoff.md") } }, root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("an Edit outside .planner/ with no task in progress asks, and names the concrete task to start", async () => {
  const { root, taskId } = await fixtureWithPlannedTask();
  const result = runGuard({ tool_name: "Edit", tool_input: { file_path: join(root, "src", "index.ts") } }, root);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.hookSpecificOutput.permissionDecision, "ask");
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /no task is in-progress/);
  assert.match(output.hookSpecificOutput.permissionDecisionReason, new RegExp(taskId));
});

test("a task in-progress allows the Edit outside .planner/", async () => {
  const { root, store, phaseId } = await fixtureWithPlannedTask();
  await store.updatePhase(phaseId, (ph) => {
    ph.tasks[0].status = "in-progress";
    return ph;
  });
  const result = runGuard({ tool_name: "Edit", tool_input: { file_path: join(root, "src", "index.ts") } }, root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("an authorized bypass allows the Edit outside .planner/", async () => {
  const { root, store } = await fixtureWithPlannedTask();
  await store.authorizeGuardBypass(15);
  const result = runGuard({ tool_name: "Edit", tool_input: { file_path: join(root, "src", "index.ts") } }, root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("read-only Bash is allowed even with a planned, not-started task", async () => {
  const { root } = await fixtureWithPlannedTask();
  const result = runGuard({ tool_name: "Bash", tool_input: { command: "git status && pnpm build" } }, root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("write-shaped Bash outside .planner/ asks; the identical shape targeting .planner/ is allowed", async () => {
  const { root } = await fixtureWithPlannedTask();

  const outside = runGuard({ tool_name: "Bash", tool_input: { command: `echo hi > ${join(root, "src", "out.txt")}` } }, root);
  assert.equal(outside.status, 0, outside.stderr);
  const outsideOutput = JSON.parse(outside.stdout);
  assert.equal(outsideOutput.hookSpecificOutput.permissionDecision, "ask");

  const inside = runGuard({ tool_name: "Bash", tool_input: { command: `echo hi > ${join(root, ".planner", "docs", "note.md")}` } }, root);
  assert.equal(inside.status, 0, inside.stderr);
  assert.equal(inside.stdout, "");
});

test("a NotebookEdit outside .planner/ asks; inside it is allowed", async () => {
  const { root } = await fixtureWithPlannedTask();

  const outside = runGuard({ tool_name: "NotebookEdit", tool_input: { notebook_path: join(root, "notebooks", "a.ipynb") } }, root);
  const outsideOutput = JSON.parse(outside.stdout);
  assert.equal(outsideOutput.hookSpecificOutput.permissionDecision, "ask");

  const inside = runGuard({ tool_name: "NotebookEdit", tool_input: { notebook_path: join(root, ".planner", "a.ipynb") } }, root);
  assert.equal(inside.stdout, "");
});
