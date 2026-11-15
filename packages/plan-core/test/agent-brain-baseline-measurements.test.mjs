/**
 * P116(F025)/T461 — Comparable small/large-plan and no-op measurement
 * fixtures for later regression.
 *
 * Builds deterministic plans at three scales (no-op, small, large), runs the
 * real core reply builders against them, and records bytes/characters of the
 * produced payloads. Model tokens are NOT measurable at the core layer; the
 * field stays null with a note, and real MCP reply bytes are captured by
 * packages/plan-mcp/test/agent-brain-baseline-mcp.test.mjs.
 *
 * Measurements distinguish product scenarios (real PlanStore fixtures, real
 * reply builders) from synthetic SQL primitives — nothing here touches a
 * database or a live server.
 *
 * The detailed report is written to a temp artifact (override with env
 * AB_BASELINE_REPORT); the checked-in snapshot lives at
 * docs/agent-brain/baseline/measurements.json.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import {
  PlanStore,
  FeatureSchema,
  PhaseSchema,
  TaskSchema,
  createFeatureId,
  createPhaseId,
  createTaskId,
  recommendNextWork,
  buildRecommendationReply,
} from "../dist/index.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NOW = "2026-11-14T00:00:00.000Z";
const dirs = [];
after(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

const bytes = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");
const chars = (value) => (typeof value === "string" ? value.length : 0);

async function buildScaledPlan(name, featuresCount, phasesPerFeature, tasksPerPhase) {
  const root = await mkdtemp(join(tmpdir(), `ab-measure-${name}-`));
  dirs.push(root);
  const store = new PlanStore(join(root, ".planner"));
  await store.init(`measurement ${name}`);
  for (let f = 1; f <= featuresCount; f++) {
    const feature = FeatureSchema.parse({ id: createFeatureId(), number: f, name: `Feature ${f}`, priority: f * 10, createdAt: NOW, updatedAt: NOW });
    await store.saveFeature(feature);
    for (let p = 1; p <= phasesPerFeature; p++) {
      const phase = PhaseSchema.parse({ id: createPhaseId(), number: p, featureId: feature.id, slug: `phase-${p}`, title: `Phase ${f}.${p}`, priority: p, createdAt: NOW, updatedAt: NOW });
      await store.savePhase(phase);
      for (let t = 1; t <= tasksPerPhase; t++) {
        const task = TaskSchema.parse({
          id: createTaskId(), phaseId: phase.id, number: t,
          shortName: `t${t}`, title: `Task ${f}.${p}.${t}`, status: "planned",
          description: `Implement part ${t} of phase ${f}.${p}.`, createdAt: NOW, updatedAt: NOW,
        });
        await store.updatePhase(phase.id, (current) => ({ ...current, tasks: [...current.tasks, task], taskIds: [...current.taskIds, task.id] }));
      }
    }
  }
  const features = (await store.loadFeatures()).features;
  const phases = await store.loadAllPhases();
  return { store, features, phases, entityCount: featuresCount + featuresCount * phasesPerFeature + featuresCount * phasesPerFeature * tasksPerPhase };
}

function measureScenario(label, features, phases) {
  const work = recommendNextWork(features, phases);
  const reply = buildRecommendationReply(work, features);
  return {
    scenario: label,
    entityCount: features.length + phases.length + phases.reduce((sum, phase) => sum + phase.tasks.length, 0),
    recommendationBytes: bytes(work),
    recommendationReplyBytes: bytes(reply),
    recommendationReplyTextChars: chars(reply.text),
    recommendationStructuredChars: chars(JSON.stringify(reply.structured ?? reply)),
    selectionKind: work.selection.kind,
    claimCount: work.claims.length,
    onHoldCount: work.onHold.length,
    modelTokens: null,
    note: "Core-layer measurement over real PlanStore fixtures; model tokens are adapter-visible only.",
  };
}

describe("T461 baseline measurements — comparable plan scales", () => {
  test("no-op, small and large plans produce comparable bounded measurements", async () => {
    const noOp = await buildScaledPlan("noop", 0, 0, 0);
    const small = await buildScaledPlan("small", 3, 2, 3);
    const large = await buildScaledPlan("large", 8, 6, 12);
    assert.equal(noOp.entityCount, 0);
    assert.equal(small.entityCount, 3 + 6 + 18);
    assert.equal(large.entityCount, 8 + 48 + 576);

    const report = {
      schemaVersion: 1,
      capturedAt: NOW,
      runner: "packages/plan-core/test/agent-brain-baseline-measurements.test.mjs",
      scope: "product-scenario",
      measurements: [
        measureScenario("no-op", noOp.features, noOp.phases),
        measureScenario("small", small.features, small.phases),
        measureScenario("large", large.features, large.phases),
      ],
    };
    // Product-scenario invariants: monotone growth, bounded claim lists.
    const [noOpM, smallM, largeM] = report.measurements;
    assert.equal(noOpM.selectionKind, "none");
    assert.ok(noOpM.recommendationBytes > 0, "even a no-op recommendation serializes to bytes");
    assert.ok(smallM.recommendationBytes < largeM.recommendationBytes, "small < large recommendation payload");
    assert.ok(largeM.claimCount <= 8, "claim list stays bounded at scale");
    assert.ok(smallM.selectionKind === "priority" && smallM.claimCount > 0);

    const target = process.env.AB_BASELINE_REPORT ?? join(tmpdir(), `ab-baseline-report-${Date.now()}.json`);
    await writeFile(target, JSON.stringify(report, null, 2));
    if (process.env.AB_BASELINE_REPORT) console.log(`[ab-baseline] report written to ${target}`);
  });

  test("parked work renders bounded on-hold context on a large plan", async () => {
    const { store } = await buildScaledPlan("parked", 2, 2, 4);
    const phases = await store.loadAllPhases();
    const features = (await store.loadFeatures()).features;
    // Park two tasks in the first phase with hold reasons naming finished refs.
    const firstPhase = phases[0];
    await store.updatePhase(firstPhase.id, (current) => ({
      ...current,
      tasks: current.tasks.map((task, index) => index < 2
        ? { ...task, status: "waiting", updatedAt: NOW, statusLog: [{ id: `log-${task.number}`, date: NOW, fromStatus: "planned", toStatus: "waiting", title: `Hold ${task.title}`, description: `Resume once ${features[1].name} lands.` }] }
        : task),
    }));
    const { listOnHoldWork, renderOnHoldWork } = await import("../dist/index.js");
    const reloaded = await store.loadAllPhases();
    const onHold = listOnHoldWork((await store.loadFeatures()).features, reloaded);
    assert.equal(onHold.length, 2);
    const rendered = renderOnHoldWork(onHold);
    assert.ok(rendered.length > 0 && rendered.length < 2000, "on-hold render stays bounded");
  });
});
