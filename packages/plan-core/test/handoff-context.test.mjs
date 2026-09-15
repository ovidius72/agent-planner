import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  HANDOFF_COLD_START_INVENTORY_VERSION,
  HANDOFF_COLD_START_SOURCE_REVIEWS,
  HANDOFF_COLD_START_INVENTORY_CATEGORIES,
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

function completeColdStartInventory(overrides = {}) {
  const items = {
    files: ["packages/plan-core/src/handoff-context.ts"],
    symbols: ["applyHandoffContextSync"],
    "working-tree-ownership": ["The handoff diff is complete and must be preserved"],
    "negative-state": ["No deletion has started and unrelated files remain untouched"],
    "commands-tools": ["pnpm test"],
    "runtime-wiring": ["runtime wiring between phase and feature context"],
    "preservation-constraints": ["Existing handoff archive behavior must survive"],
    "verification-evidence": ["Focused unit verification passed for the refresh contract"],
    "related-planned-work": ["Adapter wiring remains tracked as related planned work"],
    "user-visible-behavior": ["User-visible handoff resume behavior remains stable"],
    "operator-actions": ["run pnpm test and inspect the persisted handoff"],
    "blockers-risks": ["No known blocker"],
    "remaining-work": ["Wire adapters"],
    "ordered-resume-steps": ["Continue adapter wiring with pnpm test"],
    ...overrides,
  };
  return {
    version: HANDOFF_COLD_START_INVENTORY_VERSION,
    sourceReviews: HANDOFF_COLD_START_SOURCE_REVIEWS.map(({ id, label }) => ({
      source: id,
      detail: `${label} was reviewed before drafting and concrete resume facts were extracted.`,
    })),
    entries: HANDOFF_COLD_START_INVENTORY_CATEGORIES.map(({ id }) => ({ category: id, items: items[id] })),
  };
}

function completeReadBackSourceReviews() {
  return HANDOFF_COLD_START_SOURCE_REVIEWS.map(({ id, label }) => ({
    source: id,
    detail: `${label} was compared again with the complete persisted handoff body and no omitted resume fact was found.`,
  }));
}

