import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBoundedAcceptedDecisionContext, buildPhaseContextBlock, buildPhaseWorkMap, renderAcceptedDecisionsSection, MAX_ACCEPTED_DECISION_CONTEXT_CHARS } from "../dist/task-context.js";

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

test("buildPhaseWorkMap entries mirror the admitted content blocks", () => {
  const tasks = [];
  for (let i = 0; i < 40; i += 1) {
    tasks.push({
      id: `task-${i}`,
      number: i + 1,
      priority: i,
      title: `Task ${i}`,
      description: "x".repeat(200),
      status: "planned",
      dependsOn: [],
    });
  }
  const mapped = buildPhaseWorkMap({ ...phase, tasks }, feature.number);

  const admittedBlockCount = mapped.content.split("\n- ").length - 1;
  assert.equal(mapped.entries.length, admittedBlockCount);
  assert.equal(mapped.total, tasks.length);
  assert.equal(mapped.truncated, true);
  assert.ok(mapped.entries.length < mapped.total, "budget-exceeding phase must withhold entries");
  assert.deepEqual(mapped.entries.map((entry) => entry.priority), mapped.entries.map((_, index) => index), "admitted entries stay in priority order");
  assert.match(mapped.content, /truncated for transport safety: \d+ lower-priority entr(y|ies) withheld/);
});

test("buildPhaseWorkMap withholds a single entry larger than maxChars", () => {
  const mapped = buildPhaseWorkMap({
    ...phase,
    tasks: [{ id: "oversized", number: 1, priority: 1, title: "Oversized task", description: "x".repeat(500), status: "planned", dependsOn: [] }],
  }, feature.number, undefined, 100);

  assert.deepEqual(mapped.entries, []);
  assert.equal(mapped.total, 1);
  assert.equal(mapped.truncated, true);
});

test("buildPhaseWorkMap on a phase with zero tasks returns empty, untruncated output", () => {
  const mapped = buildPhaseWorkMap({ ...phase, tasks: [] }, feature.number);

  assert.deepEqual(mapped.entries, []);
  assert.equal(mapped.total, 0);
  assert.equal(mapped.truncated, false);
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
  // Never exceeds the ceiling. It is no longer exactly the ceiling: cutting
  // at a safe boundary (see the mid-word test below) means the result can
  // land short of it, and a single unbroken run with no boundary to retreat
  // to is exactly the edge case P104(F005)/T419 calls out.
  assert.ok(context.content.length <= MAX_ACCEPTED_DECISION_CONTEXT_CHARS);
  assert.ok(context.content.length > 0, "must still produce something, never an empty string");
  assert.equal(context.truncated, true);
  assert.match(context.content, /truncated for transport safety/);
});

test("ambient Accepted Decision context never cuts a decision mid-word", () => {
  const words = Array.from({ length: 2000 }, (_, index) => `word${index}`);
  const decision = {
    id: "decision-1",
    title: "Long decision",
    decision: words.join(" "),
    rationale: "Bound ambient context.",
    implementationNotes: "Use full entity reads for canonical detail.",
    acceptedAt: "2026-01-02T03:04:05.000Z",
  };
  const context = buildBoundedAcceptedDecisionContext([{ scope: "project", decisions: [decision] }]);
  assert.equal(context.truncated, true);

  // Rebuild the same unbounded rendering buildBoundedAcceptedDecisionContext
  // truncates, so we can check the cut against the real source rather than
  // guessing at internals.
  const full = renderAcceptedDecisionsSection("Accepted decisions — project", [decision]);
  const body = context.content.replace(/\n\n\[Accepted Decision context truncated.*$/s, "");
  assert.ok(full.startsWith(body), "truncated body must be a genuine prefix of the untruncated text");
  assert.ok(body.length < full.length, "must actually be shorter than the source");
  // A raw slice(0, n) would land inside a word like "word1234", leaving a
  // fragment ("word1") immediately followed by more word characters. The
  // safe-boundary cut instead lands right before whitespace.
  assert.match(full[body.length], /\s/);
});
