import assert from "node:assert/strict";
import test from "node:test";
import { buildRecommendationReply } from "../dist/index.js";

/**
 * Regression for P104(F005)/T419: `recommendNextWork`'s raw `selection`
 * carries the full `Feature`/`Phase`/`Task` entities behind a candidate —
 * every sibling task's description, checklist, statusLog, and the whole
 * phase handoff. Measured on this repository's own planner: 48,869 chars
 * for one task reference. `buildRecommendationReply` is the shared shaper
 * both adapters call instead of spreading `selection` whole.
 */

const MARKER = "SIBLING-DESCRIPTION-SHOULD-NEVER-BE-ECHOED";

/** A phase sized like a real oversized one: many long task descriptions, a
 * large persisted handoff, and statusLog history — the exact shape the task
 * description names as "what makes the current payload worst". */
function buildOversizedPhase() {
  const longDescription = `${MARKER} ${"x".repeat(3000)}`;
  const tasks = Array.from({ length: 15 }, (_, index) => ({
    id: `task-${index}`,
    number: index + 1,
    priority: index + 1,
    title: `Sibling task ${index}`,
    status: "planned",
    description: longDescription,
    notes: "y".repeat(500),
    statusLog: Array.from({ length: 5 }, (_, entry) => ({
      id: `task-${index}-log-${entry}`,
      date: "2026-01-01T00:00:00.000Z",
      fromStatus: "planned",
      toStatus: "planned",
      title: "note",
      description: "z".repeat(200),
    })),
    checklist: [],
    subtasks: [],
    dependsOn: [],
    acceptedDecisions: [],
  }));
  return {
    id: "phase-oversized",
    featureId: "feature-1",
    number: 104,
    priority: 5,
    title: "Oversized phase",
    status: "in-progress",
    tasks,
    handoff: "h".repeat(20_000),
    acceptedDecisions: [],
  };
}

const feature = { id: "feature-1", number: 5, name: "Feature", status: "in-progress", phaseIds: ["phase-oversized"] };

// Fields the lifecycle protocol and claims contract read verbatim from the
// reply — see P104(F005)/T419's "Behaviors to preserve".
const REQUIRED_TOP_LEVEL_FIELDS = ["kind", "activeTask", "nextFeature", "nextPhase", "nextTask", "claims"];

test("recommendation reply bounds the candidate branch and keeps every lifecycle field", () => {
  const phase = buildOversizedPhase();
  const candidate = { feature, phase, task: phase.tasks[0] };
  const result = {
    selection: { kind: "priority", candidate, reason: "Select the lowest-priority ready feature, then phase, then task." },
    activeTask: null,
    nextFeature: { id: feature.id, number: feature.number, priority: 5, title: feature.name, status: feature.status },
    nextPhase: { id: phase.id, number: phase.number, priority: phase.priority, title: phase.title, status: phase.status },
    nextTask: { id: candidate.task.id, number: candidate.task.number, priority: candidate.task.priority, title: candidate.task.title, status: candidate.task.status },
    claims: [{ kind: "recommendation", source: "priority", ref: candidate.task.id, title: candidate.task.title, reason: "priority pick", taskId: candidate.task.id, phaseId: phase.id, featureId: feature.id }],
  };

  const reply = buildRecommendationReply(result, [feature]);
  const serialized = JSON.stringify(reply.structured);

  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    assert.ok(field in reply.structured, `structured payload must still carry ${field}`);
  }
  assert.equal(reply.structured.taskId, candidate.task.id);
  assert.equal(reply.structured.phaseId, phase.id);
  assert.equal(reply.structured.featureId, feature.id);
  assert.ok(reply.structured.selection, "selection must still be present, bounded");
  assert.equal(reply.structured.selection.candidate.ref, "P104(F005)/T001");
  assert.equal(reply.structured.selection.candidate.title, candidate.task.title);

  // The bound: no sibling description, handoff body, or statusLog entry
  // travels — only the winning candidate's ref/title/status.
  assert.ok(!serialized.includes(MARKER), "must not echo any task description");
  assert.ok(!serialized.includes("h".repeat(100)), "must not echo the phase handoff");

  // 4,000 chars is generous headroom over the ~1,700-2,000 chars this shape
  // measures at in practice — the point is bounded regardless of how large
  // the underlying phase/task entities are, not a precise byte count.
  assert.ok(serialized.length < 4_000, `structured payload must stay bounded, was ${serialized.length} chars`);
});

test("recommendation reply bounds the no-candidate (conflict) branch the same way", () => {
  const phase = buildOversizedPhase();
  const activeCandidates = [
    { feature, phase, task: phase.tasks[0] },
    { feature, phase, task: phase.tasks[1] },
  ];
  const result = {
    selection: { kind: "conflict", activeCandidates, reason: "More than one task is in progress; resolve the active-work conflict before autonomous selection." },
    activeTask: null,
    nextFeature: null,
    nextPhase: null,
    nextTask: null,
    claims: [],
  };

  const reply = buildRecommendationReply(result, [feature]);
  const serialized = JSON.stringify(reply.structured);

  assert.equal(reply.structured.kind, "conflict");
  assert.deepEqual(reply.structured.activeTaskIds, [phase.tasks[0].id, phase.tasks[1].id]);
  assert.ok(!serialized.includes(MARKER), "must not echo any task description in the conflict branch either");
  assert.ok(serialized.length < 4_000, `no-candidate structured payload must stay bounded, was ${serialized.length} chars`);
});
