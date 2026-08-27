/**
 * Context-read enforcement and session-scoped attestation reuse.
 *
 * The read state is module-level and shared across tests in the process, so
 * every test clears it first.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  contextReadEligibility,
  contextReadEligibilityForSession,
  loadExtensionRules,
  PLANNER_EXTENSION_RULES,
  hasReadParents,
  hasReadRequirements,
  hasReadRequirementsForSession,
  invalidateReads,
  markFeatureRead,
  markPhaseRead,
  markRequirementRead,
  markRequirementReadForSessionId,
  markTaskRead,
  markFeatureReadForSessionId,
  markPhaseReadForSessionId,
  markTaskReadForSessionId,
  readTrackingSnapshot,
  requirementReadAdvisory,
  startReadSession,
} from "../dist/index.js";

const eligible = () => contextReadEligibility("T1", "P1", "F1");

test("a fresh read state denies lifecycle work until the task is read", () => {
  invalidateReads();
  assert.deepEqual(eligible(), { eligible: false, reason: "Read this exact task with full=true first." });
});

test("a task read does not imply its parent phase or feature", () => {
  invalidateReads();
  markTaskRead("T1", "P1", "F1");
  assert.deepEqual(eligible(), { eligible: false, reason: "After reading the task, read its parent phase with full=true." });
  assert.equal(hasReadParents("F1", "P1"), false);
});

test("the required context order is task, then phase, then feature", () => {
  invalidateReads();
  markFeatureRead("F1");
  markTaskRead("T1", "P1", "F1");
  markPhaseRead("P1", "F1");
  assert.deepEqual(eligible(), { eligible: false, reason: "After reading the phase, read its parent feature with full=true." });

  markFeatureRead("F1");
  assert.deepEqual(eligible(), { eligible: true, reason: "" });
});

test("reading another task, phase, or feature cannot satisfy the target lineage", () => {
  invalidateReads();
  markTaskRead("T2", "P1", "F1");
  markPhaseRead("P2", "F1");
  markFeatureRead("F2");
  assert.deepEqual(eligible(), { eligible: false, reason: "Read this exact task with full=true first." });
});

test("orphan phases require only task then phase", () => {
  invalidateReads();
  markTaskRead("T1", "P1");
  markPhaseRead("P1");
  assert.deepEqual(contextReadEligibility("T1", "P1"), { eligible: true, reason: "" });
});

test("hasReadParents remains a compatibility check for independent parent reads", () => {
  invalidateReads();
  markPhaseRead("P1", "F1");
  markFeatureRead("F1");
  assert.equal(hasReadParents("F1", "P1"), true);
});

test("invalidateReads clears context sequence and linked requirements", () => {
  invalidateReads();
  markTaskRead("T1", "P1", "F1");
  markPhaseRead("P1", "F1");
  markFeatureRead("F1");
  markRequirementRead("R1");
  assert.equal(eligible().eligible, true);
  assert.equal(hasReadRequirements(["R1"]), true);

  invalidateReads();
  assert.equal(eligible().eligible, false);
  assert.equal(hasReadRequirements(["R1"]), false);
  assert.deepEqual(readTrackingSnapshot(), { features: [], phases: [], requirements: [] });
});

test("requirements remain an independent explicit-read gate", () => {
  invalidateReads();
  assert.equal(requirementReadAdvisory([]), "", "empty list means nothing required");
  assert.notEqual(requirementReadAdvisory(["R1"]), "", "unread requirement warns");
  markRequirementRead("R1");
  assert.equal(hasReadRequirements(["R1"]), true);
  assert.equal(requirementReadAdvisory(["R1"]), "");
});

test("explicit sessions remain isolated", () => {
  invalidateReads();
  startReadSession("session-a");
  markTaskReadForSessionId("session-a", "T1");
  markPhaseReadForSessionId("session-a", "P1");
  markFeatureReadForSessionId("session-a", "F1");
  assert.deepEqual(contextReadEligibilityForSession({ sessionId: "session-a", taskId: "T1", phaseId: "P1", featureId: "F1" }), { eligible: true, reason: "" });
  const otherSession = contextReadEligibilityForSession({ sessionId: "session-b", taskId: "T1", phaseId: "P1", featureId: "F1" });
  assert.equal(otherSession.eligible, false);
  assert.deepEqual(otherSession.requiredReads, [
    { kind: "task", id: "T1", state: "missing" },
    { kind: "phase", id: "P1", state: "missing" },
    { kind: "feature", id: "F1", state: "missing" },
  ]);
});

test("a fresh ordered reread supersedes a stale persisted attestation", () => {
  invalidateReads();
  markTaskReadForSessionId("session-a", "T1");
  markPhaseReadForSessionId("session-a", "P1");
  markFeatureReadForSessionId("session-a", "F1");
  const stale = {
    updatedAt: "2026-01-03T00:00:00.000Z",
    sessionInfo: [{ sessionId: "session-a", createdAt: "2026-01-02T00:00:00.000Z" }],
  };
  assert.deepEqual(contextReadEligibilityForSession({ sessionId: "session-a", taskId: "T1", phaseId: "P1", featureId: "F1", task: stale, phase: stale, feature: stale }), { eligible: true, reason: "" });
});

test("persisted session attestations remain valid until an entity changes", () => {
  invalidateReads();
  const entities = {
    updatedAt: "2026-01-01T00:00:00.000Z",
    sessionInfo: [{ sessionId: "session-a", createdAt: "2026-01-02T00:00:00.000Z" }],
  };
  assert.deepEqual(contextReadEligibilityForSession({ sessionId: "session-a", taskId: "T1", phaseId: "P1", featureId: "F1", task: entities, phase: entities, feature: entities }), { eligible: true, reason: "" });
  const staleTask = contextReadEligibilityForSession({ sessionId: "session-a", taskId: "T1", phaseId: "P1", featureId: "F1", task: { ...entities, updatedAt: "2026-01-03T00:00:00.000Z" }, phase: entities, feature: entities });
  assert.equal(staleTask.eligible, false);
  assert.deepEqual(staleTask.requiredReads, [{ kind: "task", id: "T1", state: "stale" }]);
});

test("a task-only reread reuses valid phase and feature attestations", () => {
  invalidateReads();
  const validParent = {
    updatedAt: "2026-01-04T00:00:00.000Z",
    descriptionUpdatedAt: "2026-01-01T00:00:00.000Z",
    sessionInfo: [{ sessionId: "session-a", createdAt: "2026-01-02T00:00:00.000Z" }],
  };
  const staleTask = {
    updatedAt: "2026-01-03T00:00:00.000Z",
    sessionInfo: [{ sessionId: "session-a", createdAt: "2026-01-02T00:00:00.000Z" }],
  };
  const input = { sessionId: "session-a", taskId: "T2", phaseId: "P1", featureId: "F1", task: staleTask, phase: validParent, feature: validParent };

  assert.deepEqual(contextReadEligibilityForSession(input).requiredReads, [{ kind: "task", id: "T2", state: "stale" }]);
  markTaskReadForSessionId("session-a", "T2");
  assert.deepEqual(contextReadEligibilityForSession(input), { eligible: true, reason: "" });
});

test("a sibling task read reuses already-attested parents", () => {
  invalidateReads();
  const validParent = {
    updatedAt: "2026-01-04T00:00:00.000Z",
    descriptionUpdatedAt: "2026-01-01T00:00:00.000Z",
    sessionInfo: [{ sessionId: "session-a", createdAt: "2026-01-02T00:00:00.000Z" }],
  };
  const siblingTask = { updatedAt: "2026-01-01T00:00:00.000Z", sessionInfo: [] };
  const input = { sessionId: "session-a", taskId: "T2", phaseId: "P1", featureId: "F1", task: siblingTask, phase: validParent, feature: validParent };

  assert.deepEqual(contextReadEligibilityForSession(input).requiredReads, [{ kind: "task", id: "T2", state: "missing" }]);
  markTaskReadForSessionId("session-a", "T2");
  assert.deepEqual(contextReadEligibilityForSession(input), { eligible: true, reason: "" });
});

test("parent lifecycle churn does not invalidate unchanged descriptions", () => {
  invalidateReads();
  const task = {
    updatedAt: "2026-01-01T00:00:00.000Z",
    sessionInfo: [{ sessionId: "session-a", createdAt: "2026-01-02T00:00:00.000Z" }],
  };
  const parent = {
    updatedAt: "2026-01-05T00:00:00.000Z",
    descriptionUpdatedAt: "2026-01-01T00:00:00.000Z",
    sessionInfo: [{ sessionId: "session-a", createdAt: "2026-01-02T00:00:00.000Z" }],
  };
  const input = { sessionId: "session-a", taskId: "T1", phaseId: "P1", featureId: "F1", task, phase: parent, feature: parent };
  assert.deepEqual(contextReadEligibilityForSession(input), { eligible: true, reason: "" });

  const changedPhase = { ...parent, descriptionUpdatedAt: "2026-01-03T00:00:00.000Z" };
  assert.deepEqual(contextReadEligibilityForSession({ ...input, phase: changedPhase }).requiredReads, [
    { kind: "phase", id: "P1", state: "stale" },
  ]);
});

test("agent rules demand lifecycle-first reads instead of unconditional rereads", () => {
  const rules = PLANNER_EXTENSION_RULES.join("\n");
  assert.match(rules, /call the lifecycle tool first/);
  assert.match(rules, /only the missing or stale full reads listed in nextActions/);
  assert.doesNotMatch(rules, /Before starting, resuming, or switching to a task, read task_get/);
});

test("legacy canonical rules are upgraded in memory without rewriting project overrides", async () => {
  const plannerRoot = await mkdtemp(join(tmpdir(), "agent-plan-legacy-rules-"));
  const rulesPath = join(plannerRoot, "rules.json");
  const legacyDetail = "Write relevant points (decisions, constraints, current state, file:line refs, edge cases) into the task/phase/feature description or notes as soon as they emerge. Before starting, resuming, or switching to a task, read task_get(full=true), then its parent phase_get(full=true), then its parent feature_get(full=true), in that exact order; read linked requirements explicitly when present. Cite entities with composite IDs, not bare UUIDs.";
  const legacyExpected = "When you begin work, task_start and task_switch enforce the required ordered full reads. Read any relevant phase handoff as additional context, then update the planner before and after significant changes. If you change an architectural decision, document it explicitly.";
  const customRule = "Keep this project-specific override unchanged.";
  const original = `${JSON.stringify({ extensionRules: [legacyDetail, customRule, legacyExpected] }, null, 2)}\n`;

  try {
    await writeFile(rulesPath, original, "utf8");
    const effective = await loadExtensionRules(plannerRoot);
    assert.match(effective[0], /call the lifecycle tool first/);
    assert.equal(effective[1], customRule);
    assert.match(effective[2], /session-scoped context reads/);
    assert.doesNotMatch(effective.join("\n"), /read task_get\(full=true\), then its parent phase_get/);
    assert.equal(await readFile(rulesPath, "utf8"), original, "runtime normalization must not mutate the static project file");
  } finally {
    await rm(plannerRoot, { recursive: true, force: true });
  }
});

test("requirement attestations are reused and invalidated independently", () => {
  invalidateReads();
  const requirement = {
    id: "R1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sessionInfo: [{ sessionId: "session-a", createdAt: "2026-01-02T00:00:00.000Z" }],
  };
  assert.equal(hasReadRequirementsForSession("session-a", ["R1"], [requirement]), true);
  assert.equal(hasReadRequirementsForSession("session-a", ["R1"], [{ ...requirement, updatedAt: "2026-01-03T00:00:00.000Z" }]), false);
  markRequirementReadForSessionId("session-a", "R1");
  assert.equal(hasReadRequirementsForSession("session-a", ["R1"], [{ ...requirement, updatedAt: "2026-01-03T00:00:00.000Z" }]), true);
});
