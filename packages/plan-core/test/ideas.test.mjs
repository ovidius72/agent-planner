import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FeatureSchema,
  PhaseSchema,
  PlanStore,
  createFeatureId,
  createPhaseId,
  createTaskId,
  findIdeaByRef,
  formatIdeaRef,
  recommendNextTask,
} from "../dist/index.js";

const roots = [];
after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-plan-ideas-"));
  roots.push(projectRoot);
  const planRoot = join(projectRoot, ".planner");
  const store = new PlanStore(planRoot);
  await store.init("Ideas test");
  return { store, planRoot };
}

async function addFeaturePhaseTask(store) {
  const now = "2026-08-30T10:00:00.000Z";
  const feature = FeatureSchema.parse({
    id: createFeatureId(), number: 1, shortId: "FEA22", priority: 0,
    name: "Target feature", createdAt: now, updatedAt: now,
  });
  await store.saveFeature({ ...feature, status: "planned" });
  const phase = PhaseSchema.parse({
    id: createPhaseId(), number: 1, shortId: "PHA22", priority: 0,
    featureId: feature.id, slug: "target-phase", title: "Target phase",
    status: "planned", createdAt: now, updatedAt: now,
  });
  const task = {
    id: createTaskId(), number: 1, shortId: "TSK22", priority: 0,
    phaseId: phase.id, shortName: "target-task", title: "Target task",
    status: "planned", createdAt: now, updatedAt: now,
  };
  await store.savePhase({ ...phase, tasks: [task], taskIds: [task.id] });
  await store.updateFeatures((document) => ({
    features: document.features.map((candidate) => candidate.id === feature.id
      ? { ...candidate, phaseIds: [phase.id] }
      : candidate),
  }));
  return { feature, phase, task };
}

