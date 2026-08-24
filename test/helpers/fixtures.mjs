/**
 * Isolated temporary planner fixtures (F015/P052 — test foundation).
 *
 * Every fixture owns a fresh `mkdtemp` directory and never touches a user
 * repository. Cleanup is tracked in a registry and drained with `cleanupFixtures()`
 * (called by `after()` hooks in the test files that import this module).
 *
 * Seeds (referenced by the scenario matrix):
 *   empty            — freshly initialized .planner/ only
 *   minimal          — 1 feature + 1 phase + 1 task + 1 requirement (linked)
 *   full             — 3 features × (phases with mixed-status tasks) + requirements + handoffs
 *   terminal         — a feature whose phase has all-done tasks + a stale handoff (auto-archive on done)
 *   resume-needed    — in-progress task + handoff + resume focus pointing at the phase
 *   legacy-single-file — pre-migration features.json single-file layout (migrateLegacy)
 *
 * Persistence is REAL PlanStore on a REAL filesystem — no mocks. Deterministic
 * where possible: fixed base timestamp, explicit numbers/shortIds.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PlanStore,
  createFeatureId,
  createPhaseId,
  createTaskId,
  createRequirementId,
  createShortId,
  normalizeSlug,
  FeatureSchema,
  PhaseSchema,
  addChecklistItem,
} from "../../packages/plan-core/dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Fixed base timestamp so seeded plans are byte-stable across runs. */
export const BASE_TIME = "2026-01-01T00:00:00.000Z";

/** Registry of every temp root created in this process; drained on cleanup. */
const registry = new Set();
export function trackedRoots() {
  return [...registry];
}
export async function cleanupFixtures() {
  const roots = [...registry];
  registry.clear();
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }).catch(() => {})));
}

/** Create a temp root for one fixture and register it for cleanup. */
export async function createTempRoot(prefix = "agent-plan-fixture-") {
  const root = await mkdtemp(join(tmpdir(), prefix));
  registry.add(root);
  return root;
}

/** Absolute path to a package's dist entry (repo-root relative). */
export function packageDist(pkg, entry = "index.js") {
  return join(here, "..", "..", "packages", pkg, "dist", entry);
}

