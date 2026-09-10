import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBoundedAcceptedDecisionContext, buildPhaseContextBlock, buildPhaseWorkMap, MAX_ACCEPTED_DECISION_CONTEXT_CHARS } from "../dist/task-context.js";

const phase = {
  id: "phase-id",
  number: 7,
  title: "Phase context",
  summary: "Summary",
  description: "Phase description",
  goals: [], nonGoals: [], dependencies: [], risks: [], openQuestions: [], decisions: [], completionCriteria: [],
};
const feature = { id: "feature-id", number: 3, name: "Feature context", description: "Feature description" };

test("buildPhaseWorkMap orders siblings and exposes dependency and capability ownership", () => {
  const mapped = buildPhaseWorkMap({
    ...phase,
    tasks: [
      { id: "task-done", number: 2, priority: 20, title: "Existing capability", description: "Already delivered.", status: "done", dependsOn: [] },
      { id: "task-next", number: 3, priority: 10, title: "Remaining capability", description: "Own the remaining behavior.", status: "planned", dependsOn: ["task-done"] },
    ],
  }, feature.number, "task-next");

  assert.deepEqual(mapped.entries.map((entry) => entry.taskId), ["task-next", "task-done"]);
  assert.deepEqual(mapped.entries[0].dependencies, ["P007(F003)/T002"]);
  assert.equal(mapped.entries[0].current, true);
  assert.equal(mapped.entries[0].remainingCapabilityOwner, true);
  assert.equal(mapped.entries[1].remainingCapabilityOwner, false);
  assert.match(mapped.content, /P007\(F003\)\/T003 \(current\).*priority 10; planned/);
  assert.match(mapped.content, /owns this remaining capability; do not duplicate it/);
});

test("buildPhaseContextBlock includes linked requirement details", () => {
  const output = buildPhaseContextBlock(phase, feature, [
    { title: "Canonical links", description: "Store UUID phase IDs." },
    { title: "Priority protocol", description: "" },
  ]);

  assert.match(output, /Product requirements linked to phase \(outcomes, never coding\/process rules\) \(2\):/);
  assert.match(output, /Canonical links — Store UUID phase IDs\./);
  assert.match(output, /Priority protocol/);
  assert.match(output, /Phase description/);
  assert.ok(output.indexOf("Feature F003") < output.indexOf("Phase P007"), "feature context precedes phase context");
});

test("buildPhaseContextBlock puts feature requirements before phase context", () => {
  const output = buildPhaseContextBlock(phase, feature, [{ title: "Phase requirement", description: "" }], [{ title: "Feature requirement", description: "" }]);
  assert.ok(output.indexOf("Feature requirement") < output.indexOf("Phase P007"));
  assert.ok(output.indexOf("Phase P007") < output.indexOf("Phase requirement"));
});

test("buildPhaseContextBlock explicitly reports phases without requirements", () => {
  const output = buildPhaseContextBlock(phase, feature);
  assert.match(output, /Product requirements linked to feature \(outcomes, never coding\/process rules\) \(0\):\n  - None linked to this feature\./);
  assert.match(output, /Product requirements linked to phase \(outcomes, never coding\/process rules\) \(0\):\n  - None linked to this phase\./);
});

test("buildPhaseContextBlock delivers canonical Accepted Decisions for the active lineage", () => {
  const decision = {
    id: "decision-1",
    title: "Preserve semantic context",
    decision: "Deliver every accepted field.",
    rationale: "A title alone cannot guide implementation.",
    implementationNotes: "Keep identity and acceptedAt visible.",
    acceptedAt: "2026-01-02T03:04:05.000Z",
  };
  const output = buildPhaseContextBlock(
    { ...phase, acceptedDecisions: [{ ...decision, id: "phase-decision", title: "Phase decision" }] },
    { ...feature, acceptedDecisions: [{ ...decision, id: "feature-decision", title: "Feature decision" }] },
    [],
    [],
    { acceptedDecisions: [{ ...decision, id: "task-decision", title: "Task decision" }] },
    { acceptedDecisions: [{ ...decision, id: "project-decision", title: "Project decision" }] },
  );

  for (const expected of ["Project decision", "Feature decision", "Phase decision", "Task decision", "Deliver every accepted field.", "A title alone cannot guide implementation.", "Keep identity and acceptedAt visible.", "2026-01-02T03:04:05.000Z"]) {
    assert.ok(output.includes(expected), `missing Accepted Decision context: ${expected}`);
  }
});

test("ambient Accepted Decision context is explicitly bounded", () => {
  const context = buildBoundedAcceptedDecisionContext([{
    scope: "project",
    decisions: [{
      id: "decision-1",
      title: "Oversized decision",
      decision: "x".repeat(MAX_ACCEPTED_DECISION_CONTEXT_CHARS),
      rationale: "Bound ambient context.",
      implementationNotes: "Use full entity reads for canonical detail.",
      acceptedAt: "2026-01-02T03:04:05.000Z",
    }],
  }]);
  assert.equal(context.content.length, MAX_ACCEPTED_DECISION_CONTEXT_CHARS);
  assert.equal(context.truncated, true);
  assert.match(context.content, /truncated for transport safety/);
});
