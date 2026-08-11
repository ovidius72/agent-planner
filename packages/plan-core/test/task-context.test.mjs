import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPhaseContextBlock } from "../dist/task-context.js";

const phase = {
  id: "phase-id",
  number: 7,
  title: "Phase context",
  summary: "Summary",
  description: "Phase description",
  goals: [], nonGoals: [], dependencies: [], risks: [], openQuestions: [], decisions: [], completionCriteria: [],
};
const feature = { id: "feature-id", number: 3, name: "Feature context", description: "Feature description" };

test("buildPhaseContextBlock includes linked requirement details", () => {
  const output = buildPhaseContextBlock(phase, feature, [
    { title: "Canonical links", description: "Store UUID phase IDs." },
    { title: "Priority protocol", description: "" },
  ]);

  assert.match(output, /Linked requirements \(2\):/);
  assert.match(output, /Canonical links — Store UUID phase IDs\./);
  assert.match(output, /Priority protocol/);
  assert.match(output, /Phase description/);
});

test("buildPhaseContextBlock explicitly reports phases without requirements", () => {
  assert.match(buildPhaseContextBlock(phase, feature), /Linked requirements \(0\):\n  - None linked to this phase\./);
});