describe("Ideas Inbox persistence", () => {
  test("init seeds an independent document and CRUD preserves monotonic references", async () => {
    const { store, planRoot } = await setup();
    const seeded = JSON.parse(await readFile(join(planRoot, "ideas.json"), "utf8"));
    assert.deepEqual(seeded, { nextIdeaNumber: 1, ideas: [] });

    const first = await store.createIdea({ title: "First idea", description: "Initial detail" }, "2026-08-30T10:00:00.000Z");
    const second = await store.createIdea({ title: "Second idea" }, "2026-08-30T10:01:00.000Z");
    assert.equal(formatIdeaRef(first.number), "I001");
    assert.equal(second.number, 2);
    assert.match(first.shortId, /^[A-Z2-9]{5}$/);

    const updated = await store.updateIdea(first.id, { title: "Updated idea", description: "Expanded detail" }, "2026-08-30T10:02:00.000Z");
    assert.equal(updated.title, "Updated idea");
    assert.equal(updated.description, "Expanded detail");
    assert.equal(updated.id, first.id);
    assert.equal(updated.createdAt, first.createdAt);

    assert.equal(await store.deleteIdea(first.id), true);
    const third = await store.createIdea({ title: "Third idea" }, "2026-08-30T10:03:00.000Z");
    assert.equal(third.number, 3, "deleted idea numbers are never reused");

    const reloaded = await new PlanStore(planRoot).loadIdeas();
    assert.deepEqual(reloaded.ideas.map((idea) => idea.number), [2, 3]);
    assert.equal(reloaded.nextIdeaNumber, 4);

    await store.writeGenerated();
    const rendered = await readFile(join(planRoot, ".local", "generated", "PLAN.md"), "utf8");
    assert.match(rendered, /## Ideas Inbox/);
    assert.match(rendered, /I002 — Second idea/);
    assert.match(rendered, /I003 — Third idea/);
  });

  test("invalid updates are atomic and human references resolve deterministically", async () => {
    const { store, planRoot } = await setup();
    const idea = await store.createIdea({ title: "Searchable idea" }, "2026-08-30T10:00:00.000Z");
    const before = await readFile(join(planRoot, "ideas.json"), "utf8");
    await assert.rejects(() => store.updateIdea(idea.id, { title: "   " }), /too_small|String must contain|expected string/i);
    assert.equal(await readFile(join(planRoot, "ideas.json"), "utf8"), before);

    const ideas = (await store.loadIdeas()).ideas;
    assert.equal(findIdeaByRef(ideas, "I001")?.id, idea.id);
    assert.equal(findIdeaByRef(ideas, idea.shortId.toLowerCase())?.id, idea.id);
    assert.equal(findIdeaByRef(ideas, "Searchable idea")?.id, idea.id);
  });
});

describe("Ideas promotion bookkeeping", () => {
  test("feature, phase, and task promotions retain ideas with verified target refs", async () => {
    const { store } = await setup();
    const { feature, phase, task } = await addFeaturePhaseTask(store);
    const featureIdea = await store.createIdea({ title: "Feature candidate" });
    const phaseIdea = await store.createIdea({ title: "Phase candidate" });
    const taskIdea = await store.createIdea({ title: "Task candidate" });

    const promotedFeature = await store.promoteIdea(featureIdea.id, { targetType: "feature", targetId: feature.id, promotedAt: "2026-08-30T11:00:00.000Z" });
    const promotedPhase = await store.promoteIdea(phaseIdea.id, { targetType: "phase", targetId: phase.id, promotedAt: "2026-08-30T11:01:00.000Z" });
    const promotedTask = await store.promoteIdea(taskIdea.id, { targetType: "task", targetId: task.id, promotedAt: "2026-08-30T11:02:00.000Z" });

    assert.equal(promotedFeature.promotion?.targetRef, "F001");
    assert.equal(promotedPhase.promotion?.targetRef, "P001(F001)");
    assert.equal(promotedTask.promotion?.targetRef, "P001(F001)/T001");
    assert.equal((await store.loadIdeas()).ideas.length, 3, "promotion retains history");

    const idempotent = await store.promoteIdea(featureIdea.id, { targetType: "feature", targetId: feature.id });
    assert.deepEqual(idempotent.promotion, promotedFeature.promotion);
    await assert.rejects(
      () => store.promoteIdea(featureIdea.id, { targetType: "phase", targetId: phase.id }),
      /already promoted/,
    );
    await assert.rejects(
      () => store.promoteIdea(phaseIdea.id, { targetType: "task", targetId: createTaskId() }),
      /not found/,
    );
  });

  test("Ideas operations do not alter planner rollups or active work", async () => {
    const { store } = await setup();
    const { feature, phase } = await addFeaturePhaseTask(store);
    const beforeWorkspace = await store.loadAll();
    const beforeProject = await store.loadProject();
    const beforeRequirements = await store.loadRequirements();
    const beforeResume = await store.loadResume();
    const beforeFeatureDisplay = await store.loadFeatureDisplay(feature.id);
    const beforePhaseDisplay = await store.loadPhaseDisplay(phase.id);
    const beforeRecommendation = recommendNextTask(beforeWorkspace.features.features, beforeWorkspace.phases);

    const idea = await store.createIdea({ title: "Independent idea" });
    await store.updateIdea(idea.id, { description: "Still outside planned work" });
    await store.promoteIdea(idea.id, { targetType: "phase", targetId: phase.id });

    const afterWorkspace = await store.loadAll();
    assert.deepEqual(
      afterWorkspace.features.features.map(({ id, status }) => ({ id, status })),
      beforeWorkspace.features.features.map(({ id, status }) => ({ id, status })),
    );
    assert.deepEqual(afterWorkspace.phases.map(({ id, status }) => ({ id, status })), beforeWorkspace.phases.map(({ id, status }) => ({ id, status })));
    assert.deepEqual(await store.loadProject(), beforeProject, "Ideas do not consume project work counters or runtime state");
    assert.deepEqual(await store.loadRequirements(), beforeRequirements, "Ideas do not change requirement links");
    assert.deepEqual(await store.loadResume(), beforeResume);
    assert.deepEqual(recommendNextTask(afterWorkspace.features.features, afterWorkspace.phases), beforeRecommendation, "Ideas do not affect task recommendation");
    assert.deepEqual(await store.loadFeatureDisplay(feature.id), beforeFeatureDisplay);
    assert.deepEqual(await store.loadPhaseDisplay(phase.id), beforePhaseDisplay);
    assert.equal(afterWorkspace.ideas.ideas[0]?.promotion?.targetRef, "P001(F001)");
  });
});
