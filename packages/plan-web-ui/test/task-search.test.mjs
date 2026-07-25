import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseSearchQuery, isSearchActive, matchTask } from "../src/lib/task-search.ts";

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
});