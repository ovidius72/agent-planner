import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  deriveParentDisplay,
  countBreakdown,
  toWorkflowStatus,
  fromCanonicalStatus,
} from "../dist/index.js";

describe("deriveParentDisplay — truth table", () => {
  const cases = [
    // [label, input, expected displayStatus]
    ["done + planned → started", ["done", "planned"], "started"],
    ["done + paused → paused", ["done", "paused"], "paused"],
    ["done + waiting → waiting", ["done", "waiting"], "waiting"],
    ["done + blocked → blocked", ["done", "blocked"], "blocked"],
    ["done + deferred → deferred", ["done", "deferred"], "deferred"],
    ["done + canceled → closed", ["done", "canceled"], "closed"],
    ["canceled + rejected → closed", ["canceled", "rejected"], "closed"],
    ["planned + planned → planned", ["planned", "planned"], "planned"],
    ["planned + waiting → started", ["planned", "waiting"], "started"],
    ["planned + blocked → started", ["planned", "blocked"], "started"],
    ["waiting + deferred → started", ["waiting", "deferred"], "started"],
    ["blocked + deferred → started", ["blocked", "deferred"], "started"],
    ["in-progress + done → in-progress", ["in-progress", "done"], "in-progress"],
    ["all done → done", ["done", "done", "done"], "done"],
    ["all canceled → canceled", ["canceled", "canceled"], "canceled"],
    ["all rejected → rejected", ["rejected", "rejected"], "rejected"],
    ["empty → planned", [], "planned"],
  ];

  for (const [label, input, expected] of cases) {
    test(String(label), () => {
      const result = deriveParentDisplay(input);
      assert.equal(result.displayStatus, expected, String(label));
    });
  }
});

describe("deriveParentDisplay — breakdown + hasStarted", () => {
  test("breakdown counts all children including canceled/rejected", () => {
    const result = deriveParentDisplay(["done", "planned", "canceled", "rejected"]);
    assert.deepEqual(result.breakdown, {
      planned: 1, inProgress: 0, paused: 0, waiting: 0, blocked: 0,
      deferred: 0, done: 1, canceled: 1, rejected: 1,
    });
    assert.equal(result.totalChildren, 4);
    assert.equal(result.meaningfulChildren, 2);
  });

  test("hasStarted is true when at least one meaningful child is not planned", () => {
    assert.equal(deriveParentDisplay(["done", "planned"]).hasStarted, true);
    assert.equal(deriveParentDisplay(["planned", "planned"]).hasStarted, false);
    assert.equal(deriveParentDisplay(["waiting", "planned"]).hasStarted, true);
    assert.equal(deriveParentDisplay([]).hasStarted, false);
  });

  test("canceled-only children: hasStarted is false (no meaningful progress)", () => {
    const result = deriveParentDisplay(["canceled", "canceled"]);
    assert.equal(result.displayStatus, "canceled");
    assert.equal(result.hasStarted, false);
    assert.equal(result.meaningfulChildren, 0);
  });

  test("done + canceled: meaningful excludes canceled but display is closed", () => {
    const result = deriveParentDisplay(["done", "canceled"]);
    assert.equal(result.displayStatus, "closed");
    assert.equal(result.meaningfulChildren, 1);
    assert.equal(result.hasStarted, true);
  });

  test("does not mutate input array", () => {
    const input = ["done", "planned"];
    const snapshot = [...input];
    deriveParentDisplay(input);
    assert.deepEqual(input, snapshot);
  });
});

describe("countBreakdown", () => {
  test("counts every status", () => {
    const b = countBreakdown([
      "planned", "in-progress", "paused", "waiting", "blocked",
      "deferred", "done", "canceled", "rejected", "planned",
    ]);
    assert.equal(b.planned, 2);
    assert.equal(b.inProgress, 1);
    assert.equal(b.paused, 1);
    assert.equal(b.waiting, 1);
    assert.equal(b.blocked, 1);
    assert.equal(b.deferred, 1);
    assert.equal(b.done, 1);
    assert.equal(b.canceled, 1);
    assert.equal(b.rejected, 1);
  });

  test("empty input → zero counts", () => {
    const b = countBreakdown([]);
    assert.deepEqual(b, {
      planned: 0, inProgress: 0, paused: 0, waiting: 0, blocked: 0,
      deferred: 0, done: 0, canceled: 0, rejected: 0,
    });
  });
});

describe("toWorkflowStatus", () => {
  test("accepts canonical statuses", () => {
    assert.equal(toWorkflowStatus("planned"), "planned");
    assert.equal(toWorkflowStatus("in-progress"), "in-progress");
    assert.equal(toWorkflowStatus("paused"), "paused");
    assert.equal(toWorkflowStatus("done"), "done");
  });

  test("rejects unknown values", () => {
    assert.equal(toWorkflowStatus("discovery"), null);
    assert.equal(toWorkflowStatus("foo"), null);
    assert.equal(toWorkflowStatus(""), null);
  });
});

describe("fromCanonicalStatus", () => {
  test("maps discovery → in-progress", () => {
    assert.equal(fromCanonicalStatus("discovery"), "in-progress");
  });

  test("maps draft → planned", () => {
    assert.equal(fromCanonicalStatus("draft"), "planned");
  });

  test("passes through workflow statuses", () => {
    assert.equal(fromCanonicalStatus("done"), "done");
    assert.equal(fromCanonicalStatus("blocked"), "blocked");
    assert.equal(fromCanonicalStatus("waiting"), "waiting");
  });
});