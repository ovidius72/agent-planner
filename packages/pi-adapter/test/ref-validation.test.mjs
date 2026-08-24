import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import planPiExtension from "../dist/index.js";
import { PlanStore, FeatureSchema, PhaseSchema, createFeatureId, createPhaseId, createTaskId } from "../../plan-core/dist/index.js";

const dirs = [];
after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function nowISO() {
  return new Date().toISOString();
}

function toolText(result) {
  return (result.content ?? []).map((entry) => entry.text).join("\n");
}

function loadPiTools() {
  const tools = new Map();
  planPiExtension({
    on() {},
    sendMessage() {},
    registerCommand() {},
    registerTool(def) { tools.set(def.name, def); },
  });
  return tools;
}

function makeCtx(cwd) {
  return {
    cwd,
    hasUI: false,
    ui: {
      notify() {},
      async input() { return undefined; },
      async select() { return null; },
    },
  };
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "pi-ref-validation-"));
  dirs.push(root);
  const st = new PlanStore(join(root, ".planner"));
  st.enableAutoSync(true);
  await st.init("pi ref validation");
  const now = nowISO();

  const featureA = FeatureSchema.parse({ id: createFeatureId(), number: 1, name: "Auth API", status: "planned", createdAt: now, updatedAt: now });
  const featureB = FeatureSchema.parse({ id: createFeatureId(), number: 2, name: "Auth UI", status: "planned", createdAt: now, updatedAt: now });
  await st.saveFeature(featureA);
  await st.saveFeature(featureB);

  const task = {
    id: createTaskId(),
    number: 1,
    phaseId: "",
    title: "Seed task",
    shortName: "seed-task",
    status: "planned",
    description: "Seed task description that is long enough to be useful in tests.",
    notes: "",
    statusLog: [],
    decisions: [],
    acceptedDecisions: [],
    checklist: [],
    subtasks: [],
    dependsOn: [],
    startedAt: "",
    completedAt: "",
    createdAt: now,
    updatedAt: now,
  };

  const phaseId = createPhaseId();
  const seedTask = { ...task, phaseId };
  const phase = PhaseSchema.parse({
    id: phaseId,
    number: 1,
    featureId: featureA.id,
    slug: "seed-phase",
    title: "Seed Phase",
    status: "planned",
    tasks: [seedTask],
    taskIds: [seedTask.id],
    createdAt: now,
    updatedAt: now,
  });
  await st.savePhase(phase);
  await st.updateProject((project) => ({
    ...project,
    nextFeatureNumber: 3,
    nextPhaseNumber: 2,
    nextTaskNumber: 2,
  }));

  return { root, st, featureA, featureB, phase, taskId: phase.tasks[0].id };
}

const tools = loadPiTools();

