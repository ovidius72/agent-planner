/**
 * API v1 contract pin. Builds a planner that has one of every entity, asks
 * every route for its reply, and compares the SHAPE of each reply (key names
 * and value types, never ids or timestamps) with the committed file
 * test/fixtures/api-v1-shapes.json.
 *
 * If this test fails, a promised field was removed, renamed or changed type,
 * or a field was added. Adding a field is allowed: regenerate the file with
 *   UPDATE_API_V1_SHAPES=1 node --test test/api-v1-contract.test.mjs
 * and review the diff. Removing or renaming a field, or changing its type or
 * meaning, breaks outside programs: bump API_V1_VERSION (plan-core/src/api-v1.ts)
 * and document the change in docs/api-v1.md instead of editing this file.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FeatureSchema, PhaseSchema, PlanStore, createFeatureId, createPhaseId, createTaskId } from "../../plan-core/dist/index.js";
import { serve } from "../dist/index.js";
import { diffSnapshots, snapshotOf } from "../dist/entity-events.js";
import { rm } from "node:fs/promises";

const shapesPath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "api-v1-shapes.json");
const cleanup = [];

after(async () => {
  await Promise.all(cleanup.map((fn) => fn()));
});

// ── shape of a value: key names and types only ─────────────────────────────

function typeName(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Merge two shapes of the same position (for example two list items). */
function merge(a, b) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (typeof a === "string" && typeof b === "string") {
    return [...new Set([...a.split("|"), ...b.split("|")])].sort().join("|");
  }
  const objectA = a !== null && typeof a === "object" && !Array.isArray(a);
  const objectB = b !== null && typeof b === "object" && !Array.isArray(b);
  if (objectA && objectB) {
    const out = {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) out[key] = merge(a[key], b[key]);
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) return [merge(a[0], b[0])].filter((x) => x !== undefined);
  // A nullable object: "null" next to an object.
  const nullSide = typeof a === "string" ? a : b;
  const objectSide = typeof a === "string" ? b : a;
  if (nullSide === "null") return { $nullable: objectSide };
  if (a?.$nullable && objectB) return { $nullable: merge(a.$nullable, b) };
  if (b?.$nullable && objectA) return { $nullable: merge(b.$nullable, a) };
  throw new Error(`Cannot merge shapes ${JSON.stringify(a)} and ${JSON.stringify(b)}`);
}

function shapeOf(value) {
  const type = typeName(value);
  if (type === "array") return value.map(shapeOf).reduce(merge, undefined) === undefined ? [] : [value.map(shapeOf).reduce(merge)];
  if (type === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, shapeOf(value[key])]));
  return type;
}

function emptyArrayPaths(shape, path = "") {
  if (Array.isArray(shape)) return shape.length === 0 ? [path] : emptyArrayPaths(shape[0], `${path}[]`);
  if (shape && typeof shape === "object") return Object.entries(shape).flatMap(([key, child]) => emptyArrayPaths(child, `${path}.${key}`));
  return [];
}

// ── a planner with one of every entity ─────────────────────────────────────

const now = "2026-09-30T08:00:00.000Z";
const decision = (id) => ({ id, title: `Decision ${id}`, decision: "d", rationale: "r", implementationNotes: "n", acceptedAt: now });

