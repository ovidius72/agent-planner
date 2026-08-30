import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PlanStore,
  ProjectSchema,
  applyLegacyProjectContextMigration,
  previewLegacyProjectContextMigration,
} from "../dist/index.js";
import { cleanupFixtures, createPlannerFixture } from "../../../test/helpers/fixtures.mjs";

after(async () => {
  await cleanupFixtures();
});

function legacyProject(overrides = {}) {
  return ProjectSchema.parse({
    name: "Legacy context",
    goal: "",
    description: "",
    projectGuidelines: {
      title: "Project Guidelines",
      content: "Existing guidance.\n\n- Run focused tests.",
      updatedAt: "2026-01-01T00:00:00.000Z",
      sessionInfo: [{ sessionId: "session-a", createdAt: "2026-01-02T00:00:00.000Z" }],
    },
    webPort: 0,
    scope: [],
    outOfScope: [],
    decisions: ["Use TypeScript for planner packages.", "Existing decision"],
    globalRules: ["Run focused tests.", "Keep source text in English."],
    technologies: [],
    tools: [],
    contentLanguage: "",
    chatLanguage: "",
    workflowRules: {
      beforePhaseStart: ["Discuss the phase first."],
      beforeTaskStart: ["Keep source text in English."],
      afterPhaseComplete: ["Run the full verification gate."],
    },
    acceptedDecisions: [{
      id: "existing-decision",
      title: "Existing decision",
      decision: "Existing decision",
      rationale: "Already structured.",
      implementationNotes: "Preserve it.",
      acceptedAt: "2026-01-01T00:00:00.000Z",
    }],
    nextFeatureNumber: 1,
    nextPhaseNumber: 1,
    nextTaskNumber: 1,
    workDeviations: [],
    ...overrides,
  });
}

test("legacy Project Guidelines titles parse compatibly but are no longer part of the canonical model", () => {
  const project = legacyProject();
  assert.equal(Object.hasOwn(project.projectGuidelines, "title"), false);
  assert.equal(project.projectGuidelines.content.startsWith("Existing guidance."), true);
});

test("migration preview is deterministic, deduplicated, and non-mutating", () => {
  const project = legacyProject();
  const first = previewLegacyProjectContextMigration(project);
  const second = previewLegacyProjectContextMigration(project);
  assert.deepEqual(second, first);
  assert.equal(first.hasLegacyContext, true);
  assert.deepEqual(first.legacyCounts, { globalRules: 2, workflowRules: 3, decisions: 2 });
  assert.deepEqual(first.guidelineAdditions.map((entry) => entry.text), [
    "Keep source text in English.",
    "Discuss the phase first.",
    "Run the full verification gate.",
  ]);
  assert.equal(first.skippedGuidelineDuplicates, 2);
  assert.equal(first.acceptedDecisionAdditions.length, 1);
  assert.equal(first.acceptedDecisionAdditions[0].decision, "Use TypeScript for planner packages.");
  assert.equal(first.skippedDecisionDuplicates, 1);
  assert.deepEqual(first.fieldsClearedOnApply, ["globalRules", "workflowRules", "decisions"]);
  assert.equal(project.globalRules.length, 2, "preview does not mutate the source project");
});

test("pure migration preserves existing canonical values and clears only migrated legacy fields", () => {
  const project = legacyProject();
  const result = applyLegacyProjectContextMigration(project, "2026-02-01T00:00:00.000Z");
  assert.equal(result.applied, true);
  assert.deepEqual(result.project.globalRules, []);
  assert.deepEqual(result.project.workflowRules, { beforePhaseStart: [], beforeTaskStart: [], afterPhaseComplete: [] });
  assert.deepEqual(result.project.decisions, []);
  assert.equal(result.project.acceptedDecisions[0].id, "existing-decision");
  assert.equal(result.project.acceptedDecisions[1].acceptedAt, "2026-02-01T00:00:00.000Z");
  assert.match(result.project.projectGuidelines.content, /Existing guidance\./);
  assert.match(result.project.projectGuidelines.content, /### Global rules\n- Keep source text in English\./);
  assert.match(result.project.projectGuidelines.content, /### After phase complete\n- Run the full verification gate\./);
  assert.equal(project.decisions.length, 2, "migration returns a new project value");
});

test("PlanStore previews without writes, applies explicitly, and verifies the persisted result", async () => {
  const { store, planRoot } = await createPlannerFixture({ name: "legacy-context-store", seed: "empty" });
  await store.updateProject((project) => ({
    ...project,
    projectGuidelines: {
      ...project.projectGuidelines,
      content: "Run focused tests.",
      sessionInfo: [{ sessionId: "session-a", createdAt: "2026-01-01T00:00:00.000Z" }],
    },
    globalRules: ["Run focused tests.", "Keep source text in English."],
    workflowRules: {
      beforePhaseStart: ["Discuss the phase first."],
      beforeTaskStart: [],
      afterPhaseComplete: [],
    },
    decisions: ["Use TypeScript for planner packages."],
  }));

  const projectPath = join(planRoot, "project.json");
  const persistedWithLegacyTitle = JSON.parse(await readFile(projectPath, "utf8"));
  persistedWithLegacyTitle.projectGuidelines.title = "Project Guidelines";
  await writeFile(projectPath, `${JSON.stringify(persistedWithLegacyTitle, null, 2)}\n`, "utf8");
  const beforePreview = await readFile(projectPath, "utf8");
  const freshStore = new PlanStore(planRoot);
  const loaded = await freshStore.loadProject();
  assert.equal(Object.hasOwn(loaded.projectGuidelines, "title"), false);
  assert.equal(await readFile(projectPath, "utf8"), beforePreview, "ordinary load does not rewrite or migrate legacy data");

  const preview = await freshStore.previewLegacyProjectContextMigration();
  assert.equal(preview.guidelineAdditions.length, 2);
  assert.equal(await readFile(projectPath, "utf8"), beforePreview, "preview is read-only");

  const result = await freshStore.migrateLegacyProjectContext();
  assert.equal(result.applied, true);
  const after = await freshStore.loadProject();
  assert.equal(Object.hasOwn(after.projectGuidelines, "title"), false);
  assert.deepEqual(after.globalRules, []);
  assert.deepEqual(after.decisions, []);
  assert.deepEqual(after.workflowRules, { beforePhaseStart: [], beforeTaskStart: [], afterPhaseComplete: [] });
  assert.equal(after.acceptedDecisions.some((decision) => decision.decision === "Use TypeScript for planner packages."), true);
  assert.match(after.projectGuidelines.content, /Keep source text in English\./);
  assert.ok(after.projectGuidelines.updatedAt);
  assert.deepEqual(after.projectGuidelines.sessionInfo, [{ sessionId: "session-a", createdAt: "2026-01-01T00:00:00.000Z" }]);

  const second = await freshStore.migrateLegacyProjectContext();
  assert.equal(second.applied, false, "a completed migration is idempotent");
});
