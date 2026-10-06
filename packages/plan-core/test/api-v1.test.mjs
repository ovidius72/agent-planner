/**
 * API v1 contract mappers: explicit fields, human refs everywhere, and a
 * model/entity index that other adapters (HTTP routes, change events) share.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  API_V1_VERSION,
  ProjectSchema,
  FeatureSchema,
  PhaseSchema,
  IdeaSchema,
  apiV1Envelope,
  apiV1Error,
  buildApiV1Model,
  listApiV1Entities,
} from "../dist/index.js";

const now = "2026-09-30T08:00:00.000Z";
const decision = (id) => ({ id, title: `Decision ${id}`, decision: "d", rationale: "r", implementationNotes: "n", acceptedAt: now });
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function fixture(overrides = {}) {
  const project = ProjectSchema.parse({
    name: "Demo", workflowRules: {}, goal: "Ship", description: "A demo", technologies: ["TypeScript"],
    projectGuidelines: { content: "Be tidy", updatedAt: now, sessionInfo: [{ sessionId: "secret", createdAt: now }] },
    acceptedDecisions: [decision("PD1")],
  });
  const feature = { ...FeatureSchema.parse({
    id: uuid(1), number: 1, shortId: "AAAAA", name: "Feature", description: "F", createdAt: now, updatedAt: now,
    phaseIds: [uuid(2)], acceptedDecisions: [decision("D1")],
  }), status: "in-progress" };
  const phase = { ...PhaseSchema.parse({
    id: uuid(2), number: 2, featureId: feature.id, slug: "phase", title: "Phase", summary: "S", createdAt: now, updatedAt: now,
    handoff: "# Resume here", handoffUpdatedAt: now, acceptedDecisions: [decision("D2")],
    tasks: [
      { id: uuid(3), phaseId: uuid(2), number: 5, shortName: "first", title: "First", status: "done", createdAt: now, updatedAt: now,
        checklist: ["one", { id: "c2", number: 2, title: "two", checked: true }] },
      { id: uuid(4), phaseId: uuid(2), number: 6, shortName: "second", title: "Second", status: "planned", createdAt: now, updatedAt: now,
        dependsOn: [uuid(3)], acceptedDecisions: [decision("D3")] },
    ],
  }), status: "in-progress", ...overrides.phase };
  const idea = IdeaSchema.parse({ id: uuid(9), number: 4, shortId: "BBBBB", title: "Idea", createdAt: now, updatedAt: now });
  return { project, features: [feature], phases: [phase], ideas: [idea] };
}

test("envelope and error carry the api version", () => {
  assert.deepEqual(apiV1Envelope({ a: 1 }), { apiVersion: API_V1_VERSION, data: { a: 1 } });
  assert.deepEqual(apiV1Error("NOT_FOUND", "no"), { apiVersion: "1", error: { code: "NOT_FOUND", message: "no" } });
});

test("project view exposes guidelines text but never read-tracking session data", () => {
  const { project } = buildApiV1Model(fixture());
  assert.equal(project.guidelines, "Be tidy");
  assert.equal(project.goal, "Ship");
  assert.deepEqual(Object.keys(project).sort(), [
    "chatLanguage", "contentLanguage", "description", "goal", "guidelines", "guidelinesUpdatedAt",
    "name", "outOfScope", "scope", "technologies", "tools",
  ]);
  assert.equal(JSON.stringify(project).includes("secret"), false);
});

test("features, phases and tasks use composite refs and resolve dependencies to refs", () => {
  const model = buildApiV1Model(fixture());
  assert.equal(model.features[0].ref, "F001");
  assert.deepEqual(model.features[0].phaseRefs, ["P002(F001)"]);
  assert.equal(model.phases[0].ref, "P002(F001)");
  assert.equal(model.phases[0].featureRef, "F001");
  assert.deepEqual(model.phases[0].taskRefs, ["P002(F001)/T005", "P002(F001)/T006"]);
  const [first, second] = model.tasks;
  assert.equal(first.ref, "P002(F001)/T005");
  assert.equal(first.phaseRef, "P002(F001)");
  assert.equal(first.featureRef, "F001");
  assert.deepEqual(second.dependsOn, ["P002(F001)/T005"]);
});

test("checklist items are objects with number and checked flag", () => {
  const { tasks } = buildApiV1Model(fixture());
  assert.deepEqual(tasks[0].checklist.map((item) => [item.number, item.title, item.checked]), [[1, "one", false], [2, "two", true]]);
});

test("an unresolvable dependency keeps its stored id instead of disappearing", () => {
  const source = fixture();
  source.phases[0].tasks[1].dependsOn = ["ghost-id"];
  assert.deepEqual(buildApiV1Model(source).tasks[1].dependsOn, ["ghost-id"]);
});

test("a phase without a feature has a bare ref and null featureRef", () => {
  const source = fixture();
  delete source.phases[0].featureId;
  const model = buildApiV1Model(source);
  assert.equal(model.phases[0].ref, "P002");
  assert.equal(model.phases[0].featureRef, null);
  assert.equal(model.tasks[0].featureRef, null);
});

test("decisions carry their owner and a ref that stays unique across owners", () => {
  const { decisions } = buildApiV1Model(fixture());
  assert.deepEqual(decisions.map((d) => [d.ref, d.owner.kind, d.owner.ref]), [
    ["project#PD1", "project", null],
    ["F001#D1", "feature", "F001"],
    ["P002(F001)#D2", "phase", "P002(F001)"],
    ["P002(F001)/T006#D3", "task", "P002(F001)/T006"],
  ]);
});

test("handoff appears only while the phase is open", () => {
  const open = buildApiV1Model(fixture());
  assert.equal(open.handoffs.length, 1);
  assert.equal(open.handoffs[0].phaseRef, "P002(F001)");
  assert.equal(open.handoffs[0].resumeReady, false);
  assert.equal(open.phases[0].hasHandoff, true);
  const done = buildApiV1Model(fixture({ phase: { status: "done" } }));
  assert.equal(done.handoffs.length, 0);
  assert.equal(done.phases[0].hasHandoff, false);
});

test("idea view has its own ref sequence and no promotion by default", () => {
  const { ideas } = buildApiV1Model(fixture());
  assert.equal(ideas[0].ref, "I004");
  assert.equal(ideas[0].promotion, null);
});

test("entity index lists every kind once with parents for change detection", () => {
  const entries = listApiV1Entities(buildApiV1Model(fixture()));
  const kinds = entries.map((entry) => entry.kind);
  assert.deepEqual([...new Set(kinds)].sort(), ["decision", "feature", "handoff", "idea", "phase", "project", "task"]);
  assert.equal(new Set(entries.map((entry) => `${entry.kind}:${entry.key}`)).size, entries.length);
  const task = entries.find((entry) => entry.kind === "task" && entry.ref === "P002(F001)/T006");
  assert.deepEqual(task.parents, { featureRef: "F001", phaseRef: "P002(F001)" });
});