describe("pi-adapter strict ref validation", () => {
  test("phase_create resolves human feature ref F00x to the internal feature id", async () => {
    const { root, st, featureA } = await setup();
    const result = await tools.get("phase_create").execute("id", {
      title: "Linked Phase",
      featureId: "F001",
      description: "src/example.ts:10 existing state and desired behavior for this linked phase regression test.",
    }, undefined, undefined, makeCtx(root));

    const text = toolText(result);
    assert.match(text, /✅ Phase created: P\d+\(F001\)/);
    const phases = await st.loadAllPhases();
    const created = phases.find((entry) => entry.title === "Linked Phase");
    assert.ok(created);
    assert.equal(created.featureId, featureA.id);
  });

  test("phase_create rejects unresolved feature refs and does not persist a phase", async () => {
    const { root, st } = await setup();
    const before = await st.loadAllPhases();

    const result = await tools.get("phase_create").execute("id", {
      title: "Broken Phase",
      featureId: "F999",
      description: "src/example.ts:20 this should fail because the parent feature ref does not exist.",
    }, undefined, undefined, makeCtx(root));

    assert.equal(toolText(result), "Feature not found: F999");
    const after = await st.loadAllPhases();
    assert.equal(after.length, before.length);
    assert.equal(after.find((entry) => entry.title === "Broken Phase"), undefined);
  });

  test("phase_update rejects unresolved relink refs and preserves the current parent", async () => {
    const { root, st, phase, featureA } = await setup();

    const result = await tools.get("phase_update").execute("id", {
      phaseId: "P001",
      featureId: "F999",
    }, undefined, undefined, makeCtx(root));

    assert.equal(toolText(result), "Feature not found: F999");
    const stored = await st.loadPhase(phase.id);
    assert.equal(stored.featureId, featureA.id);
  });

  test("feature_update rejects ambiguous feature refs and leaves data unchanged", async () => {
    const { root, st } = await setup();

    const result = await tools.get("feature_update").execute("id", {
      featureId: "Auth",
      name: "Broken rename",
    }, undefined, undefined, makeCtx(root));

    assert.match(toolText(result), /^Ambiguous feature ref: Auth\./);
    const features = (await st.loadFeatures()).features;
    assert.deepEqual(features.map((feature) => feature.name), ["Auth API", "Auth UI"]);
  });

  test("feature_update rejects a fieldless payload without writing", async () => {
    const { root, st, featureA } = await setup();
    const featurePath = join(root, ".planner", "features", `${featureA.id}.json`);
    const beforeBytes = await readFile(featurePath);
    const before = (await st.loadFeatures()).features.find((feature) => feature.id === featureA.id);

    const result = await tools.get("feature_update").execute("id", { featureId: "F001" }, undefined, undefined, makeCtx(root));

    assert.match(toolText(result), /^Not updated — no mutable fields were received\./);
    assert.equal(result.details.updated, false);
    assert.equal(result.details.reason, "no-mutable-fields");
    assert.deepEqual(await readFile(featurePath), beforeBytes, "fieldless update leaves feature JSON byte-identical");
    const after = (await st.loadFeatures()).features.find((feature) => feature.id === featureA.id);
    assert.equal(after?.updatedAt, before?.updatedAt, "fieldless update does not change updatedAt");
  });

  test("feature_update resolves F00x once and mutates only that feature", async () => {
    const { root, st, featureA, featureB } = await setup();
    const result = await tools.get("feature_update").execute("id", {
      featureId: "F001",
      description: "Updated through the F001 human reference.",
    }, undefined, undefined, makeCtx(root));

    assert.match(toolText(result), /✅ Feature updated: F001/);
    assert.match(toolText(result), /Fields saved: description\./);
    assert.deepEqual(result.details.updatedFields, ["description"]);
    const features = (await st.loadFeatures()).features;
    assert.equal(features.find((feature) => feature.id === featureA.id)?.description, "Updated through the F001 human reference.");
    assert.notEqual(features.find((feature) => feature.id === featureB.id)?.description, "Updated through the F001 human reference.");
  });

  test("feature_discuss updates governance fields and marks context ready", async () => {
    const { root, st, featureA } = await setup();
    const result = await tools.get("feature_discuss").execute("id", {
      featureId: "F001",
      description: "src/feature.ts:10 current scope and goals for the Auth API feature.",
      workDone: "Login endpoint scaffolding exists.",
      workRemaining: "Need token rotation and audit logging.",
      dependencies: ["Shared auth middleware", "Billing contract"],
    }, undefined, undefined, makeCtx(root));

    assert.match(toolText(result), /✅ Feature discussed\/updated: F001/);
    const stored = (await st.loadFeatures()).features.find((feature) => feature.id === featureA.id);
    assert.equal(stored?.description, "src/feature.ts:10 current scope and goals for the Auth API feature.");
    assert.equal(stored?.workDone, "Login endpoint scaffolding exists.");
    assert.equal(stored?.workRemaining, "Need token rotation and audit logging.");
    assert.deepEqual(stored?.dependsOn, ["Shared auth middleware", "Billing contract"]);
    assert.equal(stored?.contextReady, true);
    assert.match(stored?.contextReadyReason ?? "", /feature_discuss|feature discuss/i);
  });

  test("plan_cleanup_orphan_phases supports dry-run and confirmed cleanup", async () => {
    const { root, st, featureA } = await setup();
    const now = nowISO();
    const orphanFeatureId = createFeatureId();
    const orphanPhaseId = createPhaseId();
    const orphanPhase = {
      id: orphanPhaseId,
      number: 2,
      featureId: orphanFeatureId,
      slug: "orphan-phase",
      title: "Orphan phase",
      status: "planned",
      description: "src/example.ts:77 orphan cleanup regression test phase that should be deleted only after confirmation.",
      tasks: [],
      taskIds: [],
      createdAt: now,
      updatedAt: now,
    };
    // Write orphan phase file directly because savePhase now rejects non-UUID/non-existent featureIds.
    await mkdir(join(root, ".planner", "phases"), { recursive: true });
    await writeFile(join(root, ".planner", "phases", orphanPhaseId + ".json"), JSON.stringify(orphanPhase, null, 2));
    await st.updateFeatures((doc) => {
      const target = doc.features.find((entry) => entry.id === featureA.id);
      if (target) target.phaseIds.push(orphanPhase.id);
      return doc;
    });

    const dryRun = await tools.get("plan_cleanup_orphan_phases").execute("id", {}, undefined, undefined, makeCtx(root));
    assert.match(toolText(dryRun), /Found 1 orphan phase/);
    assert.match(toolText(dryRun), /Rerun with confirm=true/);

    const confirmed = await tools.get("plan_cleanup_orphan_phases").execute("id", { confirm: true }, undefined, undefined, makeCtx(root));
    assert.match(toolText(confirmed), /Removed 1 orphan phase/);
    const phases = await st.loadAllPhases();
    assert.equal(phases.some((entry) => entry.id === orphanPhase.id), false);
    const feature = (await st.loadFeatures()).features.find((entry) => entry.id === featureA.id);
    assert.equal(feature?.phaseIds.includes(orphanPhase.id), false);
  });

  test("task_get still resolves globally unique T00x refs after stricter feature validation", async () => {
    const { root } = await setup();
    const result = await tools.get("task_get").execute("id", { taskId: "T001" }, undefined, undefined, makeCtx(root));
    assert.match(toolText(result), /Seed task — P001\(F001\)\/T001/);
  });


  test("task_create rejects orphan phase refs and does not allocate a number", async () => {
    const { root, st } = await setup();
    const before = await st.loadProject();
    const beforePhases = await st.loadAllPhases();

    const result = await tools.get("task_create").execute("id", {
      featureId: "F001",
      phaseId: "P999",
      title: "Orphan Task",
      description: "src/example.ts:50 this task should not be created because the parent phase P999 does not exist.",
    }, undefined, undefined, makeCtx(root));

    assert.equal(toolText(result), "Phase not found: P999");
    const after = await st.loadProject();
    assert.equal(after.nextTaskNumber, before.nextTaskNumber);
    const afterPhases = await st.loadAllPhases();
    assert.equal(afterPhases.length, beforePhases.length);
    assert.equal(afterPhases.flatMap((entry) => entry.tasks).some((task) => task.title === "Orphan Task"), false);
  });

  test("task_create resolves human phase ref P001 to the internal phase id", async () => {
    const { root, st, phase } = await setup();
    const result = await tools.get("task_create").execute("id", {
      featureId: "F001",
      phaseId: "P001",
      title: "Linked Task",
      description: "src/example.ts:60 this task should be created by resolving the human P001 ref to the stored phase UUID.",
    }, undefined, undefined, makeCtx(root));

    assert.match(toolText(result), /^Task created:/);
    const stored = await st.loadPhase(phase.id);
    const created = stored.tasks.find((task) => task.title === "Linked Task");
    assert.ok(created);
    assert.equal(created.phaseId, phase.id);
  });

  test("task_create rejects missing featureId", async () => {
    const { root, st, phase } = await setup();
    const before = await st.loadProject();
    const result = await tools.get("task_create").execute("id", {
      phaseId: "P001",
      title: "Task Without Feature",
      description: "src/example.ts:61 this task should not be created because no featureId was supplied.",
    }, undefined, undefined, makeCtx(root));
    assert.match(toolText(result), /featureId is required|must belong to a feature/i);
    const after = await st.loadProject();
    assert.equal(after.nextTaskNumber, before.nextTaskNumber);
    const stored = await st.loadPhase(phase.id);
    assert.equal(stored.tasks.some((task) => task.title === "Task Without Feature"), false);
  });

  test("task_create rejects feature/phase mismatch (phase belongs to another feature)", async () => {
    const { root, st, phase } = await setup();
    const before = await st.loadProject();
    // P001 belongs to F001 (featureA). Passing F002 should be rejected.
    const result = await tools.get("task_create").execute("id", {
      featureId: "F002",
      phaseId: "P001",
      title: "Mismatched Task",
      description: "src/example.ts:62 this task should not be created because P001 does not belong to F002.",
    }, undefined, undefined, makeCtx(root));
    assert.match(toolText(result), /does not belong to feature/i);
    const after = await st.loadProject();
    assert.equal(after.nextTaskNumber, before.nextTaskNumber);
    const stored = await st.loadPhase(phase.id);
    assert.equal(stored.tasks.some((task) => task.title === "Mismatched Task"), false);
  });

  test("task_create returns a composite ref (F00x/P00x/T00x) instead of a raw UUID", async () => {
    const { root } = await setup();
    const result = await tools.get("task_create").execute("id", {
      featureId: "F001",
      phaseId: "P001",
      title: "Composite Ref Task",
      description: "src/example.ts:63 this task should be reported with a composite ref, not a raw UUID.",
    }, undefined, undefined, makeCtx(root));
    const text = toolText(result);
    assert.match(text, /Task created: P001\(F001\)\/T\d+/);
    assert.doesNotMatch(text, /Task created: [0-9a-f]{8}-/);
  });

  test("phase_create rejects orphan feature refs and does not allocate a number", async () => {
    const { root, st } = await setup();
    const before = await st.loadProject();
    const beforePhases = await st.loadAllPhases();

    const result = await tools.get("phase_create").execute("id", {
      title: "Orphan Phase",
      featureId: "F999",
      description: "src/example.ts:70 this phase should not be created because the parent feature F999 does not exist.",
    }, undefined, undefined, makeCtx(root));

    assert.equal(toolText(result), "Feature not found: F999");
    const after = await st.loadProject();
    assert.equal(after.nextPhaseNumber, before.nextPhaseNumber);
    const afterPhases = await st.loadAllPhases();
    assert.equal(afterPhases.length, beforePhases.length);
  });


  test("task_create returns a clear error if the phase is deleted after resolution", async () => {
    const { root, st, phase } = await setup();
    const before = await st.loadProject();

    // Delete the phase file after resolution but before the tool writes.
    await rm(join(root, ".planner", "phases", phase.id + ".json"), { force: true });

    const result = await tools.get("task_create").execute("id", {
      featureId: "F001",
      phaseId: "P001",
      title: "Race Task",
      description: "src/example.ts:80 this task must fail because the resolved phase P001 disappears before the write.",
    }, undefined, undefined, makeCtx(root));

    const text = toolText(result);
    assert.match(text, /no longer exists|Refusing to create child|Phase not found/);
    const after = await st.loadProject();
    assert.equal(after.nextTaskNumber, before.nextTaskNumber);
  });

  test("task_create assigns unique global task numbers under parallel calls", async () => {
    const { root, st, phase } = await setup();
    await Promise.all(Array.from({ length: 8 }, (_, index) => tools.get("task_create").execute("id", {
      featureId: "F001",
      phaseId: "P001",
      title: `Parallel Task ${index + 1}`,
      description: `src/example.ts:${100 + index} create a task in parallel and assert the global numbering stays unique across concurrent calls.`,
    }, undefined, undefined, makeCtx(root))));

    const stored = await st.loadPhase(phase.id);
    const created = stored.tasks.filter((task) => task.title.startsWith("Parallel Task "));
    const numbers = created.map((task) => task.number).sort((a, b) => a - b);
    assert.equal(created.length, 8);
    assert.equal(new Set(numbers).size, 8);
    assert.deepEqual(numbers, [2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("task recommendation and approved deviation retain an explicit resume target", async () => {
    const { root, st, phase, taskId } = await setup();
    const temporaryId = createTaskId();
    await st.updatePhase(phase.id, (stored) => ({ ...stored, tasks: [...stored.tasks, { ...stored.tasks[0], id: temporaryId, phaseId: phase.id, number: 2, title: "Temporary task", shortName: "temporary-task", priority: 20 }], taskIds: [...stored.taskIds, temporaryId] }));
    const ctx = makeCtx(root);
    assert.match(toolText(await tools.get("task_recommend").execute("id", {}, undefined, undefined, ctx)), /Recommended \(priority\): P001\(F001\)\/T002/);
    const recorded = await tools.get("task_deviation").execute("id", { temporary_task: temporaryId, resume_task: taskId, reason: "Approved urgent work" }, undefined, undefined, ctx);
    assert.match(toolText(recorded), /Approved deviation/);
    let project = await st.loadProject();
    assert.equal(project.workDeviations.at(-1)?.resumeTaskId, taskId);
    const started = await tools.get("task_start").execute("id", { taskId: temporaryId }, undefined, undefined, ctx);
    const startedText = toolText(started);
    assert.match(startedText, /Task started/);
    assert.ok(startedText.indexOf("Feature F001") < startedText.indexOf("Phase P001"), "task start briefs feature before phase");
    project = await st.loadProject();
    assert.equal(project.workDeviations.at(-1)?.state, "active");
    assert.match(toolText(await tools.get("task_complete").execute("id", { taskId: temporaryId }, undefined, undefined, ctx)), /Task completed.*RESUME REQUIRED/s);
    project = await st.loadProject();
    assert.equal(project.workDeviations.at(-1)?.state, "resume-required");
    assert.match(toolText(await tools.get("task_recommend").execute("id", {}, undefined, undefined, ctx)), /Recommended \(resume\): P001\(F001\)\/T001/);
  });
});
