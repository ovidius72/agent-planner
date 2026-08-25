import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FeatureSchema,
  PhaseSchema,
  PlanStore,
  createFeatureId,
  createPhaseId,
  createTaskId,
} from "../dist/index.js";

const roots = [];
after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "handoff-context-"));
  roots.push(root);
  const store = new PlanStore(join(root, ".planner"));
  await store.init("Handoff context test");
  const now = new Date().toISOString();
  const feature = FeatureSchema.parse({
    id: createFeatureId(), number: 1, name: "Feature", description: "Scope", createdAt: now, updatedAt: now,
  });
  await store.saveFeature(feature);
  const phaseId = createPhaseId();
  const doneTaskId = createTaskId();
  const plannedTaskId = createTaskId();
  const phase = PhaseSchema.parse({
    id: phaseId,
    number: 1,
    featureId: feature.id,
    slug: "phase",
    title: "Phase",
    description: "Phase scope",
    createdAt: now,
    updatedAt: now,
    tasks: [
      {
        id: doneTaskId, number: 1, phaseId, shortName: "done", title: "Done without evidence", status: "done",
        description: "Original execution context", startedAt: now, completedAt: now, createdAt: now, updatedAt: now,
      },
      {
        id: plannedTaskId, number: 2, phaseId, shortName: "planned", title: "Still planned", status: "planned",
        description: "Next task", createdAt: now, updatedAt: now,
      },
    ],
    taskIds: [doneTaskId, plannedTaskId],
  });
  await store.savePhase(phase);
  return { store, feature, phaseId, doneTaskId };
}

function refreshInput(audit, doneTaskId, overrides = {}) {
  return {
    content: [
      "# P001(F001) — reconciled handoff",
      "",
      "Created at: 2026-08-24T00:00:00.000Z",
      "Updated at: 2026-08-24T00:00:00.000Z",
      "Reason: session boundary",
      "",
      "## Current focus", "Continue the phase.",
      "## What was being done", "Implementing reconciliation.",
      "## How to resume", "Continue adapter wiring.",
      "## Files touched", "- packages/plan-core/src/handoff-context.ts",
      "## Blockers", "- None",
      "## Next steps", "- Wire adapters",
      "## Recent decisions", "- Keep one active handoff",
    ].join("\n"),
    expectedHandoffUpdatedAt: audit.handoffUpdatedAt,
    reconciledExistingHandoff: true,
    contextSync: {
      taskUpdates: [{
        taskId: doneTaskId,
        completionSummary: "Implemented the durable context contract.",
        verification: "Unit coverage passed; visual verification was partial.",
        remainingWork: "Run the remaining visual verification.",
        filesTouched: ["packages/plan-core/src/handoff-context.ts"],
        decisions: ["Keep one active handoff."],
      }],
      phaseUpdate: {
        progressSummary: "The core refresh contract is implemented.",
        remainingWork: "Wire both adapters.",
        decisions: ["Refresh without superseded archives."],
      },
      featureUpdate: {
        workDone: "Core handoff reconciliation implemented.",
        workRemaining: "Adapter integration remains.",
      },
    },
    ...overrides,
  };
}

describe("durable handoff context refresh", () => {
  test("audits missing task evidence and refreshes one handoff with entity context", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    await store.setPhaseHandoff(phaseId, "# P001(F001) — existing context\n\nKeep this decision.");
    const audit = await store.preparePhaseHandoff(phaseId);
    assert.deepEqual(audit.missingCompletionTaskIds, [doneTaskId]);
    assert.match(audit.handoff, /Keep this decision/);

    const result = await store.refreshPhaseHandoff(phaseId, refreshInput(audit, doneTaskId));
    assert.equal(result.updatedTaskIds[0], doneTaskId);
    const phase = await store.loadPhase(phaseId);
    const task = phase.tasks.find((candidate) => candidate.id === doneTaskId);
    assert.match(task.description, /Completion summary/);
    assert.match(task.description, /visual verification was partial/);
    assert.match(phase.notes, /core refresh contract is implemented/);
    assert.equal(phase.handoffHistory.length, 0, "refresh must not archive a superseded handoff");
    const feature = (await store.loadFeatures()).features[0];
    assert.match(feature.workDone, /Core handoff reconciliation implemented/);
    assert.match(feature.workRemaining, /Adapter integration remains/);
  });

  test("rejects stale handoff tokens and missing task evidence without mutation", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    await store.setPhaseHandoff(phaseId, "# Existing");
    const audit = await store.preparePhaseHandoff(phaseId);
    const before = await store.loadPhase(phaseId);

    await assert.rejects(
      store.refreshPhaseHandoff(phaseId, refreshInput(audit, doneTaskId, { expectedHandoffUpdatedAt: "stale" })),
      /Handoff changed after preparation/,
    );
    await assert.rejects(
      store.refreshPhaseHandoff(phaseId, {
        ...refreshInput(audit, doneTaskId),
        contextSync: {
          ...refreshInput(audit, doneTaskId).contextSync,
          taskUpdates: [],
        },
      }),
      /missing durable completion evidence/,
    );
    assert.deepEqual(await store.loadPhase(phaseId), before);
  });

  test("rolls back feature context if phase persistence fails", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    await store.setPhaseHandoff(phaseId, "# Existing");
    const audit = await store.preparePhaseHandoff(phaseId);
    const beforePhase = await store.loadPhase(phaseId);
    const beforeFeatures = await store.loadFeatures();
    const savePhase = store.savePhase.bind(store);
    let calls = 0;
    store.savePhase = async (phase) => {
      calls += 1;
      if (calls === 1) throw new Error("injected phase persistence failure");
      return savePhase(phase);
    };

    await assert.rejects(store.refreshPhaseHandoff(phaseId, refreshInput(audit, doneTaskId)), /injected phase persistence failure/);
    store.savePhase = savePhase;
    assert.deepEqual(await store.loadPhase(phaseId), beforePhase);
    assert.deepEqual(await store.loadFeatures(), beforeFeatures);
  });

  test("keeps legacy setPhaseHandoff superseded-archive behavior compatible", async () => {
    const { store, phaseId } = await setup();
    await store.setPhaseHandoff(phaseId, "# First handoff");
    await store.setPhaseHandoff(phaseId, "# Replacement handoff");
    const phase = await store.loadPhase(phaseId);
    assert.equal(phase.handoffHistory.length, 1);
    assert.equal(phase.handoffHistory[0].reason, "superseded");
  });
});
