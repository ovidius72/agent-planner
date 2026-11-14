import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseSearchQuery, isSearchActive, matchTask, matchFeature, matchPhase, buildFeatureHay, buildPhaseHay, buildTaskHay } from "../src/lib/task-search.ts";

function mkFeature(n, status = "planned", shortId) {
  return { id: `f${n}`, number: n, name: `Feature ${n}`, status, shortId, createdAt: "", updatedAt: "" };
}
function mkPhase(n, status = "planned", shortId) {
  return { id: `p${n}`, number: n, featureId: `f${n}`, slug: `p${n}`, title: `Phase ${n}`, status, shortId, createdAt: "", updatedAt: "" };
}
function mkTask(n, status = "planned", shortId, title = "task") {
  return { id: `t${n}`, number: n, phaseId: "p1", title, shortName: `t${n}`, status, shortId, createdAt: "", updatedAt: "" };
}

describe("parseSearchQuery — same-field UNION (AND/OR)", () => {
  test("feature:001 AND feature:002 → {1,2}, no AND leak into text", () => {
    const f = parseSearchQuery("feature:001 AND feature:002");
    assert.equal(f.featureNumbers?.size, 2);
    assert.ok(f.featureNumbers.has(1) && f.featureNumbers.has(2));
    assert.equal(f.text, null);
  });
  test("feature: 001 AND feature: 002 (spaces after colon) → {1,2}", () => {
    const f = parseSearchQuery("feature: 001 AND feature: 002");
    assert.equal(f.featureNumbers?.size, 2);
  });
  test("feature:1 OR feature:2 → {1,2}", () => {
    const f = parseSearchQuery("feature:1 OR feature:2");
    assert.equal(f.featureNumbers?.size, 2);
    assert.equal(f.text, null);
  });
  test("task:1 task:2 task:3 → {1,2,3} (repeated clauses accumulate)", () => {
    const f = parseSearchQuery("task:1 task:2 task:3");
    assert.equal(f.taskNumbers?.size, 3);
  });
  test("comma-list feature:1,2 → {1,2}", () => {
    const f = parseSearchQuery("feature:1,2");
    assert.equal(f.featureNumbers?.size, 2);
  });
  test("id:UUXD1 OR id:ABCD2 → {UUXD1, ABCD2}", () => {
    const f = parseSearchQuery("id:UUXD1 OR id:ABCD2");
    assert.equal(f.shortIds?.size, 2);
    assert.ok(f.shortIds.has("UUXD1") && f.shortIds.has("ABCD2"));
  });
});

describe("parseSearchQuery — cross-field INTERSECTION", () => {
  test("feature:1 status:in-progress → both set", () => {
    const f = parseSearchQuery("feature:1 status:in-progress");
    assert.ok(f.featureNumbers.has(1));
    assert.equal(f.status, "in-progress");
  });
  test("feature:1 AND status:in-progress → both set (AND ignored)", () => {
    const f = parseSearchQuery("feature:1 AND status:in-progress");
    assert.ok(f.featureNumbers.has(1));
    assert.equal(f.status, "in-progress");
  });
});

describe("parseSearchQuery — full-text when no scope", () => {
  test("bare 'auth' → text filter, no number/status filters", () => {
    const f = parseSearchQuery("auth");
    assert.equal(f.text, "auth");
    assert.ok(isSearchActive(f));
    assert.equal(f.featureNumbers, null);
    assert.equal(f.status, null);
  });
  test("bare T003/P003/F003 references become scoped number filters", () => {
    const task = parseSearchQuery("t003");
    assert.deepEqual([...task.taskNumbers], [3]);
    assert.equal(task.text, null);
    assert.deepEqual([...parseSearchQuery("P003").phaseNumbers], [3]);
    assert.deepEqual([...parseSearchQuery("f003").featureNumbers], [3]);
  });
  test("bare phrase 'auth login' → text joined", () => {
    const f = parseSearchQuery("auth login");
    assert.equal(f.text, "auth login");
  });
  test("title:auth → text filter", () => {
    const f = parseSearchQuery("title:auth");
    assert.equal(f.text, "auth");
  });
  test("blank → empty filters, not active", () => {
    const f = parseSearchQuery("   ");
    assert.equal(isSearchActive(f), false);
  });
});