function refreshInput(audit, doneTaskId, overrides = {}) {
  const completenessAudit = completeAudit();
  return {
    reason: "Session boundary requires a cold-resume handoff.",
    content: [
      "# P001(F001) — reconciled handoff",
      "",
      "Created at: 2026-08-24T00:00:00.000Z",
      "Updated at: 2026-08-24T00:00:00.000Z",
      "Reason: session boundary",
      "",
      "## Current focus", "Continue the phase.",
      "## Current and partial state", "Implementing the reconciled handoff contract. User-visible handoff resume behavior remains stable. The handoff diff is complete and must be preserved; applyHandoffContextSync preserves runtime wiring between phase and feature context. Focused unit verification passed for the refresh contract. Adapter wiring remains tracked as related planned work. Wire adapters.",
      "## Preservation constraints", "Existing handoff archive behavior must survive. No deletion has started and unrelated files remain untouched.",
      "## Supporting documents", "- packages/plan-core/src/handoff-context.ts — Inline resume capsule reference; extended detail in .planner/docs/handoff-core-refresh.md.",
      "## Blockers and risks", "- No known blocker.",
      "## How to resume", "1. Continue adapter wiring with pnpm test; run pnpm test and inspect the persisted handoff.",
    ].join("\n"),
    expectedHandoffUpdatedAt: audit.handoffUpdatedAt,
    reconciledExistingHandoff: true,
    completenessAudit,
    coldStartInventory: completeColdStartInventory(),
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
    assert.deepEqual(audit.canonicalSections, ["Current focus", "Current and partial state", "Preservation constraints", "Supporting documents", "Blockers and risks", "How to resume"]);
    assert.deepEqual(audit.requiredHumanInputs.map((input) => input.id), ["title", "reason"]);
    assert.match(audit.draftTemplate, /Planner-generated: Created at, Updated at, and structured Reason/);
    assert.match(audit.draftTemplate, /## How to resume/);
    assert.equal(audit.phaseWorkMap.total, 2);
    assert.deepEqual(audit.phaseWorkMap.entries.map((entry) => entry.ref), ["P001(F001)/T001", "P001(F001)/T002"]);
    assert.equal(audit.phaseWorkMap.entries[0].remainingCapabilityOwner, false);
    assert.equal(audit.phaseWorkMap.entries[1].remainingCapabilityOwner, true);
    assert.equal(audit.phaseWorkMap.entries[1].ref, "P001(F001)/T002");
    assert.equal(audit.coldStartSourceReviews.length, HANDOFF_COLD_START_SOURCE_REVIEWS.length);
    assert.equal(audit.coldStartInventoryCategories.length, HANDOFF_COLD_START_INVENTORY_CATEGORIES.length);

    const result = await store.refreshPhaseHandoff(phaseId, refreshInput(audit, doneTaskId));
    assert.equal(result.updatedTaskIds[0], doneTaskId);
    assert.equal(result.handoffAudit.resumeReadyAt, "", "a structurally valid write is still only a candidate");
    assert.deepEqual(result.handoffAudit.readBackSourceReviews, []);
    const legacyAudit = structuredClone(result.handoffAudit);
    delete legacyAudit.resumeReadyAt;
    delete legacyAudit.readBackSourceReviews;
    const parsedLegacy = PhaseSchema.parse({ ...result.phase, handoffAudit: legacyAudit });
    assert.equal(parsedLegacy.handoffAudit.resumeReadyAt, "", "legacy audits remain readable as unverified candidates");
    assert.deepEqual(parsedLegacy.handoffAudit.readBackSourceReviews, []);
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

  test("requires a separate persisted read-back before a handoff becomes resume-ready", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    const audit = await store.preparePhaseHandoff(phaseId);
    const written = await store.refreshPhaseHandoff(phaseId, refreshInput(audit, doneTaskId));
    const summaryBefore = (await store.listHandoffs()).find((entry) => entry.phaseId === phaseId);
    assert.equal(summaryBefore.resumeReady, false);

    await assert.rejects(
      store.verifyPhaseHandoffReadBack(phaseId, {
        expectedContentHash: written.handoffAudit.contentHash,
        sourceReviews: completeReadBackSourceReviews(),
        omissionsFound: ["The prior rewrite sequence is missing."],
      }),
      (error) => {
        assert.equal(error.code, "HANDOFF_READBACK_GAPS_FOUND");
        assert.deepEqual(error.details.omissionsFound, ["The prior rewrite sequence is missing."]);
        return true;
      },
    );
    assert.equal((await store.loadPhase(phaseId)).handoffAudit.resumeReadyAt, "");

    const verified = await store.verifyPhaseHandoffReadBack(phaseId, {
      expectedContentHash: written.handoffAudit.contentHash,
      sourceReviews: completeReadBackSourceReviews(),
      omissionsFound: [],
    });
    assert.equal(verified.contentHash, written.handoffAudit.contentHash);
    assert.ok(verified.resumeReadyAt);
    assert.equal(verified.sourceReviews.length, HANDOFF_COLD_START_SOURCE_REVIEWS.length);
    const summaryAfter = (await store.listHandoffs()).find((entry) => entry.phaseId === phaseId);
    assert.equal(summaryAfter.resumeReady, true);
  });

  test("rejects stale handoff read-back hashes without marking the candidate ready", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    const audit = await store.preparePhaseHandoff(phaseId);
    await store.refreshPhaseHandoff(phaseId, refreshInput(audit, doneTaskId));
    await assert.rejects(
      store.verifyPhaseHandoffReadBack(phaseId, {
        expectedContentHash: "0".repeat(64),
        sourceReviews: completeReadBackSourceReviews(),
        omissionsFound: [],
      }),
      (error) => {
        assert.equal(error.code, "HANDOFF_READBACK_VERIFICATION_REQUIRED");
        return true;
      },
    );
    assert.equal((await store.loadPhase(phaseId)).handoffAudit.resumeReadyAt, "");
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

  test("accepts compact handoffs without duplicate audit or inventory prose", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    const audit = await store.preparePhaseHandoff(phaseId);
    const before = await store.loadPhase(phaseId);
    const input = refreshInput(audit, doneTaskId);

    await store.refreshPhaseHandoff(phaseId, {
      ...input,
      completenessAudit: undefined,
      coldStartInventory: undefined,
    });
    const compactPersisted = await store.loadPhase(phaseId);
    assert.notEqual(compactPersisted.handoff, before.handoff);
    assert.equal(compactPersisted.handoffAudit?.coldStartInventory?.entries.length, HANDOFF_COLD_START_INVENTORY_CATEGORIES.length);
    const beforeInvalid = compactPersisted;

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
    const missingSourceReview = completeColdStartInventory();
    missingSourceReview.sourceReviews = missingSourceReview.sourceReviews.slice(1);
    await assert.rejects(
      store.refreshPhaseHandoff(phaseId, { ...input, coldStartInventory: missingSourceReview }),
      (error) => {
        assert.equal(error.code, "HANDOFF_COLD_START_INVENTORY_REQUIRED");
        assert.ok(error.details.missingSources.includes("conversation"));
        return true;
      },
    );
    await assert.rejects(
      store.refreshPhaseHandoff(phaseId, { ...input, content: "# Draft with {{REQUIRED:resume-point}}" }),
      (error) => {
        assert.equal(error.code, "HANDOFF_CANONICAL_SECTIONS_REQUIRED");
        assert.deepEqual(error.details.missingSections, []);
        assert.deepEqual(error.details.unresolvedPlaceholders, ["{{REQUIRED:resume-point}}"]);
        return true;
      },
    );
    assert.deepEqual(await store.loadPhase(phaseId), beforeInvalid);
  });

  test("accepts concise free-form resume capsules without scaffold headings", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    const prepared = await store.preparePhaseHandoff(phaseId);
    const input = refreshInput(prepared, doneTaskId, {
      content: "Resume T001 at packages/plan-core/src/handoff-context.ts:648; preserve the current compact contract. Focused tests pass. Next: rerun the handoff suite.",
      completenessAudit: undefined,
      coldStartInventory: undefined,
    });

    const result = await store.refreshPhaseHandoff(phaseId, input);
    assert.match(result.phase.handoff, /Resume T001 at packages\/plan-core\/src\/handoff-context\.ts:648/);
    assert.doesNotMatch(result.phase.handoff, /What was being done|Files touched|Recent decisions/);
  });

  test("rejects unresolved handoff placeholders before persistence", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    const prepared = await store.preparePhaseHandoff(phaseId);
    const before = await store.loadPhase(phaseId);
    const input = refreshInput(prepared, doneTaskId, {
      content: "Resume from {{REQUIRED:exact-focus-resume-point}}.",
      completenessAudit: undefined,
      coldStartInventory: undefined,
    });

    await assert.rejects(
      store.refreshPhaseHandoff(phaseId, input),
      (error) => {
        assert.equal(error.code, "HANDOFF_CANONICAL_SECTIONS_REQUIRED");
        assert.deepEqual(error.details.missingSections, []);
        assert.deepEqual(error.details.unresolvedPlaceholders, ["{{REQUIRED:exact-focus-resume-point}}"]);
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
    const details = Object.fromEntries(persisted.handoffAudit.entries.map((entry) => [entry.category, entry.detail]));
    assert.match(details["branch-worktree"], /feat\/notification-system-app/);
    assert.match(details["commands-tools"], /Notification::info\("x"\)\.send\(\)/);
    assert.match(details["operator-actions"], /Antonio must launch the app/);
  });

  test("rejects omitted concrete wiring before persistence and accepts it once represented", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    const prepared = await store.preparePhaseHandoff(phaseId);
    const baseInput = refreshInput(prepared, doneTaskId);
    const reportedSymbols = [
      "drain_pending_drops",
      "install_drop_sink",
      "pending_drops",
      "pane_drop_row",
      "DragItemRegistry",
      "column_drop",
      "accept_drop",
      "showcase",
      "Dropped",
      "drag_identity",
      "paint_drag_feedback",
      "resolve_at_for",
      "DropHit",
    ];
    const coldStartInventory = completeColdStartInventory({
      files: ["startup.rs", "heca/src/mouse.rs", "chrome/scene.rs", "mouse/interactive.rs"],
      symbols: reportedSymbols,
      "working-tree-ownership": ["The uncommitted diff is finished work and must not be discarded; commit approval remains with the user"],
      "negative-state": ["No deletion has started and nothing is half-removed"],
      "runtime-wiring": ["heca/src/mouse.rs release path branches on drag_ctx.active_surface and calls handle_interactive_move_release plus both sidebar release handlers"],
      "preservation-constraints": ["mouse/interactive.rs must keep cancel_all() and surface iteration working"],
      "verification-evidence": ["chrome/scene.rs paints LeftSidebar with phase Dragging, but nothing sets that phase, so deleting it must produce no visible change"],
      "related-planned-work": ["Sidebar removal stays separate from the surviving interactive-move path"],
    });

    await assert.rejects(
      store.refreshPhaseHandoff(phaseId, { ...baseInput, coldStartInventory }),
      (error) => {
        assert.equal(error.code, "HANDOFF_COLD_START_INVENTORY_UNCOVERED");
        const uncovered = error.details.uncoveredItems.map(({ item }) => item);
        assert.ok(uncovered.includes("startup.rs"));
        assert.ok(uncovered.includes("drain_pending_drops"));
        assert.ok(uncovered.includes("DropHit"));
        return true;
      },
    );
    assert.equal((await store.loadPhase(phaseId)).handoff, "");

    const completeContent = `${baseInput.content}\n\n## Concrete cold-start evidence\n- Files: startup.rs, heca/src/mouse.rs, chrome/scene.rs, mouse/interactive.rs.\n- Symbols: ${reportedSymbols.join(", ")}.\n- The uncommitted diff is finished work and must not be discarded; commit approval remains with the user.\n- No deletion has started and nothing is half-removed.\n- heca/src/mouse.rs release path branches on drag_ctx.active_surface and calls handle_interactive_move_release plus both sidebar release handlers.\n- mouse/interactive.rs must keep cancel_all() and surface iteration working.\n- chrome/scene.rs paints LeftSidebar with phase Dragging, but nothing sets that phase, so deleting it must produce no visible change.\n- Sidebar removal stays separate from the surviving interactive-move path.`;
    await store.refreshPhaseHandoff(phaseId, { ...baseInput, content: completeContent, coldStartInventory });
    const persisted = await store.loadPhase(phaseId);
    assert.equal(persisted.handoffAudit.coldStartInventory.version, HANDOFF_COLD_START_INVENTORY_VERSION);
    assert.deepEqual(
      persisted.handoffAudit.coldStartInventory.entries.find((entry) => entry.category === "symbols").items,
      reportedSymbols,
    );
    for (const symbol of reportedSymbols) assert.match(persisted.handoff, new RegExp(symbol));
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
      coldStartInventory: completeColdStartInventory({ "commands-tools": ["Exact command logs and design mappings for resumption"] }),
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

  test("a linked document survives auto-externalization moving its section out of the body", async () => {
    // T414: the reported failure. The agent links a document and cites its path
    // in a section that auto-externalization later moves into .planner/docs/.
    // Validation used to run against the rewritten body, so the path was gone and
    // HANDOFF_SUPPORTING_DOCUMENT_INVALID fired on a correctly linked document.
    const { store, phaseId, doneTaskId } = await setup();
    await mkdir(join(store.root, "docs"), { recursive: true });
    const supportingContent = "# Extended detail\n\nCommand logs and design mappings for resumption.\n";
    await writeFile(join(store.root, "docs", "t414-detail.md"), supportingContent, "utf8");
    const audit = await store.preparePhaseHandoff(phaseId);
    const baseInput = refreshInput(audit, doneTaskId);

    // Push the body well past the externalization target, with the document link
    // inside a section the rewrite relocates.
    const filler = "Resume detail that pads the capsule past the inline target. ".repeat(220);
    const content = [
      baseInput.content,
      "",
      "## Supporting documents",
      "- `.planner/docs/t414-detail.md` — command logs and design mappings required for resumption.",
      "",
      "## Current and partial state",
      filler,
    ].join("\n");

    await store.refreshPhaseHandoff(phaseId, {
      ...baseInput,
      content,
      supportingDocuments: [{ path: ".planner/docs/t414-detail.md", description: "Command logs and design mappings required for resumption." }],
    });

    const phase = await store.loadPhase(phaseId);
    assert.ok(phase.handoff.length > 0, "handoff persisted");
    const paths = phase.handoffAudit.supportingDocuments.map((doc) => doc.path);
    assert.ok(paths.includes(".planner/docs/t414-detail.md"), "the agent's document is recorded");
    assert.ok(paths.some((path) => /handoff-p\d+-/.test(path)), "the auto-externalized document is recorded too");
  });

  test("a document the agent never linked anywhere is still refused", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    await mkdir(join(store.root, "docs"), { recursive: true });
    await writeFile(join(store.root, "docs", "t414-unlinked.md"), "# Never referenced\n\nBody.\n", "utf8");
    const audit = await store.preparePhaseHandoff(phaseId);
    const baseInput = refreshInput(audit, doneTaskId);
    await assert.rejects(
      store.refreshPhaseHandoff(phaseId, {
        ...baseInput,
        supportingDocuments: [{ path: ".planner/docs/t414-unlinked.md", description: "Never mentioned in the capsule at all." }],
      }),
      (error) => {
        assert.equal(error.code, "HANDOFF_SUPPORTING_DOCUMENT_INVALID");
        assert.match(error.message, /must link supporting document/);
        assert.match(error.message, /Checked the/);
        return true;
      },
    );
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

  test("automatically externalizes oversized handoffs instead of failing the write", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    const audit = await store.preparePhaseHandoff(phaseId);
    const baseInput = refreshInput(audit, doneTaskId);
    const oversized = `${baseInput.content}\n${"x".repeat(9_000)}`;
    const result = await store.refreshPhaseHandoff(phaseId, { ...baseInput, content: oversized });
    assert.ok(result.phase.handoff.length <= 8_000, `compact handoff is ${result.phase.handoff.length} chars`);
    assert.equal(result.phase.handoffAudit.supportingDocuments.length, 1);
    const autoDoc = result.phase.handoffAudit.supportingDocuments[0];
    assert.match(autoDoc.path, /^\.planner\/docs\/handoff-p001-.*\.md$/);
    assert.match(result.phase.handoff, new RegExp(autoDoc.path.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")));
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const extended = await readFile(join(store.root, autoDoc.path.slice(".planner/".length)), "utf8");
    assert.ok(extended.includes("x".repeat(100)));
  });

  test("keeps the absolute compatibility ceiling on non-externalized rendering", async () => {
    const { renderVerifiedHandoffContent } = await import("../dist/index.js");
    const { store, phaseId, doneTaskId } = await setup();
    const audit = await store.preparePhaseHandoff(phaseId);
    const baseInput = refreshInput(audit, doneTaskId);
    const oversized = `${baseInput.content}\n${"x".repeat(24_001)}`;
    assert.throws(
      () => renderVerifiedHandoffContent(oversized, baseInput.completenessAudit, baseInput.coldStartInventory, []),
      (error) => {
        assert.equal(error.code, "HANDOFF_CONTENT_LIMIT_EXCEEDED");
        assert.equal(error.details.maxContentChars, 24_000);
        return true;
      },
    );
  });

  test("cold resume recovers exact task, resume point, documents, and next commands", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    await mkdir(join(store.root, "docs"), { recursive: true });
    const docPath = join(store.root, "docs", "cold-resume.md");
    const docContent = "# Cold resume detail\n\nExact extended design mapping and command transcript for the fresh reader.\n";
    await writeFile(docPath, docContent, "utf8");
    const audit = await store.preparePhaseHandoff(phaseId);
    const baseInput = refreshInput(audit, doneTaskId);
    const content = [
      "# P001(F001) — cold resume capsule",
      "",
      "Created at: 2026-08-24T00:00:00.000Z",
      "Updated at: 2026-08-24T00:00:00.000Z",
      "Reason: session boundary",
      "",
      "## Current focus",
      "Feature F001 — Feature. Phase P001(F001) — Phase. Task P001(F001)/T002 — Still planned.",
      "Exact resume point: packages/plan-core/src/handoff-context.ts applyHandoffContextSync.",
      "",
      "## Current and partial state",
      "Implementing the reconciled handoff contract. User-visible handoff resume behavior remains stable. The handoff diff is complete and must be preserved; applyHandoffContextSync preserves runtime wiring between phase and feature context. Focused unit verification passed for the refresh contract. Adapter wiring remains tracked as related planned work. Wire adapters.",
      "## Preservation constraints",
      "Existing handoff archive behavior must survive. No deletion has started and unrelated files remain untouched.",
      "## Supporting documents",
      "- .planner/docs/cold-resume.md — Exact extended design mapping and command transcript for the fresh reader.",
      "- packages/plan-core/src/handoff-context.ts — Inline resume capsule reference.",
      "## Blockers and risks",
      "- No known blocker.",
      "## How to resume",
      "1. Continue adapter wiring with pnpm test; run pnpm test and inspect the persisted handoff.",
    ].join("\n");
    const written = await store.refreshPhaseHandoff(phaseId, {
      ...baseInput,
      content,
      coldStartInventory: completeColdStartInventory({ files: ["packages/plan-core/src/handoff-context.ts"], "commands-tools": ["pnpm test", "Exact extended design mapping"] }),
      supportingDocuments: [{ path: ".planner/docs/cold-resume.md", description: "Exact extended design mapping and command transcript for the fresh reader." }],
    });
    assert.equal(written.handoffAudit.resumeReadyAt, "");
    const verified = await store.verifyPhaseHandoffReadBack(phaseId, {
      expectedContentHash: written.handoffAudit.contentHash,
      sourceReviews: completeReadBackSourceReviews(),
      omissionsFound: [],
    });
    assert.ok(verified.resumeReadyAt);
    // Fresh reader without conversation history: reload from disk in a new store.
    const { PlanStore: FreshStore } = await import("../dist/index.js");
    const fresh = new FreshStore(store.root);
    const phase = await fresh.loadPhase(phaseId);
    assert.match(phase.handoff, /P001\(F001\)\/T002/);
    assert.match(phase.handoff, /applyHandoffContextSync/);
    assert.match(phase.handoff, /\.planner\/docs\/cold-resume\.md/);
    assert.match(phase.handoff, /pnpm test/);
    assert.equal(phase.handoffAudit.supportingDocuments[0].path, ".planner/docs/cold-resume.md");
    assert.ok(phase.handoffAudit.resumeReadyAt, "fresh reader sees persisted resume readiness");
  });

  test("rejects symlinked supporting documents without writing", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    await mkdir(join(store.root, "docs"), { recursive: true });
    const realPath = join(store.root, "docs", "real-detail.md");
    await writeFile(realPath, "# Real detail\n\nSubstantive linked content.\n", "utf8");
    const linkPath = join(store.root, "docs", "linked-detail.md");
    try {
      const { symlink } = await import("node:fs/promises");
      await symlink(realPath, linkPath);
    } catch {
      return; // Filesystem does not support symlinks; nothing to enforce here.
    }
    const audit = await store.preparePhaseHandoff(phaseId);
    const baseInput = refreshInput(audit, doneTaskId);
    await assert.rejects(
      store.refreshPhaseHandoff(phaseId, {
        ...baseInput,
        content: `${baseInput.content}\n- .planner/docs/linked-detail.md — symlinked content.`,
        supportingDocuments: [{ path: ".planner/docs/linked-detail.md", description: "Substantive symlinked content for resumption." }],
      }),
      (error) => {
        assert.equal(error.code, "HANDOFF_SUPPORTING_DOCUMENT_INVALID");
        assert.match(error.message, /symlink/i);
        return true;
      },
    );
    assert.equal((await store.loadPhase(phaseId)).handoff, "");
  });

  test("prepare rejects a bad supporting-document path before any handoff body is drafted or sent", async () => {
    const { store, phaseId } = await setup();
    await assert.rejects(
      store.preparePhaseHandoff(phaseId, [{ path: "not-under-docs.md", description: "Substantive but wrongly placed content." }]),
      (error) => {
        assert.equal(error.code, "HANDOFF_SUPPORTING_DOCUMENT_INVALID");
        assert.match(error.message, /must be a Markdown file under \.planner\/docs\//);
        return true;
      },
    );
    // Prepare never took a body; nothing was persisted or sent.
    assert.equal((await store.loadPhase(phaseId)).handoff, "");
  });

  test("prepare error names supportingDocuments as an optional, droppable field", async () => {
    const { store, phaseId } = await setup();
    await assert.rejects(
      store.preparePhaseHandoff(phaseId, [{ path: ".planner/docs/missing.md", description: "Content that does not exist on disk." }]),
      (error) => {
        assert.equal(error.code, "HANDOFF_SUPPORTING_DOCUMENT_INVALID");
        assert.match(error.message, /must be a regular file/);
        assert.match(error.details.recovery, /supportingDocuments/);
        assert.match(error.details.recovery, /optional/i);
        assert.match(error.details.recovery, /externalized automatically/i);
        return true;
      },
    );
    // The same statement is surfaced proactively in prepare output, read before drafting.
    const audit = await store.preparePhaseHandoff(phaseId);
    assert.match(audit.supportingDocumentsGuidance, /supportingDocuments/);
    assert.match(audit.supportingDocumentsGuidance, /optional/i);
  });

  test("prepare with no manifest behaves exactly as today: no supporting-document validation runs", async () => {
    const { store, phaseId } = await setup();
    // No manifest argument at all, and an explicit empty array: neither touches
    // the filesystem for a supporting document, so both succeed identically.
    const withoutArg = await store.preparePhaseHandoff(phaseId);
    const withEmptyArray = await store.preparePhaseHandoff(phaseId, []);
    assert.equal(withoutArg.handoffUpdatedAt, withEmptyArray.handoffUpdatedAt);
    assert.equal(withoutArg.supportingDocumentsGuidance, withEmptyArray.supportingDocumentsGuidance);
  });

  test("write still refuses a supporting document that was valid at prepare and was deleted before write", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    await mkdir(join(store.root, "docs"), { recursive: true });
    const docPath = join(store.root, "docs", "will-be-deleted.md");
    await writeFile(docPath, "# Detail\n\nSubstantive linked content that will be removed before write.\n", "utf8");
    const supportingDocuments = [{ path: ".planner/docs/will-be-deleted.md", description: "Substantive linked content for resumption." }];

    // Valid at prepare time: the manifest passes cleanly.
    const audit = await store.preparePhaseHandoff(phaseId, supportingDocuments);
    const baseInput = refreshInput(audit, doneTaskId);

    // Deleted between prepare and write.
    await rm(docPath);

    await assert.rejects(
      store.refreshPhaseHandoff(phaseId, {
        ...baseInput,
        content: `${baseInput.content}\n- .planner/docs/will-be-deleted.md — substantive linked content for resumption.`,
        supportingDocuments,
      }),
      (error) => {
        assert.equal(error.code, "HANDOFF_SUPPORTING_DOCUMENT_INVALID");
        assert.match(error.message, /must be a regular file/);
        return true;
      },
    );
    assert.equal((await store.loadPhase(phaseId)).handoff, "");
  });

  test("materializes required metadata from structured preflight inputs without late draft retries", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    const audit = await store.preparePhaseHandoff(phaseId);
    const input = refreshInput(audit, doneTaskId);
    const draftWithoutMetadata = input.content
      .split("\n")
      .filter((line) => !/^(?:Created at|Updated at|Reason):/.test(line))
      .join("\n");
    const written = await store.refreshPhaseHandoff(phaseId, {
      ...input,
      content: draftWithoutMetadata,
      reason: "A session boundary requires a cold-resume handoff.",
    });
    assert.match(written.phase.handoff, /^Created at: \d{4}-\d{2}-\d{2}T/im);
    assert.match(written.phase.handoff, /^Updated at: \d{4}-\d{2}-\d{2}T/im);
    assert.match(written.phase.handoff, /^Reason: A session boundary requires a cold-resume handoff\.$/im);
    await assert.rejects(
      store.refreshPhaseHandoff(phaseId, { ...input, reason: "" }),
      (error) => error.code === "HANDOFF_REASON_REQUIRED",
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

// T409: content is retained against phaseId + expectedHandoffUpdatedAt on any
// failed refreshPhaseHandoff(), so a retry can omit content and reuse it
// instead of resending a capsule up to MAX_HANDOFF_CONTENT_CHARS.
describe("retained handoff drafts make a failed write cheap to retry", () => {
  function draftsPath(store) {
    return join(store.root, ".local", "handoff-drafts.json");
  }

  async function readDrafts(store) {
    return JSON.parse(await readFile(draftsPath(store), "utf8"));
  }

  // A real, structural failure that is not the token/terminal-phase gate:
  // "done" tasks missing durable completion evidence. Distinct from `full`
  // only in contextSync.taskUpdates, so `content` (the expensive part) is
  // exactly what refreshInput() built.
  function failingAttempt(full) {
    const { contextSync, ...rest } = full;
    return { ...rest, contextSync: { ...contextSync, taskUpdates: [] } };
  }

  function withoutContent(full) {
    const { content, ...rest } = full;
    return rest;
  }

  test("a failed write retains content; a retry omitting it succeeds, then discards the entry", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    const audit = await store.preparePhaseHandoff(phaseId);
    const full = refreshInput(audit, doneTaskId);

    await assert.rejects(
      store.refreshPhaseHandoff(phaseId, failingAttempt(full)),
      /missing durable completion evidence/,
    );
    assert.equal((await store.loadPhase(phaseId)).handoff, "", "the failed attempt must not mutate the phase");
    const retained = (await readDrafts(store)).find((d) => d.phaseId === phaseId);
    assert.ok(retained, "the exact submitted content is retained after the failure");
    assert.equal(retained.token, audit.handoffUpdatedAt);

    // Retry: omit content entirely, correct only the field that actually failed.
    const written = await store.refreshPhaseHandoff(phaseId, withoutContent(full));
    assert.match(written.phase.handoff, /Continue the phase\./, "the persisted body is the retained content, not a resend");

    // Success discards the entry for this token.
    assert.ok(!(await readDrafts(store)).some((d) => d.phaseId === phaseId), "a successful write discards its retained draft");

    // Content is genuinely required again: the same token now has nothing
    // retained, so omitting content is a typed failure, not a stale-token one.
    await assert.rejects(
      store.refreshPhaseHandoff(phaseId, withoutContent(full)),
      (error) => {
        assert.equal(error.code, "HANDOFF_RETAINED_CONTENT_NOT_FOUND");
        assert.match(error.details.recovery, /omit content/);
        return true;
      },
    );
  });

  test("auto-externalization runs against a retained body on retry, exactly as on a first attempt", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    const audit = await store.preparePhaseHandoff(phaseId);
    // Pad the already cold-start-covered base content past the externalization
    // target, keeping every required inventory item intact and verbatim.
    const baseFull = refreshInput(audit, doneTaskId);
    const padding = "Implementing the reconciled handoff contract in exhaustive detail. ".repeat(200);
    const oversizedContent = `${baseFull.content}\n\n## Extended padding\n${padding}`;
    assert.ok(oversizedContent.length > 8_000, "fixture content must exceed the externalization target");
    const full = { ...baseFull, content: oversizedContent };

    await assert.rejects(store.refreshPhaseHandoff(phaseId, failingAttempt(full)), /missing durable completion evidence/);
    const retained = (await readDrafts(store)).find((d) => d.phaseId === phaseId);
    assert.ok(retained.content.length > 8_000, "the raw oversized body is retained, not a pre-externalized copy");

    // Retry omitting content: externalization must run against the retained
    // body exactly as it would on a first attempt with that same content.
    const written = await store.refreshPhaseHandoff(phaseId, withoutContent(full));
    assert.ok(written.phase.handoff.length < oversizedContent.length, "the persisted capsule is compacted, not the raw oversized retry");
    assert.match(written.phase.handoff, /externalized automatically/);
    assert.equal(written.handoffAudit.supportingDocuments.length, 1);
    assert.match(written.handoffAudit.supportingDocuments[0].path, /^\.planner\/docs\/handoff-p001-/);
    const externalizedPath = join(store.root, written.handoffAudit.supportingDocuments[0].path.slice(".planner/".length));
    const externalizedContent = await readFile(externalizedPath, "utf8");
    assert.match(externalizedContent, /Implementing the reconciled handoff contract in exhaustive detail\./);
  });

  test("a stale-token retry still refuses even though a body is retained for it", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    const audit = await store.preparePhaseHandoff(phaseId);
    const full = refreshInput(audit, doneTaskId);

    await assert.rejects(store.refreshPhaseHandoff(phaseId, failingAttempt(full)), /missing durable completion evidence/);
    assert.ok((await readDrafts(store)).some((d) => d.phaseId === phaseId), "a draft is retained for the original token");

    // Someone else moves the phase's handoff forward through a different path,
    // advancing handoffUpdatedAt away from the token the draft was retained for.
    await store.setPhaseHandoff(phaseId, "# Someone else's handoff\n\nWritten between prepare and this retry.");
    const advanced = await store.loadPhase(phaseId);
    assert.notEqual(advanced.handoffUpdatedAt, audit.handoffUpdatedAt);

    // Retention still finds a body for the old token, but the token itself is
    // stale — the write must still refuse, and must not touch the new content.
    await assert.rejects(
      store.refreshPhaseHandoff(phaseId, withoutContent(full)),
      /Handoff changed after preparation/,
    );
    assert.equal((await store.loadPhase(phaseId)).handoff, advanced.handoff, "the stale retry must not overwrite the newer handoff");
  });

  test("a retained draft is discarded when the phase reaches a terminal status", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    const audit = await store.preparePhaseHandoff(phaseId);
    const full = refreshInput(audit, doneTaskId);

    await assert.rejects(store.refreshPhaseHandoff(phaseId, failingAttempt(full)), /missing durable completion evidence/);
    assert.ok((await readDrafts(store)).some((d) => d.phaseId === phaseId), "the failed write retained a draft");

    // Drive every task to done so the phase derives a terminal status.
    await store.updatePhase(phaseId, (p) => {
      const now = new Date().toISOString();
      for (const t of p.tasks) { t.status = "done"; t.startedAt ||= now; t.completedAt = now; }
      return p;
    });
    await store.syncTaskStatusRollup(phaseId);
    assert.equal((await store.loadPhase(phaseId)).status, "done");

    assert.ok(!(await readDrafts(store)).some((d) => d.phaseId === phaseId), "a terminal phase discards its retained draft");
    await assert.rejects(
      store.refreshPhaseHandoff(phaseId, withoutContent(full)),
      /terminal phases have no pending handoff/,
    );
  });

  test("handoff_clear discards a retained draft even with no active handoff to archive", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    const audit = await store.preparePhaseHandoff(phaseId);
    const full = refreshInput(audit, doneTaskId);
    await assert.rejects(store.refreshPhaseHandoff(phaseId, failingAttempt(full)), /missing durable completion evidence/);
    assert.ok((await readDrafts(store)).some((d) => d.phaseId === phaseId));
    assert.equal((await store.loadPhase(phaseId)).handoff, "", "nothing was ever successfully written for handoff_clear to archive");

    await store.clearPhaseHandoff(phaseId, "manual");
    assert.ok(!(await readDrafts(store)).some((d) => d.phaseId === phaseId), "handoff_clear discards the draft regardless of whether there was a body to archive");
  });

  test("an expired retained draft is treated as absent", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    const audit = await store.preparePhaseHandoff(phaseId);
    const full = refreshInput(audit, doneTaskId);
    await mkdir(join(store.root, ".local"), { recursive: true });
    const expired = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // > 24h age cap
    await writeFile(draftsPath(store), JSON.stringify([
      { phaseId, token: audit.handoffUpdatedAt, content: "stale unrecoverable draft", failureReason: "an earlier session", retainedAt: expired },
    ], null, 2), "utf8");

    await assert.rejects(
      store.refreshPhaseHandoff(phaseId, withoutContent(full)),
      (error) => {
        assert.equal(error.code, "HANDOFF_RETAINED_CONTENT_NOT_FOUND");
        return true;
      },
    );
  });

  test("retained drafts are capped in count, evicting the oldest first", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    await mkdir(join(store.root, ".local"), { recursive: true });
    const seeded = Array.from({ length: 20 }, (_, i) => ({
      phaseId: `seed-phase-${i}`,
      token: "t",
      content: `seed content ${i}`,
      failureReason: "seed",
      retainedAt: new Date(Date.now() - (20 - i) * 1000).toISOString(), // ascending; seed-phase-0 is oldest
    }));
    await writeFile(draftsPath(store), JSON.stringify(seeded, null, 2), "utf8");

    const audit = await store.preparePhaseHandoff(phaseId);
    const full = refreshInput(audit, doneTaskId);
    await assert.rejects(store.refreshPhaseHandoff(phaseId, failingAttempt(full)), /missing durable completion evidence/);

    const drafts = await readDrafts(store);
    assert.equal(drafts.length, 20, "the total stays capped at MAX_RETAINED_HANDOFF_DRAFTS");
    assert.ok(!drafts.some((d) => d.phaseId === "seed-phase-0"), "the oldest entry was evicted to make room");
    assert.ok(drafts.some((d) => d.phaseId === phaseId), "the newest failure is retained");
  });

  test("a retained draft survives a new PlanStore instance against the same root", async () => {
    const { store, phaseId, doneTaskId } = await setup();
    const audit = await store.preparePhaseHandoff(phaseId);
    const full = refreshInput(audit, doneTaskId);
    await assert.rejects(store.refreshPhaseHandoff(phaseId, failingAttempt(full)), /missing durable completion evidence/);

    // Simulate a process restart in the same worktree: a new PlanStore
    // instance against the same root, as if a fresh session opened it after
    // a context compaction separated the failure from the retry.
    const { PlanStore: FreshStore } = await import("../dist/index.js");
    const fresh = new FreshStore(store.root);
    const written = await fresh.refreshPhaseHandoff(phaseId, withoutContent(full));
    assert.match(written.phase.handoff, /Continue the phase\./);
  });
});
