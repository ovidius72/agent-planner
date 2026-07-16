import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { PlanStore, PhaseSchema, FeatureSchema, createPhaseId, createFeatureId, createTaskId } from "../dist/index.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs = [];
after(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "resume-flow-"));
  dirs.push(root);
  const store = new PlanStore(join(root, ".planner"));
  await store.init("P4 test");
  const now = new Date().toISOString();
  const feat = FeatureSchema.parse({ id: createFeatureId(), number: 1, name: "Feat One", status: "planned", createdAt: now, updatedAt: now });
  await store.saveFeature(feat);
  const mkPhase = (n, status = "planned") =>
    PhaseSchema.parse({ id: createPhaseId(), number: n, featureId: feat.id, slug: `phase-${n}`, title: `Phase ${n}`, status, createdAt: now, updatedAt: now });
  const mkTask = (phaseId, status = "planned") =>
    ({ id: createTaskId(), number: 1, phaseId, title: `task`, shortName: "t", status, createdAt: now, updatedAt: now });
  return { store, feat, mkPhase, mkTask, now };
}

describe("P004 resume flow — auto-clear-on-done", () => {
  test("syncStatuses auto-clears handoff when phase transitions to done (returns composite ref)", async () => {
    const { store, mkPhase, mkTask } = await setup();
    const p = mkPhase(1, "planned");
    await store.savePhase(p);
    await store.updatePhase(p.id, (ph) => { ph.tasks = [mkTask(ph.id), mkTask(ph.id)]; return ph; });
    await store.setPhaseHandoff(p.id, "# Resume ctx");
    assert.equal((await store.listHandoffs()).length, 1);

    await store.updatePhase(p.id, (ph) => {
      for (const t of ph.tasks) { t.status = "done"; t.completedAt = nowISO(); t.startedAt = nowISO(); }
      return ph;
    });
    const cleared = await store.syncStatuses();
    assert.deepEqual(cleared, ["P001(F001)"]);

    const ph = await store.loadPhase(p.id);
    assert.equal(ph.status, "done");
    assert.equal(ph.handoff, "");
    assert.equal((await store.listHandoffs()).length, 0);
    assert.ok(ph.handoffUpdatedAt, "audit timestamp kept after auto-clear");
  });

  test("syncTaskStatusRollup auto-clears and returns the composite ref", async () => {
    const { store, mkPhase, mkTask } = await setup();
    const p = mkPhase(2, "planned");
    await store.savePhase(p);
    await store.updatePhase(p.id, (ph) => { ph.tasks = [mkTask(ph.id), mkTask(ph.id)]; return ph; });
    await store.setPhaseHandoff(p.id, "# P2 handoff");

    await store.updatePhase(p.id, (ph) => {
      for (const t of ph.tasks) { t.status = "done"; t.completedAt = nowISO(); t.startedAt = nowISO(); }
      return ph;
    });
    const cleared = await store.syncTaskStatusRollup(p.id);
    assert.equal(cleared, "P002(F001)");
    const ph = await store.loadPhase(p.id);
    assert.equal(ph.status, "done");
    assert.equal(ph.handoff, "");
  });

  test("reopen (done → in-progress) does NOT restore the handoff", async () => {
    const { store, mkPhase, mkTask } = await setup();
    const p = mkPhase(3, "planned");
    await store.savePhase(p);
    await store.updatePhase(p.id, (ph) => { ph.tasks = [mkTask(ph.id)]; return ph; });
    await store.setPhaseHandoff(p.id, "# will be cleared");
    await store.updatePhase(p.id, (ph) => { for (const t of ph.tasks) { t.status = "done"; t.completedAt = nowISO(); t.startedAt = nowISO(); } return ph; });
    await store.syncStatuses();
    assert.equal((await store.loadPhase(p.id)).handoff, "");

    // reopen: one task back to planned
    await store.updatePhase(p.id, (ph) => { ph.tasks[0].status = "planned"; return ph; });
    const cleared = await store.syncStatuses();
    assert.deepEqual(cleared, []);
    const ph = await store.loadPhase(p.id);
    assert.notEqual(ph.status, "done");
    assert.equal(ph.handoff, "", "handoff stays empty after reopen (not restored)");
  });

  test("no-transition (planned phase with handoff) survives syncStatuses", async () => {
    const { store, mkPhase, mkTask } = await setup();
    const p = mkPhase(4, "planned");
    await store.savePhase(p);
    await store.updatePhase(p.id, (ph) => { ph.tasks = [mkTask(ph.id)]; return ph; });
    await store.setPhaseHandoff(p.id, "# keep me");
    const cleared = await store.syncStatuses();
    assert.deepEqual(cleared, []);
    assert.equal((await store.loadPhase(p.id)).handoff, "# keep me");
  });
});

describe("P004 resume flow — write-to-in-progress + fallback", () => {
  test("writeProjectHandoff data path: writes to the current in-progress phase", async () => {
    const { store, mkPhase, mkTask } = await setup();
    const p = mkPhase(5, "in-progress");
    await store.savePhase(p);
    await store.updatePhase(p.id, (ph) => { ph.tasks = [mkTask(ph.id, "in-progress")]; return ph; });

    // replicate writeProjectHandoff(st, reason): find in-progress phase, setPhaseHandoff
    const phases = await store.loadAllPhases();
    const phase = phases.find((x) => x.status === "in-progress") ?? null;
    assert.ok(phase);
    await store.setPhaseHandoff(phase.id, "# Auto handoff (before compact)");
    const list = await store.listHandoffs();
    assert.equal(list.length, 1);
    assert.equal(list[0].compositeRef, "P005(F001)");
    assert.equal(list[0].firstLine, "Auto handoff (before compact)");
  });

  test("writeProjectHandoff skips when no in-progress phase (resume falls back to resume.json)", async () => {
    const { store, mkPhase, mkTask } = await setup();
    const p = mkPhase(6, "planned");
    await store.savePhase(p);
    await store.updatePhase(p.id, (ph) => { ph.tasks = [mkTask(ph.id)]; return ph; });

    const phases = await store.loadAllPhases();
    const phase = phases.find((x) => x.status === "in-progress") ?? null;
    assert.equal(phase, null, "no in-progress phase -> writeProjectHandoff would skip");
    assert.equal((await store.listHandoffs()).length, 0);

    // fallback: resume.json is readable (no handoff injection needed)
    const resume = await store.loadResume();
    assert.ok(resume, "resume.json available as fallback focus source");
  });
});

function nowISO() { return new Date().toISOString(); }