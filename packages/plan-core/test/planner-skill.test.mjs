import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadCanonicalGrillMeSkill,
  loadCanonicalPlannerSkill,
  loadProjectGrillMeSkill,
  managedPlannerSkillBody,
  plannerSkillHash,
  PlanStore,
  renderManagedPlannerSkill,
} from "../dist/index.js";

async function withPlan(run) {
  const parent = await mkdtemp(join(tmpdir(), "agent-plan-skill-"));
  const root = join(parent, ".planner");
  try {
    const store = new PlanStore(root);
    await store.init("Skill Test");
    await run({ root, store });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

test("PlanStore.init creates a deterministic timestamp-free managed SKILL.md", async () => {
  await withPlan(async ({ root, store }) => {
    const canonical = await loadCanonicalPlannerSkill();
    const persisted = await readFile(join(root, "SKILL.md"), "utf8");

    assert.match(persisted, /^<!-- agent-plan-managed-skill sha256:[a-f0-9]{64} -->\n/);
    assert.equal(managedPlannerSkillBody(persisted), canonical);
    assert.equal(plannerSkillHash(canonical).length, 64);
    assert.doesNotMatch(persisted, /createdAt|updatedAt|\d{4}-\d{2}-\d{2}T\d{2}:/);

    const second = await store.syncPlannerSkill();
    assert.equal(second.status, "current");
    assert.equal(second.customized, false);
  });
});

test("syncPlannerSkill upgrades an unmodified older managed copy", async () => {
  await withPlan(async ({ root, store }) => {
    await writeFile(join(root, "SKILL.md"), renderManagedPlannerSkill("# Older canonical guide\n"), "utf8");

    const result = await store.syncPlannerSkill();
    const canonical = await loadCanonicalPlannerSkill();
    const persisted = await readFile(join(root, "SKILL.md"), "utf8");

    assert.equal(result.status, "updated");
    assert.equal(result.customized, false);
    assert.equal(managedPlannerSkillBody(persisted), canonical);
  });
});

test("syncPlannerSkill preserves customized copies and reports actionable drift", async () => {
  await withPlan(async ({ root, store }) => {
    const customized = `${renderManagedPlannerSkill("# Older canonical guide\n")}\n## Project customization\nKeep this rule.\n`;
    await writeFile(join(root, "SKILL.md"), customized, "utf8");

    const result = await store.syncPlannerSkill();
    const persisted = await readFile(join(root, "SKILL.md"), "utf8");

    assert.equal(result.status, "customized");
    assert.equal(result.customized, true);
    assert.match(result.message, /Preserved the customized \.planner\/SKILL\.md/);
    assert.match(result.message, /Reconcile it manually/);
    assert.equal(persisted, customized);
    assert.match(result.content, /Project customization/);
  });
});

test("syncPlannerSkill preserves unmarked project-authored copies", async () => {
  await withPlan(async ({ root, store }) => {
    const customized = "# Project-specific planner guide\n\nNever overwrite this content.\n";
    await writeFile(join(root, "SKILL.md"), customized, "utf8");

    const result = await store.syncPlannerSkill();

    assert.equal(result.status, "customized");
    assert.equal(await readFile(join(root, "SKILL.md"), "utf8"), customized);
  });
});

test("core package declares the canonical grill-me asset for publication", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(packageJson.files.includes("skills/**/*.md"));
});

test("PlanStore.init seeds the canonical project-local grill-me skill", async () => {
  await withPlan(async ({ root, store }) => {
    const canonical = await loadCanonicalGrillMeSkill();
    const path = join(root, "skills", "grill-me", "SKILL.md");
    const persisted = await readFile(path, "utf8");

    assert.match(persisted, /^<!-- agent-plan-managed-skill sha256:[a-f0-9]{64} -->\n/);
    assert.equal(managedPlannerSkillBody(persisted), canonical);
    assert.match(canonical, /Ask the questions one at a time\./);
    assert.doesNotMatch(persisted, /createdAt|updatedAt|\d{4}-\d{2}-\d{2}T\d{2}:/);

    const second = await store.syncGrillMeSkill();
    assert.equal(second.status, "current");
    assert.equal(await store.ideaDiscussionSkill(), canonical);
  });
});

test("grill-me managed copies upgrade only when unmodified", async () => {
  await withPlan(async ({ root, store }) => {
    const path = join(root, "skills", "grill-me", "SKILL.md");
    await writeFile(path, renderManagedPlannerSkill("# Older grill guide\n"), "utf8");
    const updated = await store.syncGrillMeSkill();
    assert.equal(updated.status, "updated");
    assert.equal(managedPlannerSkillBody(await readFile(path, "utf8")), await loadCanonicalGrillMeSkill());

    const customized = `${renderManagedPlannerSkill("# Older grill guide\n")}\nProject-specific interview rule.\n`;
    await writeFile(path, customized, "utf8");
    const preserved = await store.syncGrillMeSkill();
    assert.equal(preserved.status, "customized");
    assert.match(preserved.message, /Preserved the customized \.planner\/skills\/grill-me\/SKILL\.md/);
    assert.equal(await readFile(path, "utf8"), customized);
    assert.match(await loadProjectGrillMeSkill(root), /Project-specific interview rule/);
  });
});

/**
 * T426 (P104/F005) — The skill must say that a task discussed is not a task
 * assigned.
 *
 * Three Opus sessions across two projects changed, or proposed changing, the
 * task they were on because another one came up in conversation. The gate
 * catches this at the action boundary (ACTIVE_TASK_CONFLICT on a second
 * task_start), but it cannot gate a sentence, and the planner cannot see the
 * conversation — so there is no datum to surface and guidance is the only
 * instrument. Pinned here so the statement cannot be dropped by a later
 * rewrite of this section, and so the escape hatch for a direct instruction
 * cannot be dropped either.
 */
test("the canonical skill states that a task mentioned in conversation is not the next task", async () => {
  const skill = await loadCanonicalPlannerSkill();

  assert.match(skill, /A task that comes up in conversation is not the next task\./);
  // The recommendation, not the conversation, decides.
  assert.match(skill, /the recommendation decides what is next/);
  // Work already underway is not displaced by a topic.
  assert.match(skill, /a task already in progress stays in progress/);
  // A real change of direction has a recorded route.
  assert.match(skill, /task_switch` \/ `task_deviation/);
  // And a direct instruction must not read as needing deviation ceremony.
  assert.match(skill, /Being told directly to work on something is an instruction/);
});
