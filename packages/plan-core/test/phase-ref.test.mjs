import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { findPhaseByRef, PhaseSchema, FeatureSchema, createPhaseId, createFeatureId } from "../dist/index.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs = [];
after(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function setup() {
  await mkdtemp(join(tmpdir(), "ref-")).then((d) => dirs.push(d));
  const now = new Date().toISOString();
  const feat1 = FeatureSchema.parse({ id: createFeatureId(), number: 1, name: "Auth", status: "planned", createdAt: now, updatedAt: now });
  const feat2 = FeatureSchema.parse({ id: createFeatureId(), number: 2, name: "Billing", status: "planned", createdAt: now, updatedAt: now });
  const features = [feat1, feat2];
  const mkPhase = (number, featureId, title) =>
    PhaseSchema.parse({ id: createPhaseId(), number, featureId, slug: `phase-${number}`, title, status: "draft", createdAt: now, updatedAt: now });
  // P001 orphan, P002(F001), P003(F002), P004(F001)
  const phases = [
    mkPhase(1, undefined, "Orphan Phase"),
    mkPhase(2, feat1.id, "Auth Core"),
    mkPhase(3, feat2.id, "Billing API"),
    mkPhase(4, feat1.id, "Auth Login Flow"),
  ];
  return { phases, features };
}

describe("findPhaseByRef", () => {
  test("resolves short ref P00x (globally unique number)", async () => {
    const { phases, features } = await setup();
    assert.equal(findPhaseByRef(phases, features, "P001").id, phases[0].id);
    assert.equal(findPhaseByRef(phases, features, "P004").id, phases[3].id);
  });

  test("resolves lowercase / non-padded forms (p1 == P001)", async () => {
    const { phases, features } = await setup();
    assert.equal(findPhaseByRef(phases, features, "p1").id, phases[0].id);
    assert.equal(findPhaseByRef(phases, features, "p04").id, phases[3].id);
  });

  test("resolves composite ref P00x(F00x) with parent validation", async () => {
    const { phases, features } = await setup();
    assert.equal(findPhaseByRef(phases, features, "P002(F001)").id, phases[1].id);
    assert.equal(findPhaseByRef(phases, features, "P003(F002)").id, phases[2].id);
  });

  test("composite ref with wrong parent feature → undefined", async () => {
    const { phases, features } = await setup();
    assert.equal(findPhaseByRef(phases, features, "P002(F002)"), undefined);
    assert.equal(findPhaseByRef(phases, features, "P001(F001)"), undefined);
  });

  test("resolves by UUID (exact, case-insensitive)", async () => {
    const { phases, features } = await setup();
    assert.equal(findPhaseByRef(phases, features, phases[1].id).id, phases[1].id);
    assert.equal(findPhaseByRef(phases, features, phases[1].id.toUpperCase()).id, phases[1].id);
  });

  test("title fallback: exact then includes (backward compat)", async () => {
    const { phases, features } = await setup();
    assert.equal(findPhaseByRef(phases, features, "Auth Core").id, phases[1].id);
    assert.equal(findPhaseByRef(phases, features, "billing api").id, phases[2].id);
  });

  test("non-existent ref → undefined", async () => {
    const { phases, features } = await setup();
    assert.equal(findPhaseByRef(phases, features, "P999"), undefined);
    assert.equal(findPhaseByRef(phases, features, "nope"), undefined);
  });

  test("empty / whitespace ref → undefined", async () => {
    const { phases, features } = await setup();
    assert.equal(findPhaseByRef(phases, features, ""), undefined);
    assert.equal(findPhaseByRef(phases, features, "   "), undefined);
  });
});