describe("matchTask — union + intersection behavior", () => {
  test("feature:1 AND feature:2 matches F1 and F2 tasks, not F3", () => {
    const f = parseSearchQuery("feature:1 AND feature:2");
    assert.ok(matchTask(f, { feature: mkFeature(1), phase: mkPhase(1), task: mkTask(1) }));
    assert.ok(matchTask(f, { feature: mkFeature(2), phase: mkPhase(2), task: mkTask(2) }));
    assert.ok(!matchTask(f, { feature: mkFeature(3), phase: mkPhase(3), task: mkTask(3) }));
  });
  test("feature:1 status:in-progress → only F1 in-progress tasks", () => {
    const f = parseSearchQuery("feature:1 status:in-progress");
    assert.ok(matchTask(f, { feature: mkFeature(1), phase: mkPhase(1), task: mkTask(1, "in-progress") }));
    assert.ok(!matchTask(f, { feature: mkFeature(1), phase: mkPhase(1), task: mkTask(1, "planned") }));
    assert.ok(!matchTask(f, { feature: mkFeature(2), phase: mkPhase(2), task: mkTask(2, "in-progress") }));
  });
  test("bare text 'auth' matches task whose title contains auth", () => {
    const f = parseSearchQuery("auth");
    assert.ok(matchTask(f, { feature: mkFeature(1), phase: mkPhase(1), task: mkTask(1, "planned", undefined, "user auth flow") }));
    assert.ok(!matchTask(f, { feature: mkFeature(1), phase: mkPhase(1), task: mkTask(1, "planned", undefined, "billing") }));
  });
  test("bare t003 matches only task 3, not another task with T003 in parent metadata", () => {
    const f = parseSearchQuery("t003");
    const feature = mkFeature(1);
    const phase = { ...mkPhase(1), description: "Parent context mentions T003" };
    assert.ok(matchTask(f, { feature, phase, task: mkTask(3) }));
    assert.ok(!matchTask(f, { feature, phase, task: mkTask(4) }));
  });
});

describe("matchFeature — empty features stay discoverable", () => {
  test("feature:1 matches the feature with no phases at all", () => {
    const f = parseSearchQuery("feature:1");
    assert.ok(matchFeature(f, mkFeature(1)));
  });
  test("feature:1 does not match another feature number", () => {
    const f = parseSearchQuery("feature:1");
    assert.ok(!matchFeature(f, mkFeature(2)));
  });
  test("feature-status:planned matches by feature status", () => {
    const f = parseSearchQuery("feature-status:planned");
    assert.ok(matchFeature(f, mkFeature(1)));
    assert.ok(!matchFeature(f, mkFeature(1, "done")));
  });
  test("bare text matches the feature's own name and description", () => {
    const f = parseSearchQuery("brain");
    const feature = { ...mkFeature(1), name: "Agent Brain", description: "Reliable workflow" };
    assert.ok(matchFeature(f, feature));
    assert.ok(!matchFeature(f, mkFeature(2)));
  });
  test("id:<feature shortId> matches the feature itself", () => {
    const f = parseSearchQuery("id:UUXD1");
    assert.ok(matchFeature(f, mkFeature(1, "planned", "UUXD1")));
    assert.ok(!matchFeature(f, mkFeature(1, "planned", "OTHER")));
  });
  test("task-scoped filters never fabricate a parent match", () => {
    const taskFilter = parseSearchQuery("task:1");
    assert.ok(!matchFeature(taskFilter, mkFeature(1)));
    const statusFilter = parseSearchQuery("status:done");
    assert.ok(!matchFeature(statusFilter, mkFeature(1)));
  });
  test("phase:2 does not independently match a bare feature", () => {
    const f = parseSearchQuery("phase:2");
    assert.ok(!matchFeature(f, mkFeature(1)));
  });
});

