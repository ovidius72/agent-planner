import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { PlanStore, PhaseSchema, FeatureSchema, createPhaseId, createFeatureId } from "../dist/index.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs = [];
after(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "handoff-"));
  dirs.push(root);
  const store = new PlanStore(join(root, ".planner"));
  await store.init("test");
  const now = new Date().toISOString();
  const feat = FeatureSchema.parse({ id: createFeatureId(), number: 1, name: "Feat One", status: "planned", createdAt: now, updatedAt: now });
  await store.saveFeature(feat);
  const mkPhase = (number, featureId) =>
    PhaseSchema.parse({ id: createPhaseId(), number, featureId, slug: `phase-${number}`, title: `Phase ${number}`, status: "draft", createdAt: now, updatedAt: now });
  const p1 = mkPhase(1, undefined); // orphan
  const p2 = mkPhase(2, feat.id); // linked
  const p3 = mkPhase(3, feat.id); // linked
  await store.savePhase(p1);
  await store.savePhase(p2);
  await store.savePhase(p3);
  return { store, feat, phases: { p1, p2, p3 } };
}

describe("PlanStore phase-scoped handoff", () => {
  test("getPhaseHandoff returns \"\" by default (zod backfill)", async () => {
    const { store, phases } = await setup();
    assert.equal(await store.getPhaseHandoff(phases.p1.id), "");
  });

  test("setPhaseHandoff → getPhaseHandoff round-trips the text", async () => {
    const { store, phases } = await setup();
    const text = "# Work in progress\n\nDoing X. Need to finish Y.";
    await store.setPhaseHandoff(phases.p2.id, text);
    assert.equal(await store.getPhaseHandoff(phases.p2.id), text);
  });

  test("listHandoffs excludes cleared handoffs", async () => {
    const { store, phases } = await setup();
    await store.setPhaseHandoff(phases.p1.id, "hello");
    assert.equal((await store.listHandoffs()).length, 1);
    await store.clearPhaseHandoff(phases.p1.id);
    assert.equal((await store.listHandoffs()).length, 0);
    assert.equal(await store.getPhaseHandoff(phases.p1.id), "");
  });

  test("listHandoffs sorts by handoffUpdatedAt desc (newest first)", async () => {
    const { store, phases } = await setup();
    await store.setPhaseHandoff(phases.p1.id, "first set"); // oldest
    await new Promise((r) => setTimeout(r, 15));
    await store.setPhaseHandoff(phases.p2.id, "second set"); // newer
    await new Promise((r) => setTimeout(r, 15));
    await store.setPhaseHandoff(phases.p3.id, "third set"); // newest
    const list = await store.listHandoffs();
    assert.deepEqual(
      list.map((x) => x.phaseId),
      [phases.p3.id, phases.p2.id, phases.p1.id],
    );
  });

  test("multiple handoffs coexist on different phases with correct compositeRef + firstLine", async () => {
    const { store, phases, feat } = await setup();
    await store.setPhaseHandoff(phases.p1.id, "# Orphan work\nDetails here.");
    await store.setPhaseHandoff(phases.p2.id, "Linked phase plain first line.");
    const list = await store.listHandoffs();
    assert.equal(list.length, 2);
    const e1 = list.find((x) => x.phaseId === phases.p1.id);
    const e2 = list.find((x) => x.phaseId === phases.p2.id);
    assert.equal(e1.compositeRef, "P001", "orphan ref has no (F00x)");
    assert.equal(e2.compositeRef, "P002(F001)", "linked ref includes parent feature");
    assert.equal(e1.firstLine, "Orphan work", "leading # header stripped");
    assert.equal(e2.firstLine, "Linked phase plain first line.");
  });

  test("clearPhaseHandoff preserves handoffUpdatedAt as an audit trail", async () => {
    const { store, phases } = await setup();
    await store.setPhaseHandoff(phases.p1.id, "temporary handoff");
    const stamp = (await store.loadPhase(phases.p1.id)).handoffUpdatedAt;
    assert.ok(stamp);
    await store.clearPhaseHandoff(phases.p1.id);
    const after = await store.loadPhase(phases.p1.id);
    assert.equal(after.handoff, "");
    assert.equal(after.handoffUpdatedAt, stamp, "handoffUpdatedAt must survive clear");
  });

  test("setPhaseHandoff on a missing phase throws (clear error)", async () => {
    const { store } = await setup();
    await assert.rejects(() => store.setPhaseHandoff("no-such-phase", "x"));
  });

  test("getPhaseHandoff on a missing phase throws", async () => {
    const { store } = await setup();
    await assert.rejects(() => store.getPhaseHandoff("no-such-phase"));
  });
});