async function buildServer() {
  const root = await mkdtemp(join(tmpdir(), "api-v1-contract-"));
  const store = new PlanStore(join(root, ".planner"));
  await store.init("Contract");
  await store.updateProject((project) => ({
    ...project,
    description: "d", goal: "g", scope: ["s"], outOfScope: ["o"], technologies: ["t"], tools: ["x"],
    contentLanguage: "en", chatLanguage: "en",
    projectGuidelines: { ...project.projectGuidelines, content: "guidelines" },
    acceptedDecisions: [decision("PD1")],
  }));
  const featureId = createFeatureId();
  const secondFeatureId = createFeatureId();
  const linkedPhaseId = createPhaseId();
  const loosePhaseId = createPhaseId();
  await store.saveFeature(FeatureSchema.parse({
    id: featureId, number: 1, shortId: "AAAAA", name: "Feature", description: "f", createdAt: now, updatedAt: now,
    phaseIds: [linkedPhaseId], dependsOn: [secondFeatureId], acceptedDecisions: [decision("FD1")],
  }));
  await store.saveFeature(FeatureSchema.parse({
    id: secondFeatureId, number: 2, shortId: "EEEEE", name: "Second", createdAt: now, updatedAt: now,
  }));
  const taskA = createTaskId();
  const taskB = createTaskId();
  await store.savePhase(PhaseSchema.parse({
    id: linkedPhaseId, number: 1, featureId, shortId: "BBBBB", slug: "linked", title: "Linked", summary: "s", description: "d",
    goals: ["g"], dependsOn: [loosePhaseId], handoff: "# Resume", handoffUpdatedAt: now, acceptedDecisions: [decision("PH1")], createdAt: now, updatedAt: now,
    tasks: [
      { id: taskA, phaseId: linkedPhaseId, number: 1, shortId: "CCCCC", shortName: "a", title: "A", description: "d", status: "planned",
        checklist: [{ id: "c1", number: 1, title: "one", checked: false }], acceptedDecisions: [decision("TD1")], createdAt: now, updatedAt: now },
      { id: taskB, phaseId: linkedPhaseId, number: 2, shortId: "DDDDD", shortName: "b", title: "B", description: "d", status: "blocked",
        dependsOn: [taskA], createdAt: now, updatedAt: now,
        checklist: [{ id: "c2", number: 1, title: "two", checked: true }],
        pauseSnapshot: { id: "p1", reason: "r", whatWasBeingDone: "w", resumeLocation: "l", howToResume: "h", pausedAt: now } },
    ],
  }));
  await store.savePhase(PhaseSchema.parse({
    id: loosePhaseId, number: 2, slug: "loose", title: "Loose", createdAt: now, updatedAt: now,
    tasks: [{ id: createTaskId(), phaseId: loosePhaseId, number: 3, shortName: "c", title: "C", status: "planned", createdAt: now, updatedAt: now }],
  }));
  await store.createIdea({ title: "Idea", description: "d" });
  const handle = await serve({ planRoot: join(root, ".planner"), port: 0, staticDir: "", quiet: true });
  cleanup.push(() => handle.close(), () => rm(root, { recursive: true, force: true }));
  return handle;
}

async function call(handle, path) {
  const response = await fetch(`${handle.url}${path}`);
  return { status: response.status, body: await response.json() };
}

test("every API v1 reply and the entity-changed event keep the pinned shape", async () => {
  const handle = await buildServer();
  const first = async (collection) => (await call(handle, `/api/v1/${collection}`)).body.data;
  const features = await first("features");
  const phases = await first("phases");
  const tasks = await first("tasks");
  const handoffs = await first("handoffs");
  const ideas = await first("ideas");
  const linkedPhase = phases.find((phase) => phase.featureRef !== null);
  const pausedTask = tasks.find((task) => task.pause !== null);

  const actual = {};
  const record = async (name, path) => {
    const { status, body } = await call(handle, path);
    assert.equal(status, 200, `${name} (${path}) must answer 200`);
    actual[name] = shapeOf(body);
  };
  await record("index", "/api/v1");
  await record("project", "/api/v1/project");
  await record("features", "/api/v1/features");
  await record("feature", `/api/v1/features/${features[0].ref}`);
  await record("phases", "/api/v1/phases");
  await record("phase", `/api/v1/phases/${encodeURIComponent(linkedPhase.ref)}`);
  await record("tasks", "/api/v1/tasks");
  await record("task", `/api/v1/tasks/${encodeURIComponent(pausedTask.ref)}`);
  await record("decisions", "/api/v1/decisions");
  await record("handoffs", "/api/v1/handoffs");
  await record("handoff", `/api/v1/handoffs/${encodeURIComponent(handoffs[0].phaseRef)}`);
  await record("ideas", "/api/v1/ideas");
  await record("idea", `/api/v1/ideas/${ideas[0].ref}`);
  actual.error = shapeOf((await call(handle, "/api/v1/tasks/T9999")).body);
  const entry = { kind: "task", key: "k", id: "i", ref: "r", parents: { featureRef: "F001", phaseRef: "P001(F001)" }, view: { v: 1 } };
  actual["entity-changed"] = shapeOf({ type: "entity-changed", data: diffSnapshots(snapshotOf([]), snapshotOf([entry]))[0] });

  const empties = Object.entries(actual).flatMap(([name, shape]) => emptyArrayPaths(shape).map((path) => `${name}${path}`));
  assert.deepEqual(empties, [], "the contract fixture must fill every list so its item shape is pinned");

  if (process.env.UPDATE_API_V1_SHAPES === "1") {
    await writeFile(shapesPath, `${JSON.stringify(actual, null, 2)}\n`);
    return;
  }
  const expected = JSON.parse(await readFile(shapesPath, "utf-8"));
  for (const name of Object.keys(expected)) {
    assert.deepEqual(
      actual[name],
      expected[name],
      `API v1 "${name}" changed shape. If a field was removed, renamed or changed type, bump API_V1_VERSION and document it in docs/api-v1.md. If a field was only added, regenerate with UPDATE_API_V1_SHAPES=1 and review the diff.`,
    );
  }
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), "the set of pinned replies changed");
});
