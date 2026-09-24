/**
 * P104(F005)/T424 — DELETE /features/:id now calls the shared
 * deleteFeatureCascade (plan-core) instead of hand-writing the mutation.
 * Before this task it had two defects: cascade:false left phases orphaned
 * (still pointing at the deleted feature's id, not unlinked), and deleting
 * a feature that was never there still returned 200 `{ deleted: id }`. Both
 * are fixed here; the existing `{ deleted: id }` response shape for a real
 * delete is unchanged (see server-crud.test.mjs's exact deepEqual check).
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  startServerFixture,
  closeServerFixture,
  cleanupServerFixtures,
  request,
} from "../../../test/helpers/server-fixture.mjs";

after(async () => {
  await cleanupServerFixtures();
});

test("DELETE /features/:id (no cascade) unlinks the phase instead of orphaning it", async () => {
  const fx = await startServerFixture({ name: "t424-server-unlink" });
  try {
    const feature = (await fx.store.loadFeatures()).features.find((entry) => entry.number === 1);
    const phase = (await fx.store.loadAllPhases()).find((entry) => entry.number === 1);
    assert.ok(feature && phase, "seed feature/phase exist");

    const deleted = await request(fx, `/features/${feature.id}`, { method: "DELETE" });
    assert.deepEqual(deleted.body, { deleted: feature.id }, "response shape unchanged for a real delete");

    const afterPhase = (await fx.store.loadAllPhases()).find((entry) => entry.id === phase.id);
    assert.ok(afterPhase, "phase must survive an unlink delete, not be orphaned");
    assert.equal(afterPhase.featureId, undefined, "phase must be unlinked, never left pointing at a feature id that no longer exists");
  } finally {
    await closeServerFixture(fx);
  }
});

test("DELETE /features/:id?cascade=true deletes the phase outright", async () => {
  const fx = await startServerFixture({ name: "t424-server-cascade" });
  try {
    const feature = (await fx.store.loadFeatures()).features.find((entry) => entry.number === 1);
    const phase = (await fx.store.loadAllPhases()).find((entry) => entry.number === 1);

    await request(fx, `/features/${feature.id}?cascade=true`, { method: "DELETE" });

    const afterPhase = (await fx.store.loadAllPhases()).find((entry) => entry.id === phase.id);
    assert.equal(afterPhase, undefined, "cascade delete removes the phase");
  } finally {
    await closeServerFixture(fx);
  }
});

test("DELETE /features/:id for a feature that does not exist fails instead of reporting success", async () => {
  const fx = await startServerFixture({ name: "t424-server-missing" });
  try {
    const missing = await request(fx, "/features/00000000-0000-4000-8000-000000000000", {
      method: "DELETE",
      expectStatus: 404,
    });
    assert.equal(missing.status, 404);
  } finally {
    await closeServerFixture(fx);
  }
});
