import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listOpenPhaseWork,
  openPhaseWorkLines,
  boundedOpenPhaseWork,
  findHigherPriorityOpenPhase,
  higherPriorityOpenPhaseAdvisory,
  OPEN_PHASE_WORK_LIST_LIMIT,
} from "../dist/stranded-phase.js";

const feature = { id: "feature-id", number: 5, status: "in-progress" };

function phase(overrides = {}) {
  return { id: "phase-id", number: 102, featureId: feature.id, status: "in-progress", priority: 34, tasks: [], ...overrides };
}

// P104(F005)/T422: reproduces the session this task was opened from — P102
// (priority 34) had one task left planned while work moved on to P104
// (priority 36). Nothing said P102 was still open.

test("listOpenPhaseWork lists only in-progress phases with a non-terminal task, priority-ordered", () => {
  const p102 = phase({
    id: "p102", number: 102, priority: 34, title: "Stranded phase",
    tasks: [
      { id: "t403", number: 403, status: "done", dependsOn: [] },
      { id: "t404", number: 404, status: "done", dependsOn: [] },
      { id: "t405", number: 405, status: "planned", dependsOn: [] },
    ],
  });
  const p104 = phase({
    id: "p104", number: 104, priority: 36, title: "Current phase",
    tasks: [{ id: "t420", number: 420, status: "planned", dependsOn: [] }],
  });
  const doneePhase = phase({
    id: "p100", number: 100, priority: 10, title: "Finished phase", status: "done",
    tasks: [{ id: "t100", number: 100, status: "done", dependsOn: [] }],
  });
  const draftPhase = phase({
    id: "p101", number: 101, priority: 20, title: "Not yet in progress", status: "planned",
    tasks: [{ id: "t101", number: 101, status: "planned", dependsOn: [] }],
  });

  const result = listOpenPhaseWork([p102, p104, doneePhase, draftPhase], [feature]);
  assert.deepEqual(result.map((entry) => entry.ref), ["P102(F005)", "P104(F005)"], "only in-progress phases with remaining work, priority order");
  assert.equal(result[0].readyTaskCount, 1);
  assert.equal(result[0].title, "Stranded phase");
});

test("listOpenPhaseWork reports zero ready tasks when remaining work is blocked by a dependency", () => {
  const blocked = phase({
    id: "p-blocked", number: 200, priority: 5, title: "Blocked remainder",
    tasks: [
      { id: "t1", number: 1, status: "planned", dependsOn: ["not-done-elsewhere"] },
    ],
  });
  const result = listOpenPhaseWork([blocked], [feature]);
  assert.equal(result.length, 1, "still listed — remaining work exists even though none of it is ready");
  assert.equal(result[0].readyTaskCount, 0, "a dependency-blocked remainder is not a reason to advise switching here");
});

test("listOpenPhaseWork reports zero ready tasks when the only remainder is already an active task", () => {
  const activeOnly = phase({
    id: "p-active", number: 201, priority: 5, title: "Active-task-only remainder",
    tasks: [{ id: "t1", number: 1, status: "in-progress", dependsOn: [] }],
  });
  const result = listOpenPhaseWork([activeOnly], [feature]);
  assert.equal(result.length, 1);
  assert.equal(result[0].readyTaskCount, 0, "the active task itself is not 'ready' — it is already claimed, not startable");
});

test("listOpenPhaseWork reports zero ready tasks when the parent feature is hard-unavailable", () => {
  const blockedFeature = { id: "blocked-feature", number: 9, status: "blocked" };
  const inFeature = phase({
    id: "p-feat-blocked", number: 300, priority: 5, title: "Feature blocked", featureId: blockedFeature.id,
    tasks: [{ id: "t1", number: 1, status: "planned", dependsOn: [] }],
  });
  const result = listOpenPhaseWork([inFeature], [blockedFeature]);
  assert.equal(result[0].readyTaskCount, 0);
});