/** Map fixture name → seed factory (kept private; exported via seedFixture). */
const SEEDERS = {
  async empty(store) {
    // nothing beyond init()
  },

  async minimal(store) {
    const now = BASE_TIME;
    const featureId = createFeatureId();
    const phaseId = createPhaseId();
    const taskId = createTaskId();
    const feature = FeatureSchema.parse({
      id: featureId,
      number: 1,
      shortId: "AAAAA",
      priority: 10,
      name: "Auth API",
      description: "Authentication API for the fixture.",
      discussedAt: "",
      contextReady: false,
      contextReadyReason: "",
      phaseIds: [phaseId],
      createdAt: now,
      updatedAt: now,
    });
    await store.saveFeature(feature);

    const task = {
      id: taskId,
      phaseId,
      number: 1,
      shortId: "BBBBB",
      priority: 10,
      shortName: normalizeSlug("Implement login"),
      title: "Implement login",
      status: "planned",
      description: "Fixture task: implement login endpoint.",
      notes: "",
      statusLog: [],
      decisions: [],
      acceptedDecisions: [],
      checklist: [addChecklistItem([], taskId, "Add route")],
      subtasks: [],
      dependsOn: [],
      startedAt: "",
      completedAt: "",
      createdAt: now,
      updatedAt: now,
    };
    const phase = PhaseSchema.parse({
      id: phaseId,
      featureId,
      number: 1,
      shortId: "CCCCC",
      priority: 10,
      slug: normalizeSlug("Auth API phase"),
      title: "Auth API phase",
      summary: "Build the auth API.",
      description: "Fixture phase with one planned task.",
      tasks: [task],
      taskIds: [taskId],
      createdAt: now,
      updatedAt: now,
      handoff: "",
    });
    await store.savePhase(phase);

    await store.updateRequirements((doc) => {
      doc.requirements.push({
        id: createRequirementId(),
        title: "Users can authenticate",
        description: "Fixture requirement linked to the phase.",
        status: "planned",
        macroTasks: [],
        linkedPhaseIds: [phaseId],
        createdAt: now,
        updatedAt: now,
      });
      return doc;
    });
  },

  async full(store) {
    const now = BASE_TIME;
    const ids = {
      f: [createFeatureId(), createFeatureId(), createFeatureId()],
      p: [createPhaseId(), createPhaseId(), createPhaseId(), createPhaseId(), createPhaseId()],
      t: Array.from({ length: 8 }, () => createTaskId()),
    };
    const shortId = (seed) => createShortId(new Set(), seed);
    const featureNames = ["Auth", "Payments", "Reporting"];
    for (let i = 0; i < 3; i++) {
      const featureId = ids.f[i];
      await store.saveFeature(FeatureSchema.parse({
        id: featureId,
        number: i + 1,
        shortId: shortId(`feature-${i}`),
        priority: (i + 1) * 10,
        name: featureNames[i],
        description: `Feature ${featureNames[i]} (fixture).`,
        phaseIds: [],
        createdAt: now,
        updatedAt: now,
      }));
    }

    // Phases: f0 → p0 (2 tasks), p1 (1 task); f1 → p2 (2 tasks), p3 (2 tasks); f2 → p4 (1 task)
    const phasePlan = [
      { id: ids.p[0], featureId: ids.f[0], num: 1, title: "Auth — design", taskNums: [0, 1], statuses: ["done", "in-progress"] },
      { id: ids.p[1], featureId: ids.f[0], num: 2, title: "Auth — implement", taskNums: [2], statuses: ["planned"] },
      { id: ids.p[2], featureId: ids.f[1], num: 1, title: "Payments — design", taskNums: [3, 4], statuses: ["planned", "blocked"] },
      { id: ids.p[3], featureId: ids.f[1], num: 2, title: "Payments — implement", taskNums: [5], statuses: ["planned"] },
      { id: ids.p[4], featureId: ids.f[2], num: 1, title: "Reporting — design", taskNums: [7], statuses: ["planned"] },
    ];
    let taskNum = 1;
    for (const pp of phasePlan) {
      const tasks = pp.taskNums.map((tIdx, k) => {
        const taskId = ids.t[tIdx];
        const status = pp.statuses[k];
        return {
          id: taskId,
          phaseId: pp.id,
          number: taskNum++,
          shortId: shortId(`task-${tIdx}`),
          priority: (k + 1) * 10,
          shortName: normalizeSlug(`Task ${tIdx}`),
          title: `Task ${tIdx}`,
          status,
          description: `Fixture task ${tIdx} in ${pp.title}.`,
          notes: "",
          statusLog: [],
          decisions: [],
          acceptedDecisions: [],
          checklist: [],
          subtasks: [],
          dependsOn: [],
          startedAt: status === "in-progress" || status === "done" ? now : "",
          completedAt: status === "done" ? now : "",
          createdAt: now,
          updatedAt: now,
        };
      });
      await store.savePhase(PhaseSchema.parse({
        id: pp.id,
        featureId: pp.featureId,
        number: pp.num,
        shortId: shortId(`phase-${pp.featureId === ids.f[0] ? 0 : pp.featureId === ids.f[1] ? 1 : 2}-${pp.num}`),
        priority: pp.num * 10,
        slug: normalizeSlug(pp.title),
        title: pp.title,
        summary: "",
        description: `Fixture phase ${pp.title}.`,
        tasks,
        taskIds: tasks.map((t) => t.id),
        createdAt: now,
        updatedAt: now,
        handoff: "",
      }));
      await store.updateFeatures((doc) => {
        const feature = doc.features.find((f) => f.id === pp.featureId);
        if (feature) feature.phaseIds.push(pp.id);
        return doc;
      });
    }

    // Requirements linked to different phases.
    await store.updateRequirements((doc) => {
      doc.requirements.push(
        {
          id: createRequirementId(),
          title: "Users authenticate with email",
          description: "Requirement linked to Auth design.",
          status: "in-progress",
          macroTasks: [],
          linkedPhaseIds: [ids.p[0]],
          createdAt: now,
          updatedAt: now,
        },
        {
          id: createRequirementId(),
          title: "Payments are idempotent",
          description: "Requirement linked to Payments implement.",
          status: "planned",
          macroTasks: [],
          linkedPhaseIds: [ids.p[3]],
          createdAt: now,
          updatedAt: now,
        },
      );
      return doc;
    });

    // One pending handoff on the Reporting phase.
    await store.setPhaseHandoff(ids.p[4], "# Reporting design handoff\n\nHandoff content for the reporting phase.");
    // One archived handoff: write while planned, then complete → phase done → auto-archive.
    await store.setPhaseHandoff(ids.p[3], "# Payments implement handoff\n\nNow archived.");
    await store.updatePhase(ids.p[3], (p) => {
      for (const t of p.tasks) { t.status = "done"; t.startedAt = now; t.completedAt = now; }
      return p;
    });
    await store.syncTaskStatusRollup(ids.p[3]); // phase is done → auto-archives
  },

  async terminal(store) {
    const now = BASE_TIME;
    const featureId = createFeatureId();
    const phaseId = createPhaseId();
    const taskId = createTaskId();
    await store.saveFeature(FeatureSchema.parse({
      id: featureId, number: 1, shortId: "AAAAA", priority: 10,
      name: "Terminal feature", description: "Feature with a completed phase.",
      phaseIds: [phaseId], createdAt: now, updatedAt: now,
    }));
    const task = {
      id: taskId, phaseId, number: 1, shortId: "BBBBB", priority: 10,
      shortName: normalizeSlug("Done task"), title: "Done task", status: "done",
      description: "Completed fixture task.", notes: "", statusLog: [],
      decisions: [], acceptedDecisions: [], checklist: [], subtasks: [],
      dependsOn: [], startedAt: now, completedAt: now, createdAt: now, updatedAt: now,
    };
    await store.savePhase(PhaseSchema.parse({
      id: phaseId, featureId, number: 1, shortId: "CCCCC", priority: 10,
      slug: normalizeSlug("Terminal phase"), title: "Terminal phase", summary: "",
      description: "Phase whose only task is done.", tasks: [task], taskIds: [taskId],
      createdAt: now, updatedAt: now, handoff: "# Stale terminal handoff\n\nShould be auto-archived.",
    }));
  },

  async "resume-needed"(store) {
    await SEEDERS.minimal(store);
    const phases = await store.loadAllPhases();
    const phase = phases[0];
    const task = phase.tasks[0];
    await store.updatePhase(phase.id, (p) => {
      const t = p.tasks.find((x) => x.id === task.id);
      if (t) { t.status = "in-progress"; t.startedAt = BASE_TIME; }
      return p;
    });
    await store.setPhaseHandoff(phase.id, "# Resume handoff\n\nResume this phase.");
    await store.refreshResume("Resume fixture notes", "Summary: resume the auth phase.");
  },

  /** Legacy single-file features.json layout (pre-migration). */
  async "legacy-single-file"(store) {
    const now = BASE_TIME;
    const featuresRoot = join(store.root, "features");
    const { rm: rmFs } = await import("node:fs/promises");
    await rmFs(featuresRoot, { recursive: true, force: true }).catch(() => {});
    const legacy = {
      features: [
        FeatureSchema.parse({
          id: createFeatureId(), number: 1, shortId: "AAAAA", priority: 10,
          name: "Legacy feature", description: "Stored in a single features.json.",
          phaseIds: [], createdAt: now, updatedAt: now,
        }),
      ],
    };
    await writeFile(join(store.root, "features.json"), JSON.stringify(legacy, null, 2), "utf-8");
  },
};

