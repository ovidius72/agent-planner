import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  FeatureSchema,
  PhaseSchema,
  PlanStore,
  createFeatureId,
  createPhaseId,
  createTaskId,
  HANDOFF_COMPLETENESS_AUDIT_VERSION,
  HANDOFF_COMPLETENESS_CATEGORIES,
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

function completeAudit() {
  return {
    version: HANDOFF_COMPLETENESS_AUDIT_VERSION,
    entries: HANDOFF_COMPLETENESS_CATEGORIES.map(({ id, label }) => ({
      category: id,
      status: "captured",
      detail: `${label} is captured with concrete operational context for the next agent.`,
    })),
  };
}

function refreshInput(audit, doneTaskId, overrides = {}) {
  const completenessAudit = completeAudit();
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
    completenessAudit,
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
    const now = new Date().toISOString();
    const unrelatedFeature = FeatureSchema.parse({
      id: createFeatureId(), number: 2, name: "Unrelated feature", description: "Must remain byte-for-byte unrelated to the handoff refresh.", phaseIds: ["preserve-this-reference"], createdAt: now, updatedAt: now,
    });
    await store.saveFeature(unrelatedFeature);
    const unrelatedBefore = (await store.loadFeatures()).features.find((feature) => feature.id === unrelatedFeature.id);
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
    const unrelatedAfter = (await store.loadFeatures()).features.find((candidate) => candidate.id === unrelatedFeature.id);
    assert.deepEqual(unrelatedAfter, unrelatedBefore, "handoff refresh must not rewrite unrelated feature metadata");
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

  test("rejects missing or non-substantive completeness audits without mutation", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    const audit = await store.preparePhaseHandoff(phaseId);
    const before = await store.loadPhase(phaseId);
    const input = refreshInput(audit, doneTaskId);

    await assert.rejects(
      store.refreshPhaseHandoff(phaseId, { ...input, completenessAudit: undefined }),
      (error) => {
        assert.equal(error.code, "HANDOFF_COMPLETENESS_AUDIT_REQUIRED");
        assert.equal(error.details.missingCategories.length, HANDOFF_COMPLETENESS_CATEGORIES.length);
        return true;
      },
    );

    const invalid = completeAudit();
    invalid.entries[0] = { category: invalid.entries[0].category, status: "not-applicable", detail: "N/A" };
    await assert.rejects(
      store.refreshPhaseHandoff(phaseId, { ...input, completenessAudit: invalid }),
      (error) => {
        assert.equal(error.code, "HANDOFF_COMPLETENESS_AUDIT_REQUIRED");
        assert.ok(error.details.invalidCategories.includes(invalid.entries[0].category));
        return true;
      },
    );
    assert.deepEqual(await store.loadPhase(phaseId), before);
  });

  test("rejects the reported branch, tool, runtime, behavior, and operator omissions until captured", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    const prepared = await store.preparePhaseHandoff(phaseId);
    const input = refreshInput(prepared, doneTaskId);
    const omitted = new Set(["branch-worktree", "commands-tools", "runtime-limitations-workarounds", "user-visible-behavior", "operator-actions", "project-operating-notes"]);
    const incompleteAudit = {
      ...input.completenessAudit,
      entries: input.completenessAudit.entries.filter((entry) => !omitted.has(entry.category)),
    };
    await assert.rejects(
      store.refreshPhaseHandoff(phaseId, { ...input, completenessAudit: incompleteAudit }),
      (error) => {
        assert.equal(error.code, "HANDOFF_COMPLETENESS_AUDIT_REQUIRED");
        assert.deepEqual(new Set(error.details.missingCategories), omitted);
        return true;
      },
    );

    const complete = completeAudit();
    const detailByCategory = {
      "branch-worktree": "Resume only on branch feat/notification-system-app in its existing worktree with uncommitted changes preserved.",
      "commands-tools": "Temporarily call Notification::info(\"x\").send() immediately after mount_notification_stack in startup.rs for verification.",
      "runtime-limitations-workarounds": "There is no RPC transport; use the temporary Rust toast call and remove it after manual verification.",
      "user-visible-behavior": "A visible notification toast appears after startup and remains operable through the mounted notification stack.",
      "operator-actions": "Antonio must launch the app, drive the notification flow, confirm the toast, and report the observed behavior.",
      "project-operating-notes": "Use composite planner refs because bare T### refs collide; centralize grep results before reporting.",
    };
    complete.entries = complete.entries.map((entry) => detailByCategory[entry.category]
      ? { ...entry, detail: detailByCategory[entry.category] }
      : entry);
    await store.refreshPhaseHandoff(phaseId, { ...input, completenessAudit: complete });
    const persisted = await store.loadPhase(phaseId);
    assert.match(persisted.handoff, /feat\/notification-system-app/);
    assert.match(persisted.handoff, /Notification::info\("x"\)\.send\(\)/);
    assert.match(persisted.handoff, /Antonio must launch the app/);
  });

  test("persists verified audit metadata and validated supporting documents", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    await mkdir(join(store.root, "docs"), { recursive: true });
    const supportingPath = join(store.root, "docs", "handoff-detail.md");
    const supportingContent = "# Extended handoff detail\n\nExact command logs and design mappings for resumption.\n";
    await writeFile(supportingPath, supportingContent, "utf8");
    const audit = await store.preparePhaseHandoff(phaseId);
    const baseInput = refreshInput(audit, doneTaskId);
    const supportingDocuments = [{ path: ".planner/docs/handoff-detail.md", description: "Exact command logs and design mappings required for resumption." }];
    await assert.rejects(
      store.refreshPhaseHandoff(phaseId, { ...baseInput, supportingDocuments }),
      (error) => {
        assert.equal(error.code, "HANDOFF_SUPPORTING_DOCUMENT_INVALID");
        assert.match(error.message, /must link supporting document/);
        return true;
      },
    );
    const input = {
      ...baseInput,
      content: `${baseInput.content}\n\n## Supporting documents\n- [.planner/docs/handoff-detail.md](.planner/docs/handoff-detail.md) — exact command logs and design mappings required for resumption.`,
      supportingDocuments,
    };

    await store.refreshPhaseHandoff(phaseId, input);
    const phase = await store.loadPhase(phaseId);
    assert.equal(phase.handoffAudit.version, HANDOFF_COMPLETENESS_AUDIT_VERSION);
    assert.equal(phase.handoffAudit.contentLength, phase.handoff.length);
    assert.equal(phase.handoffAudit.contentHash, createHash("sha256").update(phase.handoff, "utf8").digest("hex"));
    assert.equal(phase.handoffAudit.entries.length, HANDOFF_COMPLETENESS_CATEGORIES.length);
    assert.deepEqual(phase.handoffAudit.supportingDocuments[0], {
      path: ".planner/docs/handoff-detail.md",
      description: "Exact command logs and design mappings required for resumption.",
      contentHash: createHash("sha256").update(supportingContent, "utf8").digest("hex"),
      contentLength: supportingContent.length,
    });
  });

  test("rolls back when persisted handoff read-back does not match the verified hash", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    const prepared = await store.preparePhaseHandoff(phaseId);
    const beforePhase = await store.loadPhase(phaseId);
    const beforeFeatures = await store.loadFeatures();
    const loadPhase = store.loadPhase.bind(store);
    store.loadPhase = async (id) => {
      const phase = await loadPhase(id);
      return phase.handoffAudit ? { ...phase, handoff: `${phase.handoff}\nread-back mismatch` } : phase;
    };

    await assert.rejects(
      store.refreshPhaseHandoff(phaseId, refreshInput(prepared, doneTaskId)),
      (error) => {
        assert.equal(error.code, "HANDOFF_PERSISTENCE_VERIFICATION_FAILED");
        return true;
      },
    );
    store.loadPhase = loadPhase;
    assert.deepEqual(await store.loadPhase(phaseId), beforePhase);
    assert.deepEqual(await store.loadFeatures(), beforeFeatures);
  });

  test("rejects canonical handoff bodies above the deterministic inline limit", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    const audit = await store.preparePhaseHandoff(phaseId);
    const baseInput = refreshInput(audit, doneTaskId);
    const input = { ...baseInput, content: `${baseInput.content}\n${"x".repeat(24_001)}` };
    await assert.rejects(
      store.refreshPhaseHandoff(phaseId, input),
      (error) => {
        assert.equal(error.code, "HANDOFF_CONTENT_LIMIT_EXCEEDED");
        assert.equal(error.details.maxContentChars, 24_000);
        return true;
      },
    );
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
