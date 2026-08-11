import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRequirementsByPhase } from "../src/lib/requirement-groups.ts";

const phase = (id, number, priority) => ({ id, number, priority, title: `Phase ${number}` });
const requirement = (id, linkedPhaseIds) => ({ id, title: id, linkedPhaseIds });

test("groupRequirementsByPhase groups every valid link and orders groups by priority", () => {
  const result = groupRequirementsByPhase(
    [
      requirement("shared", ["p2", "p1"]),
      requirement("one", ["p1"]),
      requirement("two", ["p2"]),
    ],
    [phase("p1", 1, 2), phase("p2", 2, 1)],
  );

  assert.deepEqual(result.phaseGroups.map(({ phase }) => phase.id), ["p2", "p1"]);
  assert.deepEqual(result.phaseGroups[0].requirements.map(({ id }) => id), ["shared", "two"]);
  assert.deepEqual(result.phaseGroups[1].requirements.map(({ id }) => id), ["shared", "one"]);
  assert.deepEqual(result.unlinkedRequirements, []);
});

test("groupRequirementsByPhase keeps empty and stale links visible in the unlinked fallback", () => {
  const result = groupRequirementsByPhase(
    [requirement("empty", []), requirement("stale", ["gone"]), requirement("valid", ["p1", "gone"])],
    [phase("p1", 1, 1)],
  );

  assert.deepEqual(result.phaseGroups[0].requirements.map(({ id }) => id), ["valid"]);
  assert.deepEqual(result.unlinkedRequirements.map(({ id }) => id), ["empty", "stale"]);
});
