import test from "node:test";
import assert from "node:assert/strict";
import { validateResolvedTarget, isUuid } from "../dist/index.js";

const validUuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const invalidUuid = "F005"; // human ref, not a UUID

test("validateResolvedTarget returns ok:true for a valid UUID that exists", async () => {
  const result = await validateResolvedTarget("feature", validUuid, async () => ({ id: validUuid, name: "Exists" }));
  assert.equal(result.ok, true);
});

test("validateResolvedTarget returns error when resolved id is not a UUID", async () => {
  const result = await validateResolvedTarget("feature", invalidUuid, async () => ({ id: invalidUuid }));
  assert.equal(result.ok, false);
  assert.match(result.error, /not a valid UUID/);
  assert.match(result.error, /F005/);
});

test("validateResolvedTarget returns error when target does not exist in store", async () => {
  const result = await validateResolvedTarget("phase", validUuid, async () => undefined);
  assert.equal(result.ok, false);
  assert.match(result.error, /no longer exists/);
  assert.match(result.error, /Refusing to create child/);
  assert.match(result.error, new RegExp(validUuid));
});

test("validateResolvedTarget returns error when a previously-valid UUID target disappears", async () => {
  let calls = 0;
  const result = await validateResolvedTarget("phase", validUuid, async () => {
    calls += 1;
    // Loader is only called once during validation; simulate target gone.
    return undefined;
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.match(result.error, /no longer exists/);
});

test("isUuid accepts canonical UUIDs and rejects refs/strings", () => {
  assert.equal(isUuid("550e8400-e29b-41d4-a716-446655440000"), true);
  assert.equal(isUuid("F005"), false);
  assert.equal(isUuid("P003"), false);
  assert.equal(isUuid("short"), false);
  assert.equal(isUuid(""), false);
  assert.equal(isUuid(undefined), false);
  assert.equal(isUuid(123), false);
});

test("validateResolvedTarget never calls loader for non-UUID ids", async () => {
  let loaderCalled = false;
  await validateResolvedTarget("feature", "not-a-uuid", async () => {
    loaderCalled = true;
    return { id: "not-a-uuid" };
  });
  assert.equal(loaderCalled, false);
});
