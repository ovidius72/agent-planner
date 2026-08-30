import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadCanonicalPlannerSkill,
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