test("openPhaseWorkLines bounds the listing and folds the remainder into a count", () => {
  const phases = Array.from({ length: OPEN_PHASE_WORK_LIST_LIMIT + 3 }, (_, index) => phase({
    id: `p-${index}`, number: 400 + index, priority: index, title: `Phase ${index}`,
    tasks: [{ id: `t-${index}`, number: index, status: "planned", dependsOn: [] }],
  }));
  const openWork = listOpenPhaseWork(phases, [feature]);
  const rendered = openPhaseWorkLines(openWork);
  const renderedLines = rendered.split("\n");
  assert.equal(renderedLines.length, OPEN_PHASE_WORK_LIST_LIMIT + 1, "one line per shown phase, plus one fold-in line");
  assert.match(renderedLines[renderedLines.length - 1], /and 3 more in-progress phase\(s\)/);
  assert.equal(boundedOpenPhaseWork(openWork).length, OPEN_PHASE_WORK_LIST_LIMIT);
});

test("openPhaseWorkLines returns empty string for no open work", () => {
  assert.equal(openPhaseWorkLines([]), "");
});

test("findHigherPriorityOpenPhase names the higher-priority open phase — the reported P102/P104 scenario", () => {
  const p102 = phase({
    id: "p102", number: 102, priority: 34, title: "Stranded phase",
    tasks: [{ id: "t405", number: 405, status: "planned", dependsOn: [] }],
  });
  const p104 = phase({
    id: "p104", number: 104, priority: 36, title: "Current phase",
    tasks: [{ id: "t420", number: 420, status: "planned", dependsOn: [] }],
  });
  const candidate = findHigherPriorityOpenPhase([p102, p104], [feature], "p104", 36);
  assert.ok(candidate);
  assert.equal(candidate.ref, "P102(F005)");
  assert.equal(candidate.readyTaskCount, 1);
});

test("findHigherPriorityOpenPhase returns null when the target's own phase is already the highest-priority open one", () => {
  const p102 = phase({
    id: "p102", number: 102, priority: 34, title: "Stranded phase",
    tasks: [{ id: "t405", number: 405, status: "planned", dependsOn: [] }],
  });
  const p104 = phase({
    id: "p104", number: 104, priority: 36, title: "Current phase",
    tasks: [{ id: "t420", number: 420, status: "planned", dependsOn: [] }],
  });
  const candidate = findHigherPriorityOpenPhase([p102, p104], [feature], "p102", 34);
  assert.equal(candidate, null);
});

test("findHigherPriorityOpenPhase does not advise a same-priority tie", () => {
  const p102 = phase({ id: "p102", number: 102, priority: 34, title: "Tied A", tasks: [{ id: "t1", number: 1, status: "planned", dependsOn: [] }] });
  const p103 = phase({ id: "p103", number: 103, priority: 34, title: "Tied B", tasks: [{ id: "t2", number: 2, status: "planned", dependsOn: [] }] });
  const candidate = findHigherPriorityOpenPhase([p102, p103], [feature], "p103", 34);
  assert.equal(candidate, null, "equal priority is not 'higher' priority — neither phase is more open than the other");
});

test("findHigherPriorityOpenPhase ignores a higher-priority phase whose remaining tasks are all blocked", () => {
  const blocked = phase({
    id: "p-blocked", number: 50, priority: 5, title: "Blocked higher-priority phase",
    tasks: [{ id: "t1", number: 1, status: "planned", dependsOn: ["not-done-elsewhere"] }],
  });
  const target = phase({ id: "p-target", number: 60, priority: 10, title: "Target", tasks: [{ id: "t2", number: 2, status: "planned", dependsOn: [] }] });
  const candidate = findHigherPriorityOpenPhase([blocked, target], [feature], "p-target", 10);
  assert.equal(candidate, null, "a blocked remainder is never a reason to advise switching there");
});

test("higherPriorityOpenPhaseAdvisory renders nothing for null and a bounded advisory line for a candidate", () => {
  assert.equal(higherPriorityOpenPhaseAdvisory(null), "");
  const line = higherPriorityOpenPhaseAdvisory({ phaseId: "p102", ref: "P102(F005)", title: "Stranded phase", priority: 34, readyTaskCount: 1 });
  assert.match(line, /P102\(F005\)/);
  assert.match(line, /Stranded phase/);
  assert.match(line, /1 ready task/);
  assert.match(line, /not.*finished first/);
});
