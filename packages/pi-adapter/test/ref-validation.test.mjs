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

  test("phase_update rejects derived status writes without mutating metadata", async () => {
    const { root, st, phase } = await setup();
    const phasePath = join(root, ".planner", "phases", `${phase.id}.json`);
    const beforeBytes = await readFile(phasePath);
    const before = await st.loadPhase(phase.id);

    const result = await tools.get("phase_update").execute("id", {
      phaseId: "P001",
      status: "in-progress",
      title: "Rejected mixed update",
    }, undefined, undefined, makeCtx(root));

    assert.equal(result.isError, true);
    assert.match(toolText(result), /DERIVED_STATUS_READ_ONLY/);
    assert.equal(result.details.updated, false);
    assert.equal(result.details.effectiveStatus, "planned");
    assert.deepEqual(await readFile(phasePath), beforeBytes, "status rejection leaves phase JSON byte-identical");
    const after = await st.loadPhase(phase.id);
    assert.equal(after.updatedAt, before.updatedAt, "status rejection does not touch updatedAt");
    assert.equal(after.title, "Seed Phase");
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

  test("fieldless update/discuss payloads return markdown fallback guidance without mutating planner data", async () => {
    const { root, st, featureA, phase, taskId } = await setup();
    const projectPath = join(root, ".planner", "project.json");
    const featurePath = join(root, ".planner", "features", `${featureA.id}.json`);
    const phasePath = join(root, ".planner", "phases", `${phase.id}.json`);
    const projectBefore = await readFile(projectPath);
    const featureBefore = await readFile(featurePath);
    const phaseBefore = await readFile(phasePath);

    const projectResult = await tools.get("project_update").execute("id", {}, undefined, undefined, makeCtx(root));
    assert.equal(projectResult.isError, true);
    assert.equal(projectResult.details.errorCode, "DESCRIPTION_MARKDOWN_FALLBACK_REQUIRED");
    assert.equal(projectResult.details.fallbackDocPath, ".planner/docs/project/description.md");
    assert.match(toolText(projectResult), /descriptionRef/);
    assert.deepEqual(await readFile(projectPath), projectBefore, "fieldless project update leaves project JSON byte-identical");

    const featureUpdate = await tools.get("feature_update").execute("id", { featureId: "F001" }, undefined, undefined, makeCtx(root));
    assert.equal(featureUpdate.isError, true);
    assert.equal(featureUpdate.details.errorCode, "DESCRIPTION_MARKDOWN_FALLBACK_REQUIRED");
    assert.equal(featureUpdate.details.fallbackDocPath, `.planner/docs/features/${featureA.id}.md`);
    assert.deepEqual(await readFile(featurePath), featureBefore, "fieldless feature update leaves feature JSON byte-identical");

    const featureDiscuss = await tools.get("feature_discuss").execute("id", { featureId: "F001" }, undefined, undefined, makeCtx(root));
    assert.equal(featureDiscuss.isError, true);
    assert.equal(featureDiscuss.details.discussed, false);
    assert.equal(featureDiscuss.details.fallbackDocPath, `.planner/docs/features/${featureA.id}.md`);
    const featureAfterDiscuss = (await st.loadFeatures()).features.find((feature) => feature.id === featureA.id);
    assert.equal(featureAfterDiscuss?.contextReady, false, "fieldless feature discuss does not mark context ready");
    assert.deepEqual(await readFile(featurePath), featureBefore, "fieldless feature discuss leaves feature JSON byte-identical");

    const phaseUpdate = await tools.get("phase_update").execute("id", { phaseId: "P001" }, undefined, undefined, makeCtx(root));
    assert.equal(phaseUpdate.isError, true);
    assert.equal(phaseUpdate.details.errorCode, "DESCRIPTION_MARKDOWN_FALLBACK_REQUIRED");
    assert.equal(phaseUpdate.details.fallbackDocPath, `.planner/docs/phases/${phase.id}.md`);
    assert.deepEqual(await readFile(phasePath), phaseBefore, "fieldless phase update leaves phase JSON byte-identical");

    const taskUpdate = await tools.get("task_update").execute("id", { taskId: "T001" }, undefined, undefined, makeCtx(root));
    assert.equal(taskUpdate.isError, true);
    assert.equal(taskUpdate.details.errorCode, "DESCRIPTION_MARKDOWN_FALLBACK_REQUIRED");
    assert.equal(taskUpdate.details.fallbackDocPath, `.planner/docs/tasks/${taskId}.md`);
    assert.deepEqual(await readFile(phasePath), phaseBefore, "fieldless task update leaves host phase JSON byte-identical");
  });

  test("task_start requires a fresh project_guidelines_show attestation when guidelines exist", async () => {
    const { root } = await setup();
    const ctx = makeCtx(root);

    const updated = await tools.get("project_guidelines_update").execute("id", {
      content: "Use English in source code. Run focused tests before claiming success.",
    }, undefined, undefined, ctx);
    assert.match(toolText(updated), /Project Guidelines updated\./);
    assert.equal(updated.details.projectGuidelines.content, "Use English in source code. Run focused tests before claiming success.");

    await tools.get("task_get").execute("id", { taskId: "T001", full: true }, undefined, undefined, ctx);
    await tools.get("phase_get").execute("id", { phaseId: "P001", full: true }, undefined, undefined, ctx);
    await tools.get("feature_get").execute("id", { featureId: "F001", full: true }, undefined, undefined, ctx);

    const denied = await tools.get("task_start").execute("id", { taskId: "T001" }, undefined, undefined, ctx);
    assert.equal(denied.isError, true);
    assert.equal(denied.details.errorCode, "PROJECT_GUIDELINES_READ_REQUIRED");
    assert.deepEqual(denied.details.nextActions, [
      "project_guidelines_show",
      "Retry task_start P001(F001)/T001",
    ]);

    const shown = await tools.get("project_guidelines_show").execute("id", {}, undefined, undefined, ctx);
    assert.match(toolText(shown), /## Project Guidelines/);
    assert.equal(shown.details.readRecorded, true);

    const started = await tools.get("task_start").execute("id", { taskId: "T001" }, undefined, undefined, ctx);
    assert.equal(started.details.started, true);
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

  test("feature_update rejects derived status writes without mutating metadata", async () => {
    const { root, st, featureA } = await setup();
    const featurePath = join(root, ".planner", "features", `${featureA.id}.json`);
    const beforeBytes = await readFile(featurePath);
    const before = (await st.loadFeatures()).features.find((feature) => feature.id === featureA.id);

    const result = await tools.get("feature_update").execute("id", {
      featureId: "F001",
      status: "done",
      description: "This mixed update must be rejected atomically.",
    }, undefined, undefined, makeCtx(root));

    assert.equal(result.isError, true);
    assert.match(toolText(result), /DERIVED_STATUS_READ_ONLY/);
    assert.equal(result.details.updated, false);
    assert.equal(result.details.effectiveStatus, "planned");
    assert.deepEqual(await readFile(featurePath), beforeBytes, "status rejection leaves feature JSON byte-identical");
    const after = (await st.loadFeatures()).features.find((feature) => feature.id === featureA.id);
    assert.equal(after?.updatedAt, before?.updatedAt, "status rejection does not touch updatedAt");
  });

  test("feature_discuss updates governance fields, persists descriptionRef, and marks context ready", async () => {
    const { root, st, featureA } = await setup();
    const descriptionRef = `.planner/docs/features/${featureA.id}.md`;
    const result = await tools.get("feature_discuss").execute("id", {
      featureId: "F001",
      description: "src/feature.ts:10 current scope and goals for the Auth API feature.",
      descriptionRef,
      workDone: "Login endpoint scaffolding exists.",
      workRemaining: "Need token rotation and audit logging.",
      dependencies: ["Shared auth middleware", "Billing contract"],
    }, undefined, undefined, makeCtx(root));

    assert.match(toolText(result), /✅ Feature discussed\/updated: F001/);
    assert.match(toolText(result), /Fields saved: description, descriptionRef, workDone, workRemaining, dependencies\./);
    const stored = (await st.loadFeatures()).features.find((feature) => feature.id === featureA.id);
    assert.equal(stored?.description, "src/feature.ts:10 current scope and goals for the Auth API feature.");
    assert.equal(stored?.descriptionRef, descriptionRef);
    assert.equal(stored?.workDone, "Login endpoint scaffolding exists.");
    assert.equal(stored?.workRemaining, "Need token rotation and audit logging.");
    assert.deepEqual(stored?.dependsOn, ["Shared auth middleware", "Billing contract"]);
    assert.equal(stored?.contextReady, true);
    assert.match(stored?.contextReadyReason ?? "", /feature_discuss|feature discuss/i);

    const readBack = await tools.get("feature_get").execute("id", { featureId: "F001", full: true }, undefined, undefined, makeCtx(root));
    assert.match(toolText(readBack), /Description reference:/);
    assert.match(toolText(readBack), new RegExp(featureA.id.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")));
    assert.equal(readBack.details.feature.descriptionRef, descriptionRef);
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
    await tools.get("task_get").execute("id", { taskId: temporaryId, full: true }, undefined, undefined, ctx);
    await tools.get("phase_get").execute("id", { phaseId: "P001", full: true }, undefined, undefined, ctx);
    await tools.get("feature_get").execute("id", { featureId: "F001", full: true }, undefined, undefined, ctx);
    await tools.get("requirement_list").execute("id", {}, undefined, undefined, ctx);
    const started = await tools.get("task_start").execute("id", { taskId: temporaryId }, undefined, undefined, ctx);
    const startedText = toolText(started);
    assert.match(startedText, /Task started/);
    assert.ok(startedText.indexOf("Feature F001") < startedText.indexOf("Phase P001"), "task start briefs feature before phase");
    project = await st.loadProject();
    assert.equal(project.workDeviations.at(-1)?.state, "active");
    assert.match(toolText(await tools.get("task_complete").execute("id", { taskId: temporaryId, description_update: "Temporary deviation task completed and verified." }, undefined, undefined, ctx)), /Task completed.*RESUME REQUIRED/s);
    project = await st.loadProject();
    assert.equal(project.workDeviations.at(-1)?.state, "resume-required");
    assert.match(toolText(await tools.get("task_recommend").execute("id", {}, undefined, undefined, ctx)), /Recommended \(resume\): P001\(F001\)\/T001/);
  });

  test("project_context_migrate previews without mutation and applies only when explicitly confirmed", async () => {
    const { root, st } = await setup();
    const ctx = makeCtx(root);
    await st.updateProject((project) => ({
      ...project,
      projectGuidelines: { ...project.projectGuidelines, content: "Run focused tests." },
      globalRules: ["Run focused tests.", "Keep source text in English."],
      workflowRules: { beforePhaseStart: ["Discuss the phase first."], beforeTaskStart: [], afterPhaseComplete: [] },
      decisions: ["Use TypeScript for planner packages."],
    }));

    const preview = await tools.get("project_context_migrate").execute("id", { apply: false }, undefined, undefined, ctx);
    assert.match(toolText(preview), /preview .*no changes applied/i);
    assert.equal(preview.details.applied, false);
    assert.equal(preview.details.preview.guidelineAdditions.length, 2);
    assert.equal((await st.loadProject()).globalRules.length, 2, "preview must not mutate legacy fields");

    const applied = await tools.get("project_context_migrate").execute("id", { apply: true }, undefined, undefined, ctx);
    assert.match(toolText(applied), /migration applied and verified/i);
    assert.equal(applied.details.applied, true);
    const project = await st.loadProject();
    assert.deepEqual(project.globalRules, []);
    assert.deepEqual(project.decisions, []);
    assert.match(project.projectGuidelines.content, /Keep source text in English/);
    assert.equal(project.acceptedDecisions.some((decision) => decision.decision === "Use TypeScript for planner packages."), true);
  });

  test("requirement mutations cover macro-task create, update, reorder, and system metadata", async () => {
    const { root } = await setup();
    const ctx = makeCtx(root);
    const created = await tools.get("requirement_create").execute("id", {
      title: "Credential flow", description: "Secure access.", linkedPhaseIds: ["P001"],
      macroTasks: [{ title: "Validate credentials", description: "Check input.", status: "planned" }],
    }, undefined, undefined, ctx);
    assert.equal(created.details.macroTasks[0].id, "MT-001");
    const updated = await tools.get("requirement_update").execute("id", {
      requirementId: created.details.id,
      macroTasks: [
        { id: "MT-001", title: "Validate credentials", description: "Check input.", status: "done" },
        { title: "Record decision", description: "Persist audit.", status: "planned" },
      ],
    }, undefined, undefined, ctx);
    assert.equal(updated.details.macroTasks[0].createdAt, created.details.macroTasks[0].createdAt);
    assert.equal(updated.details.macroTasks[1].id, "MT-002");
  });
});

test("Idea tools keep promotion confirmation-safe and return composite refs", async () => {
  const { root, st, featureA } = await setup();
  const created = await tools.get("idea_create").execute("id", { title: "Idea transport", description: "Discuss this idea before promotion." }, undefined, undefined, makeCtx(root));
  assert.equal(created.details.created, true);
  assert.match(toolText(created), /I001/);

  const before = await st.loadIdeas();
  const denied = await tools.get("idea_promotion_finalize").execute("id", {
    idea: "I001", targetType: "feature", targetRef: "F001", discussionCompleted: false, confirmed: false,
  }, undefined, undefined, makeCtx(root));
  assert.equal(denied.details.promoted, false);
  assert.deepEqual(await st.loadIdeas(), before, "denied promotion is a no-op");

  const begun = await tools.get("idea_promotion_begin").execute("id", { idea: "I001", targetType: "phase" }, undefined, undefined, makeCtx(root));
  assert.equal(begun.details.persisted, false);
  assert.match(begun.details.grillMeSkill, /Ask the questions one at a time/);
  assert.match(begun.details.recommendation, /Recommended parent feature: F001/);

  const promoted = await tools.get("idea_promotion_finalize").execute("id", {
    idea: "I001", targetType: "feature", targetRef: "F001", discussionCompleted: true, confirmed: true,
  }, undefined, undefined, makeCtx(root));
  assert.equal(promoted.details.promoted, true);
  assert.equal(promoted.details.targetRef, "F001");
  assert.equal((await st.loadIdeas()).ideas[0].promotion.targetId, featureA.id);

  const phaseIdea = await tools.get("idea_create").execute("id", { title: "Phase idea" }, undefined, undefined, makeCtx(root));
  const taskIdea = await tools.get("idea_create").execute("id", { title: "Task idea" }, undefined, undefined, makeCtx(root));
  assert.equal(phaseIdea.details.created, true);
  assert.equal(taskIdea.details.created, true);
  const phasePromotion = await tools.get("idea_promotion_finalize").execute("id", { idea: "I002", targetType: "phase", targetRef: "P001(F001)", discussionCompleted: true, confirmed: true }, undefined, undefined, makeCtx(root));
  const taskPromotion = await tools.get("idea_promotion_finalize").execute("id", { idea: "I003", targetType: "task", targetRef: "P001(F001)/T001", discussionCompleted: true, confirmed: true }, undefined, undefined, makeCtx(root));
  assert.equal(phasePromotion.details.targetRef, "P001(F001)");
  assert.equal(taskPromotion.details.targetRef, "P001(F001)/T001");

  const listed = await tools.get("idea_list").execute("id", {}, undefined, undefined, makeCtx(root));
  assert.match(toolText(listed), /I001.*F001/);
  assert.match(toolText(listed), /I002.*P001\(F001\)/);
  assert.match(toolText(listed), /I003.*P001\(F001\)\/T001/);
});
