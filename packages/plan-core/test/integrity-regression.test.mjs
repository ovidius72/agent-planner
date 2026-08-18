import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlanStore, FeatureSchema, PhaseSchema, createFeatureId, createPhaseId } from "../dist/index.js";

const dirs = [];
after(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

function nowISO() {
  return new Date().toISOString();
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "plan-integrity-"));
  dirs.push(root);
  const plannerRoot = join(root, ".planner");
  const st = new PlanStore(plannerRoot);
  st.enableAutoSync(true);
  await st.init("plan integrity regression");
  return { root, plannerRoot, st };
}

describe("plan-core integrity regression coverage", () => {
  test("savePhase canonicalizes a human feature ref and relinks feature phaseIds", async () => {
    const { plannerRoot, st } = await setup();
    const now = nowISO();
    const feature = FeatureSchema.parse({
      id: createFeatureId(),
      number: 10,
      shortId: "5LMHE",
      name: "Planner-only backlog consolidation",
      status: "planned",
      createdAt: now,
      updatedAt: now,
      phaseIds: [],
    });
    await st.saveFeature(feature);

    const phase = {
      id: createPhaseId(),
      number: 37,
      shortId: "NN8Q4",
      featureId: "F010", // human ref — savePhase must resolve to UUID
      slug: "capture-residual-backlog",
      title: "Capture residual backlog in planner and remove legacy checklist files",
      status: "planned",
      description: "packages/plan-core/src/plan-store.ts:1 savePhase must resolve this ref before persisting.",
      tasks: [],
      taskIds: [],
      createdAt: now,
      updatedAt: now,
    };

    await st.savePhase(phase);

    const rawPhase = JSON.parse(await readFile(join(plannerRoot, "phases", `${phase.id}.json`), "utf8"));
    assert.equal(rawPhase.featureId, feature.id);

    const loaded = (await st.loadFeatures()).features.find((entry) => entry.id === feature.id);
    assert.deepEqual(loaded?.phaseIds, [phase.id]);
  });

  test("cleanupOrphanPhases discovers and removes phase files without a valid owning feature", async () => {
    const { plannerRoot, st } = await setup();
    const now = nowISO();
    const feature = FeatureSchema.parse({
      id: createFeatureId(),
      number: 1,
      name: "Linked feature",
      status: "planned",
      createdAt: now,
      updatedAt: now,
      phaseIds: [],
    });
    await st.saveFeature(feature);

    const linkedPhase = PhaseSchema.parse({
      id: createPhaseId(),
      number: 1,
      featureId: feature.id,
      slug: "linked-phase",
      title: "Linked phase",
      status: "planned",
      description: "packages/plan-core/test/integrity-regression.test.mjs:1 linked phase must survive orphan cleanup.",
      tasks: [],
      taskIds: [],
      createdAt: now,
      updatedAt: now,
    });
    const orphanFeatureId = createFeatureId(); // syntactically valid UUID that does NOT exist
    const orphanPhase = {
      id: createPhaseId(),
      number: 2,
      featureId: orphanFeatureId,
      slug: "orphan-phase",
      title: "Orphan phase",
      status: "planned",
      description: "packages/plan-core/test/integrity-regression.test.mjs:1 orphan phase should be discovered and deleted.",
      tasks: [],
      taskIds: [],
      createdAt: now,
      updatedAt: now,
    };

    await st.savePhase(linkedPhase);
    // Simulate legacy/corrupted data: write orphan phase file directly, bypassing
    // savePhase which now enforces referential integrity upfront.
    await mkdir(join(plannerRoot, "phases"), { recursive: true });
    await writeFile(join(plannerRoot, "phases", `${orphanPhase.id}.json`), `${JSON.stringify(orphanPhase, null, 2)}\n`, "utf8");
    await st.updateFeatures((doc) => {
      const target = doc.features.find((entry) => entry.id === feature.id);
      if (target) target.phaseIds = [linkedPhase.id, orphanPhase.id];
      return doc;
    });

    const found = await st.listOrphanPhases();
    assert.equal(found.length, 1);
    assert.equal(found[0].phaseId, orphanPhase.id);
    assert.match(found[0].reason, /feature not found/);
    assert.equal(found[0].compositeRef, "P002");

    const report = await st.cleanupOrphanPhases();
    assert.equal(report.removed.length, 1);
    assert.equal(report.removed[0].phaseId, orphanPhase.id);

    await assert.rejects(() => readFile(join(plannerRoot, "phases", `${orphanPhase.id}.json`), "utf8"));
    const linkedRaw = JSON.parse(await readFile(join(plannerRoot, "phases", `${linkedPhase.id}.json`), "utf8"));
    assert.equal(linkedRaw.title, "Linked phase");
    const reloadedFeature = (await st.loadFeatures()).features.find((entry) => entry.id === feature.id);
    assert.deepEqual(reloadedFeature?.phaseIds, [linkedPhase.id]);
  });

  test("ordinary loads are read-only and do not rewrite a legacy planner gitignore", async () => {
    const { plannerRoot, st } = await setup();
    const gitignore = join(plannerRoot, ".gitignore");
    await writeFile(gitignore, "legacy-pattern\n", "utf8");
    const before = await readFile(gitignore, "utf8");
    await st.loadAll();
    assert.equal(await readFile(gitignore, "utf8"), before);
  });

  test("allocateEntityIdentity is atomic across planner instances and does not rewrite project counters", async () => {
    const { plannerRoot, st } = await setup();
    const before = await readFile(join(plannerRoot, "project.json"), "utf8");
    const other = new PlanStore(plannerRoot);
    const identities = await Promise.all(Array.from({ length: 24 }, (_, index) =>
      (index % 2 === 0 ? st : other).allocateEntityIdentity("task", `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`),
    ));
    assert.equal(new Set(identities.map((identity) => identity.number)).size, 24);
    assert.equal(new Set(identities.map((identity) => identity.shortId)).size, 24);
    assert.deepEqual([...identities.map((identity) => identity.number)].sort((a, b) => a - b), Array.from({ length: 24 }, (_, index) => index + 1));
    assert.equal(await readFile(join(plannerRoot, "project.json"), "utf8"), before, "allocation registry is outside tracked project.json");
  });
});
