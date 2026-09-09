import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ALLOCATION_REGISTRY_VERSION,
  PLAN_SCHEMA_VERSION,
  SUPPORTED_ALLOCATION_KINDS,
  PlanStore,
  PlanStoreError,
  PlanUnsupportedAllocationKindError,
  createFeatureId,
  runtimeCapabilities,
} from "../dist/index.js";
import { cleanupFixtures, createPlannerFixture } from "../../../test/helpers/fixtures.mjs";

after(async () => {
  await cleanupFixtures();
});

test("runtime capabilities expose plan schema and allocation registry support", () => {
  const capabilities = runtimeCapabilities();
  assert.equal(PLAN_SCHEMA_VERSION, 1);
  assert.equal(ALLOCATION_REGISTRY_VERSION, 1);
  assert.deepEqual(SUPPORTED_ALLOCATION_KINDS, ["feature", "phase", "task", "idea"]);
  assert.equal(capabilities.planSchema.manifestSchemaVersion, 1);
  assert.deepEqual(capabilities.allocationRegistry.supportedKinds, ["feature", "phase", "task", "idea"]);
});

test("unsupported allocation kind fails before reading or mutating planner state", async () => {
  const fixture = await createPlannerFixture({ name: "unsupported-allocation-kind", seed: "empty" });
  await assert.rejects(
    fixture.store.allocateEntityIdentity("milestone", "entity-1"),
    (error) => {
      assert.ok(error instanceof PlanUnsupportedAllocationKindError);
      assert.equal(error.details.errorCode, "PLAN_UNSUPPORTED_ALLOCATION_KIND");
      assert.equal(error.details.kind, "milestone");
      assert.deepEqual(error.details.supportedKinds, ["feature", "phase", "task", "idea"]);
      assert.match(error.message, /Upgrade all Agent Plan packages and reload the harness/);
      return true;
    },
  );
});

test("incompatible manifest data returns typed runtime compatibility diagnostics", async () => {
  const fixture = await createPlannerFixture({ name: "incompatible-manifest", seed: "empty" });
  await writeFile(join(fixture.planRoot, "manifest.json"), JSON.stringify({
    schemaVersion: 999,
    projectId: "incompatible-manifest",
    projectName: "incompatible-manifest",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }), "utf8");

  await assert.rejects(
    fixture.store.loadManifest(),
    (error) => {
      assert.ok(error instanceof PlanStoreError);
      assert.equal(error.details.errorCode, "PLAN_RUNTIME_SCHEMA_INCOMPATIBLE");
      assert.equal(error.details.schema, "manifest");
      assert.equal(error.details.expectedVersion, PLAN_SCHEMA_VERSION);
      assert.match(error.message, /Upgrade all Agent Plan packages and reload the harness/);
      return true;
    },
  );
});

test("incompatible allocation registry data returns typed upgrade diagnostics before mutation", async () => {
  const fixture = await createPlannerFixture({ name: "incompatible-allocation-registry", seed: "empty" });
  const manifest = await fixture.store.loadManifest();
  const registryPath = join(fixture.planRoot, ".local", "allocations", `${manifest.projectId}.json`);
  await mkdir(join(fixture.planRoot, ".local", "allocations"), { recursive: true });
  await writeFile(registryPath, JSON.stringify({
    version: ALLOCATION_REGISTRY_VERSION,
    projectId: manifest.projectId,
    allocations: [{ kind: "milestone", entityId: "external", number: 1, shortId: "ABCDE" }],
  }), "utf8");

  await assert.rejects(
    fixture.store.allocateEntityIdentity("feature", createFeatureId()),
    (error) => {
      assert.ok(error instanceof PlanUnsupportedAllocationKindError);
      assert.equal(error.details.errorCode, "PLAN_UNSUPPORTED_ALLOCATION_KIND");
      assert.equal(error.details.kind, "milestone");
      return true;
    },
  );

  const reloaded = new PlanStore(fixture.planRoot);
  assert.equal((await reloaded.loadFeatures()).features.length, 0, "failed compatibility check must not allocate or create a feature");
});

test("incompatible allocation registry schema returns typed runtime compatibility diagnostics", async () => {
  const fixture = await createPlannerFixture({ name: "incompatible-allocation-version", seed: "empty" });
  const manifest = await fixture.store.loadManifest();
  const registryPath = join(fixture.planRoot, ".local", "allocations", `${manifest.projectId}.json`);
  await mkdir(join(fixture.planRoot, ".local", "allocations"), { recursive: true });
  await writeFile(registryPath, JSON.stringify({
    version: 999,
    projectId: manifest.projectId,
    allocations: [],
  }), "utf8");

  await assert.rejects(
    fixture.store.allocateEntityIdentity("feature", createFeatureId()),
    (error) => {
      assert.ok(error instanceof PlanStoreError);
      assert.equal(error.details.errorCode, "PLAN_RUNTIME_SCHEMA_INCOMPATIBLE");
      assert.equal(error.details.schema, "allocationRegistry");
      assert.equal(error.details.expectedVersion, ALLOCATION_REGISTRY_VERSION);
      assert.match(error.message, /Upgrade all Agent Plan packages and reload the harness/);
      return true;
    },
  );
});
