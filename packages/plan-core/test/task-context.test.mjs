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

  assert.match(output, /Phase linked requirements \(2\):/);
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
  assert.match(output, /Feature linked requirements \(0\):\n  - None linked to this feature\./);
  assert.match(output, /Phase linked requirements \(0\):\n  - None linked to this phase\./);
});