/**
 * Create a fresh isolated planner fixture.
 * @param {{ name?: string, seed?: keyof typeof SEEDERS, opts?: object }} options
 * @returns {Promise<{ root: string, planRoot: string, store: PlanStore }>}
 */
export async function createPlannerFixture({ name = "fixture", seed = "minimal", opts = {} } = {}) {
  const root = await createTempRoot(`agent-plan-${name.replace(/[^a-z0-9-]/gi, "-")}-`);
  const planRoot = join(root, ".planner");
  const store = new PlanStore(planRoot);
  store.enableAutoSync(true);
  await store.init(name);
  const seeder = SEEDERS[seed];
  if (!seeder) throw new Error(`Unknown fixture seed: ${seed}`);
  await seeder(store, opts);
  return { root, planRoot, store };
}

/** Run a seed against an EXISTING store (for tests that need a second pass). */
export async function seedFixture(store, seed, opts = {}) {
  const seeder = SEEDERS[seed];
  if (!seeder) throw new Error(`Unknown fixture seed: ${seed}`);
  await seeder(store, opts);
}

/** Deterministic snapshot of a plan's persisted JSON (for persistence assertions). */
export async function readPlanSnapshot(planRoot) {
  const { readFile, readdir } = await import("node:fs/promises");
  const read = async (p) => {
    try { return JSON.parse(await readFile(join(planRoot, p), "utf-8")); }
    catch { return null; }
  };
  const phases = [];
  try {
    const files = await readdir(join(planRoot, "phases"));
    for (const file of files.filter((f) => f.endsWith(".json"))) {
      phases.push(JSON.parse(await readFile(join(planRoot, "phases", file), "utf-8")));
    }
  } catch {}
  const features = [];
  try {
    const files = await readdir(join(planRoot, "features"));
    for (const file of files.filter((f) => f.endsWith(".json"))) {
      features.push(JSON.parse(await readFile(join(planRoot, "features", file), "utf-8")));
    }
  } catch {}
  const handoffArchive = [];
  try {
    const files = await readdir(join(planRoot, ".local", "handoff-archive"));
    for (const file of files) {
      const fullPath = join(planRoot, ".local", "handoff-archive", file);
      if (file.endsWith(".json")) {
        handoffArchive.push(JSON.parse(await readFile(fullPath, "utf-8")));
        continue;
      }
      if (file.endsWith(".md")) {
        const content = await readFile(fullPath, "utf-8");
        handoffArchive.push({ file, content, firstLine: content.split(/\r?\n/, 1)[0] ?? "" });
      }
    }
  } catch {}
  return {
    manifest: await read("manifest.json"),
    project: await read("project.json"),
    requirements: await read("requirements.json"),
    legacyFeatures: await read("features.json"),
    resume: await read(join(".local", "resume.json")),
    activity: await read(join(".local", "activity.json")),
    features: features.sort((a, b) => a.number - b.number),
    phases: phases.sort((a, b) => a.number - b.number),
    handoffArchive,
  };
}

/** Path helpers for a fixture root. */
export function fixturePaths(planRoot) {
  return {
    planRoot,
    manifest: join(planRoot, "manifest.json"),
    project: join(planRoot, "project.json"),
    requirements: join(planRoot, "requirements.json"),
    featuresDir: join(planRoot, "features"),
    phasesDir: join(planRoot, "phases"),
    local: join(planRoot, ".local"),
    handoffArchive: join(planRoot, ".local", "handoff-archive"),
    generated: join(planRoot, ".local", "generated"),
    resume: join(planRoot, ".local", "resume.json"),
    activity: join(planRoot, ".local", "activity.json"),
    gitignore: join(planRoot, ".gitignore"),
  };
}