describe("matchPhase — empty phases stay discoverable", () => {
  test("phase:2 matches a phase with no tasks", () => {
    const f = parseSearchQuery("phase:2");
    assert.ok(matchPhase(f, { feature: mkFeature(1), phase: mkPhase(2) }));
  });
  test("phase:2 does not match another phase number", () => {
    const f = parseSearchQuery("phase:2");
    assert.ok(!matchPhase(f, { feature: mkFeature(1), phase: mkPhase(3) }));
  });
  test("phase-status:in-progress matches by phase status", () => {
    const f = parseSearchQuery("phase-status:in-progress");
    assert.ok(matchPhase(f, { feature: mkFeature(1), phase: mkPhase(2, "in-progress") }));
    assert.ok(!matchPhase(f, { feature: mkFeature(1), phase: mkPhase(2) }));
  });
  test("feature:1 phase:2 requires both scopes to match", () => {
    const f = parseSearchQuery("feature:1 phase:2");
    assert.ok(matchPhase(f, { feature: mkFeature(1), phase: mkPhase(2) }));
    assert.ok(!matchPhase(f, { feature: mkFeature(2), phase: mkPhase(2) }));
    assert.ok(!matchPhase(f, { feature: mkFeature(1), phase: mkPhase(3) }));
  });
  test("bare text matches the phase's own title and description", () => {
    const f = parseSearchQuery("setup");
    const phase = { ...mkPhase(2), title: "Initial setup", description: "Bootstrap the plan" };
    assert.ok(matchPhase(f, { feature: mkFeature(1), phase }));
    assert.ok(!matchPhase(f, { feature: mkFeature(1), phase: mkPhase(2) }));
  });
  test("id:<feature shortId> matches its empty phases like it matches tasks", () => {
    const f = parseSearchQuery("id:UUXD1");
    assert.ok(matchPhase(f, { feature: mkFeature(1, "planned", "UUXD1"), phase: mkPhase(2) }));
    assert.ok(!matchPhase(f, { feature: mkFeature(1, "planned", "OTHER"), phase: mkPhase(2) }));
  });
  test("task-scoped filters never fabricate a parent match", () => {
    const taskFilter = parseSearchQuery("task:1");
    assert.ok(!matchPhase(taskFilter, { feature: mkFeature(1), phase: mkPhase(2) }));
    const statusFilter = parseSearchQuery("status:done");
    assert.ok(!matchPhase(statusFilter, { feature: mkFeature(1), phase: mkPhase(2) }));
  });
});

describe("haystacks — composed entity hays keep task matching unchanged", () => {
  test("buildTaskHay still contains parent phase and feature metadata", () => {
    const hay = buildTaskHay({
      feature: mkFeature(1, "planned", "FFEA1"),
      phase: mkPhase(2, "planned", "PPHA2"),
      task: mkTask(3, "planned", "TTAS3", "user auth flow"),
    });
    assert.ok(hay.includes("user auth flow"));
    assert.ok(hay.includes("phase 2"));
    assert.ok(hay.includes("feature 1"));
    assert.ok(hay.includes("t003"));
    assert.ok(hay.includes("p002"));
    assert.ok(hay.includes("f001"));
    assert.ok(hay.includes("ffea1"));
  });
  test("buildFeatureHay/buildPhaseHay produce the entity-only subsets", () => {
    const feature = { ...mkFeature(1, "planned", "FFE"), description: "auth domain" };
    const featureHay = buildFeatureHay(feature);
    assert.ok(featureHay.includes("feature 1"));
    assert.ok(featureHay.includes("f001"));
    assert.ok(featureHay.includes("auth domain"));
    assert.ok(!featureHay.includes("p002"));
    const phaseHay = buildPhaseHay(mkPhase(2));
    assert.ok(phaseHay.includes("phase 2"));
    assert.ok(phaseHay.includes("p002"));
    assert.ok(!phaseHay.includes("feature 1"));
  });
  test("buildTaskHay equals the composed task, phase and feature hays", () => {
    const ctx = { feature: mkFeature(1), phase: mkPhase(2), task: mkTask(3) };
    const taskPart = [ctx.task.title, ctx.task.shortName ?? "", ctx.task.shortId ?? "", String(ctx.task.number), `T${String(ctx.task.number).padStart(3, "0")}`, ctx.task.description ?? "", ctx.task.notes ?? ""].join(" ");
    assert.equal(buildTaskHay(ctx), [taskPart, buildPhaseHay(ctx.phase), buildFeatureHay(ctx.feature)].join(" ").toLowerCase());
  });
});