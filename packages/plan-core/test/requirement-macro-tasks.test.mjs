import { test } from "node:test";
import assert from "node:assert/strict";
import { RequirementMacroTaskError, reconcileRequirementMacroTasks } from "../dist/index.js";

const CREATED = "2026-01-01T00:00:00.000Z";
const UPDATED = "2026-02-01T00:00:00.000Z";

const existing = [{
  id: "MT-001",
  title: "Existing macro task",
  description: "Preserved detail",
  status: "planned",
  createdAt: CREATED,
  updatedAt: CREATED,
}];

test("reconciles semantic macro-task values while retaining system identity and timestamps", () => {
  const result = reconcileRequirementMacroTasks(existing, [
    { id: "MT-001", title: "Renamed macro task", description: "Updated detail", status: "in-progress" },
    { title: "New macro task", description: "New detail", status: "planned" },
  ], UPDATED);

  assert.deepEqual(result, [
    { id: "MT-001", title: "Renamed macro task", description: "Updated detail", status: "in-progress", createdAt: CREATED, updatedAt: UPDATED },
    { id: "MT-002", title: "New macro task", description: "New detail", status: "planned", createdAt: UPDATED, updatedAt: UPDATED },
  ]);
});

test("rejects foreign, duplicate, empty, and invalid macro-task inputs before a caller persists them", () => {
  assert.throws(
    () => reconcileRequirementMacroTasks(existing, [{ id: "MT-999", title: "Foreign", status: "planned" }], UPDATED),
    RequirementMacroTaskError,
  );
  assert.throws(
    () => reconcileRequirementMacroTasks(existing, [
      { id: "MT-001", title: "First", status: "planned" },
      { id: "MT-001", title: "Duplicate", status: "planned" },
    ], UPDATED),
    RequirementMacroTaskError,
  );
  assert.throws(
    () => reconcileRequirementMacroTasks(existing, [{ title: "   ", status: "planned" }], UPDATED),
    RequirementMacroTaskError,
  );
  assert.throws(
    () => reconcileRequirementMacroTasks(existing, [{ title: "Invalid", status: "unknown" }], UPDATED),
    RequirementMacroTaskError,
  );
  assert.deepEqual(existing, [{
    id: "MT-001", title: "Existing macro task", description: "Preserved detail", status: "planned", createdAt: CREATED, updatedAt: CREATED,
  }]);
});
