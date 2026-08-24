import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
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

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "mcp-ref-validation-"));
  dirs.push(root);
  const plannerRoot = join(root, ".planner");
  const st = new PlanStore(plannerRoot);
  st.enableAutoSync(true);
  await st.init("mcp ref validation");
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

  return { root, plannerRoot, st, featureA, featureB, phase };
}

async function startClient(plannerRoot) {
  const serverPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const client = new Client({ name: "ref-validation-test", version: "0.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: dirname(serverPath),
    env: { ...process.env, AGENT_PLAN_ROOT: plannerRoot },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on?.("data", (chunk) => {
    stderr += chunk.toString();
  });
  transport.onerror = (error) => {
    if (stderr) error.message += `\nSTDERR:\n${stderr}`;
  };
  await client.connect(transport);
  return {
    client,
    async close() {
      await transport.close();
    },
  };
}

describe("plan-mcp strict ref validation", () => {
  test("planner-phase-add resolves human feature ref F00x to the internal feature id", async () => {
    const { plannerRoot, st, featureA } = await setup();
    const session = await startClient(plannerRoot);
    try {
      const result = await session.client.callTool({
        name: "planner-phase-add",
        arguments: {
          title: "Linked Phase",
          feature: "F001",
          description: "src/example.ts:10 existing state and desired behavior for this linked phase regression test.",
        },
      });
      assert.match(toolText(result), /✅ Phase created: P\d+\(F001\)/);
      const phases = await st.loadAllPhases();
      const created = phases.find((entry) => entry.title === "Linked Phase");
      assert.ok(created);
      assert.equal(created.featureId, featureA.id);
    } finally {
      await session.close();
    }
  });

  test("planner-phase-add rejects missing feature ref", async () => {
    const { plannerRoot, st } = await setup();
    const before = await st.loadAllPhases();
    const session = await startClient(plannerRoot);
    try {
      const result = await session.client.callTool({
        name: "planner-phase-add",
        arguments: {
          title: "Phase Without Feature",
          description: "src/example.ts:90 this phase should not be created because no parent feature was supplied.",
        },
      });
      const text = toolText(result);
      assert.match(text, /featureId.*required|feature.*required|parent feature.*required|Feature ref.*required|must.*feature/i);
      const after = await st.loadAllPhases();
      assert.equal(after.length, before.length);
      assert.equal(after.find((entry) => entry.title === "Phase Without Feature"), undefined);
    } finally {
      await session.close();
    }
  });

  test("planner-phase-add rejects unresolved feature refs and does not persist a phase", async () => {
    const { plannerRoot, st } = await setup();
    const before = await st.loadAllPhases();
    const session = await startClient(plannerRoot);
    try {
      const result = await session.client.callTool({
        name: "planner-phase-add",
        arguments: {
          title: "Broken Phase",
          feature: "F999",
          description: "src/example.ts:20 this should fail because the parent feature ref does not exist.",
        },
      });
      assert.equal(toolText(result), "Feature not found: F999");
      const after = await st.loadAllPhases();
      assert.equal(after.length, before.length);
      assert.equal(after.find((entry) => entry.title === "Broken Phase"), undefined);
    } finally {
      await session.close();
    }
  });

  test("planner-feature-update rejects ambiguous feature refs and leaves data unchanged", async () => {
    const { plannerRoot, st } = await setup();
    const session = await startClient(plannerRoot);
    try {
      const result = await session.client.callTool({
        name: "planner-feature-update",
        arguments: {
          feature: "Auth",
          name: "Broken rename",
        },
      });
      assert.match(toolText(result), /^Ambiguous feature ref: Auth\./);
      const features = (await st.loadFeatures()).features;
      assert.deepEqual(features.map((feature) => feature.name), ["Auth API", "Auth UI"]);
    } finally {
      await session.close();
    }
  });

  test("planner-feature-delete rejects ambiguous feature refs and does not delete anything", async () => {
    const { plannerRoot, st } = await setup();
    const beforeIds = (await st.loadFeatures()).features.map((feature) => feature.id);
    const session = await startClient(plannerRoot);
    try {
      const result = await session.client.callTool({
        name: "planner-feature-delete",
        arguments: {
          feature: "Auth",
        },
      });
      assert.match(toolText(result), /^Ambiguous feature ref: Auth\./);
      const afterIds = (await st.loadFeatures()).features.map((feature) => feature.id);
      assert.deepEqual(afterIds, beforeIds);
    } finally {
      await session.close();
    }
  });

  test("planner-feature-discuss updates governance fields and marks context ready", async () => {
    const { plannerRoot, st, featureA } = await setup();
    const session = await startClient(plannerRoot);
    try {
      const result = await session.client.callTool({
        name: "planner-feature-discuss",
        arguments: {
          feature: "F001",
          description: "src/feature.ts:10 current scope and goals for the Auth API feature.",
          workDone: "Login endpoint scaffolding exists.",
          workRemaining: "Need token rotation and audit logging.",
          dependencies: ["Shared auth middleware", "Billing contract"],
        },
      });
      assert.match(toolText(result), /✅ Feature discussed\/updated: F001/);
      const stored = (await st.loadFeatures()).features.find((feature) => feature.id === featureA.id);
      assert.equal(stored?.description, "src/feature.ts:10 current scope and goals for the Auth API feature.");
      assert.equal(stored?.workDone, "Login endpoint scaffolding exists.");
      assert.equal(stored?.workRemaining, "Need token rotation and audit logging.");
      assert.deepEqual(stored?.dependsOn, ["Shared auth middleware", "Billing contract"]);
      assert.equal(stored?.contextReady, true);
      assert.match(stored?.contextReadyReason ?? "", /planner-feature-discuss/i);
    } finally {
      await session.close();
    }
  });

  test("planner-cleanup-orphan-phases supports dry-run and confirmed cleanup", async () => {
    const { plannerRoot, st, featureA } = await setup();
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
    await mkdir(join(plannerRoot, "phases"), { recursive: true });
    await writeFile(join(plannerRoot, "phases", orphanPhaseId + ".json"), JSON.stringify(orphanPhase, null, 2));
    await st.updateFeatures((doc) => {
      const target = doc.features.find((entry) => entry.id === featureA.id);
      if (target) target.phaseIds.push(orphanPhase.id);
      return doc;
    });

    const session = await startClient(plannerRoot);
    try {
      const dryRun = await session.client.callTool({
        name: "planner-cleanup-orphan-phases",
        arguments: {},
      });
      assert.match(toolText(dryRun), /Found 1 orphan phase/);
      assert.match(toolText(dryRun), /Rerun with confirm=true/);

      const confirmed = await session.client.callTool({
        name: "planner-cleanup-orphan-phases",
        arguments: { confirm: true },
      });
      assert.match(toolText(confirmed), /Removed 1 orphan phase/);
      const phases = await st.loadAllPhases();
      assert.equal(phases.some((entry) => entry.id === orphanPhase.id), false);
      const feature = (await st.loadFeatures()).features.find((entry) => entry.id === featureA.id);
      assert.equal(feature?.phaseIds.includes(orphanPhase.id), false);
    } finally {
      await session.close();
    }
  });

  test("planner-task-show still resolves globally unique T00x refs after stricter feature validation", async () => {
    const { plannerRoot } = await setup();
    const session = await startClient(plannerRoot);
    try {
      const result = await session.client.callTool({
        name: "planner-task-show",
        arguments: { task: "T001" },
      });
      assert.match(toolText(result), /Seed task — P001\(F001\)\/T001/);
    } finally {
      await session.close();
    }
  });


  test("planner-task-add rejects orphan phase refs and does not allocate a number", async () => {
    const { plannerRoot, st } = await setup();
    const before = await st.loadProject();
    const session = await startClient(plannerRoot);
    try {
      const result = await session.client.callTool({
        name: "planner-task-add",
        arguments: {
          feature: "F001",
          phase: "P999",
          title: "Orphan Task",
          description: "src/example.ts:50 this task should not be created because the parent phase P999 does not exist.",
        },
      });
      assert.equal(toolText(result), "Phase not found: P999");
      const after = await st.loadProject();
      assert.equal(after.nextTaskNumber, before.nextTaskNumber);
      const phases = await st.loadAllPhases();
      assert.equal(phases.flatMap((entry) => entry.tasks).some((task) => task.title === "Orphan Task"), false);
    } finally {
      await session.close();
    }
  });

  test("planner-task-add resolves human phase ref P001 to the internal phase id", async () => {
    const { plannerRoot, st, phase } = await setup();
    const session = await startClient(plannerRoot);
    try {
      const result = await session.client.callTool({
        name: "planner-task-add",
        arguments: {
          feature: "F001",
          phase: "P001",
          title: "Linked Task",
          description: "src/example.ts:60 this task should be created by resolving the human P001 ref to the stored phase UUID.",
        },
      });
      assert.match(toolText(result), /✅ Task created: P001\(F001\)\/T\d+/);
      const stored = await st.loadPhase(phase.id);
      const created = stored.tasks.find((task) => task.title === "Linked Task");
      assert.ok(created);
      assert.equal(created.phaseId, phase.id);
    } finally {
      await session.close();
    }
  });

  test("planner-task-add rejects missing feature ref", async () => {
    const { plannerRoot, st, phase } = await setup();
    const before = await st.loadProject();
    const session = await startClient(plannerRoot);
    try {
      const result = await session.client.callTool({
        name: "planner-task-add",
        arguments: {
          phase: "P001",
          title: "Task Without Feature",
          description: "src/example.ts:61 this task should not be created because no parent feature was supplied.",
        },
      });
      assert.match(toolText(result), /feature is required|feature.*required|must belong to a feature/i);
      const after = await st.loadProject();
      assert.equal(after.nextTaskNumber, before.nextTaskNumber);
      const stored = await st.loadPhase(phase.id);
      assert.equal(stored.tasks.some((task) => task.title === "Task Without Feature"), false);
    } finally {
      await session.close();
    }
  });

  test("planner-task-add rejects feature/phase mismatch (phase belongs to another feature)", async () => {
    const { plannerRoot, st, phase } = await setup();
    const before = await st.loadProject();
    const session = await startClient(plannerRoot);
    try {
      // P001 belongs to F001 (featureA). Passing F002 should be rejected.
      const result = await session.client.callTool({
        name: "planner-task-add",
        arguments: {
          feature: "F002",
          phase: "P001",
          title: "Mismatched Task",
          description: "src/example.ts:62 this task should not be created because P001 does not belong to F002.",
        },
      });
      assert.match(toolText(result), /does not belong to feature|does not belong/i);
      const after = await st.loadProject();
      assert.equal(after.nextTaskNumber, before.nextTaskNumber);
      const stored = await st.loadPhase(phase.id);
      assert.equal(stored.tasks.some((task) => task.title === "Mismatched Task"), false);
    } finally {
      await session.close();
    }
  });

  test("planner-task-add rejects unresolved feature ref and does not allocate a number", async () => {
    const { plannerRoot, st, phase } = await setup();
    const before = await st.loadProject();
    const session = await startClient(plannerRoot);
    try {
      const result = await session.client.callTool({
        name: "planner-task-add",
        arguments: {
          feature: "F999",
          phase: "P001",
          title: "Orphan Feature Task",
          description: "src/example.ts:63 this task should not be created because the parent feature F999 does not exist.",
        },
      });
      assert.equal(toolText(result), "Feature not found: F999");
      const after = await st.loadProject();
      assert.equal(after.nextTaskNumber, before.nextTaskNumber);
      const stored = await st.loadPhase(phase.id);
      assert.equal(stored.tasks.some((task) => task.title === "Orphan Feature Task"), false);
    } finally {
      await session.close();
    }
  });

  test("planner-phase-add rejects orphan feature refs and does not allocate a number", async () => {
    const { plannerRoot, st } = await setup();
    const before = await st.loadProject();
    const session = await startClient(plannerRoot);
    try {
      const result = await session.client.callTool({
        name: "planner-phase-add",
        arguments: {
          title: "Orphan Phase",
          feature: "F999",
          description: "src/example.ts:70 this phase should not be created because the parent feature F999 does not exist.",
        },
      });
      assert.equal(toolText(result), "Feature not found: F999");
      const after = await st.loadProject();
      assert.equal(after.nextPhaseNumber, before.nextPhaseNumber);
      const phases = await st.loadAllPhases();
      assert.equal(phases.some((entry) => entry.title === "Orphan Phase"), false);
    } finally {
      await session.close();
    }
  });


  test("planner-task-add returns a clear error if the phase is deleted after resolution", async () => {
    const { plannerRoot, st, phase } = await setup();
    const before = await st.loadProject();
    const session = await startClient(plannerRoot);
    try {
      // Remove the phase file before the tool attempts the write.
      await rm(join(plannerRoot, "phases", phase.id + ".json"), { force: true });

      const result = await session.client.callTool({
        name: "planner-task-add",
        arguments: {
          feature: "F001",
          phase: "P001",
          title: "Race Task",
          description: "src/example.ts:80 this task must fail because the resolved phase P001 disappears before the write.",
        },
      });
      const text = toolText(result);
      assert.match(text, /no longer exists|Refusing to create child|Phase not found/);
      const after = await st.loadProject();
      assert.equal(after.nextTaskNumber, before.nextTaskNumber);
    } finally {
      await session.close();
    }
  });

  test("planner-task-recommend and planner-task-deviation retain an explicit resume target", async () => {
    const { plannerRoot, st, phase } = await setup();
    const temporaryId = createTaskId();
    const resumeId = phase.tasks[0].id;
    await st.updatePhase(phase.id, (stored) => ({ ...stored, tasks: [...stored.tasks, { ...stored.tasks[0], id: temporaryId, phaseId: phase.id, number: 2, title: "Temporary task", shortName: "temporary-task", priority: 20 }], taskIds: [...stored.taskIds, temporaryId] }));
    const session = await startClient(plannerRoot);
    try {
      const initial = await session.client.callTool({ name: "planner-task-recommend", arguments: {} });
      assert.match(toolText(initial), /Recommended \(priority\): P001\(F001\)\/T002/);
      const recorded = await session.client.callTool({ name: "planner-task-deviation", arguments: { temporary_task: temporaryId, resume_task: resumeId, reason: "Approved urgent work" } });
      assert.match(toolText(recorded), /Approved deviation/);
      assert.equal((await st.loadProject()).workDeviations.at(-1)?.resumeTaskId, resumeId);
      await session.client.callTool({ name: "planner-task-show", arguments: { task: temporaryId, full: true } });
      await session.client.callTool({ name: "planner-phase-show", arguments: { phase: "P001", full: true } });
      await session.client.callTool({ name: "planner-feature-show", arguments: { feature: "F001", full: true } });
      await session.client.callTool({ name: "planner-requirement-list", arguments: {} });
      assert.match(toolText(await session.client.callTool({ name: "planner-task-start", arguments: { task: temporaryId } })), /Task started/);
      assert.equal((await st.loadProject()).workDeviations.at(-1)?.state, "active");
      assert.match(toolText(await session.client.callTool({ name: "planner-task-complete", arguments: { task: temporaryId } })), /Task completed.*RESUME REQUIRED/s);
      assert.equal((await st.loadProject()).workDeviations.at(-1)?.state, "resume-required");
      const resumed = await session.client.callTool({ name: "planner-task-recommend", arguments: {} });
      assert.match(toolText(resumed), /Recommended \(resume\): P001\(F001\)\/T001/);
    } finally {
      await session.close();
    }
  });

  test("planner-task-add uses the global task sequence from repeated MCP writes", async () => {
    const { plannerRoot, st, phase } = await setup();
    const session = await startClient(plannerRoot);
    try {
      for (let index = 0; index < 8; index += 1) {
        await session.client.callTool({
          name: "planner-task-add",
          arguments: {
            feature: "F001",
            phase: "P001",
            title: `Parallel Task ${index + 1}`,
            description: `src/example.ts:${100 + index} create a task through MCP and assert the global numbering stays monotonic across writes.`,
          },
        });
      }

      const stored = await st.loadPhase(phase.id);
      const created = stored.tasks.filter((task) => task.title.startsWith("Parallel Task "));
      const numbers = created.map((task) => task.number).sort((a, b) => a - b);
      assert.equal(created.length, 8);
      assert.equal(new Set(numbers).size, 8);
      assert.deepEqual(numbers, [2, 3, 4, 5, 6, 7, 8, 9]);
    } finally {
      await session.close();
    }
  });
});
