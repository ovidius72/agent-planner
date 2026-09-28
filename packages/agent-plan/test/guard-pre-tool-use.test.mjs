/**
 * End-to-end coverage of the `agent-plan guard pre-tool-use` CLI wiring: the
 * warning logic itself is unit-tested against fabricated events in
 * @agent-plan/core (packages/plan-core/test/guard-decision.test.mjs). These
 * tests exercise the real stdin → hookSpecificOutput JSON contract against a
 * real .planner/ fixture, so a wiring regression (wrong field name, wrong
 * cwd, stale plannerRoot) is caught even though the pure warning function
 * is fine. The hook never blocks or prompts: it prints nothing, or a warning
 * for the agent with no permissionDecision.
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

/** The hook's output must be a warning for the agent and nothing that can
 * block or prompt. Returns the warning text. */
function warningFrom(result) {
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout).hookSpecificOutput;
  assert.equal(output.hookEventName, "PreToolUse");
  assert.equal(output.permissionDecision, undefined);
  assert.equal(output.permissionDecisionReason, undefined);
  assert.equal(typeof output.additionalContext, "string");
  return output.additionalContext;
}

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

test("an Edit inside .planner/ prints nothing even with a planned, not-started task", async () => {
  const { root } = await fixtureWithPlannedTask();
  const result = runGuard({ tool_name: "Edit", tool_input: { file_path: join(root, ".planner", "docs", "handoff.md") } }, root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("an Edit to project code with no task in progress only warns the agent, and names the task to start", async () => {
  const { root, taskId } = await fixtureWithPlannedTask();
  const warning = warningFrom(runGuard({ tool_name: "Edit", tool_input: { file_path: join(root, "src", "index.ts") } }, root));
  assert.match(warning, /no task is in progress/);
  assert.match(warning, /not blocked/);
  assert.match(warning, new RegExp(taskId));
});

test("writes outside the project print nothing, even with no task in progress", async () => {
  const { root } = await fixtureWithPlannedTask();
  for (const command of ["grep -rn x . 2>/dev/null", `echo hi > ${join(tmpdir(), "agent-plan-guard-scratch.txt")}`]) {
    const result = runGuard({ tool_name: "Bash", tool_input: { command } }, root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "", command);
  }
});

test("a task in-progress silences the warning", async () => {
  const { root, store, phaseId } = await fixtureWithPlannedTask();
  await store.updatePhase(phaseId, (ph) => {
    ph.tasks[0].status = "in-progress";
    return ph;
  });
  const result = runGuard({ tool_name: "Edit", tool_input: { file_path: join(root, "src", "index.ts") } }, root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("an authorized bypass silences the warning", async () => {
  const { root, store } = await fixtureWithPlannedTask();
  await store.authorizeGuardBypass(15);
  const result = runGuard({ tool_name: "Edit", tool_input: { file_path: join(root, "src", "index.ts") } }, root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("read-only Bash prints nothing even with a planned, not-started task", async () => {
  const { root } = await fixtureWithPlannedTask();
  const result = runGuard({ tool_name: "Bash", tool_input: { command: "git status && pnpm build" } }, root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("write-shaped Bash to project code warns; the identical shape targeting .planner/ prints nothing", async () => {
  const { root } = await fixtureWithPlannedTask();

  warningFrom(runGuard({ tool_name: "Bash", tool_input: { command: `echo hi > ${join(root, "src", "out.txt")}` } }, root));

  const inside = runGuard({ tool_name: "Bash", tool_input: { command: `echo hi > ${join(root, ".planner", "docs", "note.md")}` } }, root);
  assert.equal(inside.status, 0, inside.stderr);
  assert.equal(inside.stdout, "");
});

test("a NotebookEdit to project code warns; inside .planner/ it prints nothing", async () => {
  const { root } = await fixtureWithPlannedTask();

  warningFrom(runGuard({ tool_name: "NotebookEdit", tool_input: { notebook_path: join(root, "notebooks", "a.ipynb") } }, root));

  const inside = runGuard({ tool_name: "NotebookEdit", tool_input: { notebook_path: join(root, ".planner", "a.ipynb") } }, root);
  assert.equal(inside.stdout, "");
});
