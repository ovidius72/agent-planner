import assert from "node:assert/strict";
import test from "node:test";
import { fieldCapabilityManifest } from "./field-capabilities.mjs";

const requiredHarnesses = ["core", "pi", "mcp", "http", "web-ui", "agent-load", "docs", "behavioral-test"];

test("field capability manifest declares every canonical field or an explicit exception", () => {
  assert.ok(fieldCapabilityManifest.length >= 40);
  const keys = new Set();
  for (const entry of fieldCapabilityManifest) {
    const key = `${entry.entity}.${entry.name}`;
    assert.equal(keys.has(key), false, `duplicate capability entry: ${key}`);
    keys.add(key);
    assert.ok(entry.operations.length > 0 || entry.exception, `${key} needs operations or an explicit exception`);
    if (!entry.exception) {
      for (const harness of requiredHarnesses) assert.equal(entry.surfaces[harness], true, `${key} missing ${harness} declaration`);
    }
  }
});

test("manifest is intentionally scoped to human-owned fields", () => {
  assert.ok(fieldCapabilityManifest.some((entry) => entry.name === "acceptedDecisions" && entry.operations.includes("create")));
  assert.ok(fieldCapabilityManifest.some((entry) => entry.name === "dependsOn" && entry.operations.includes("delete")));
  assert.ok(fieldCapabilityManifest.some((entry) => entry.name === "status" && entry.exception?.includes("Derived")));
});
