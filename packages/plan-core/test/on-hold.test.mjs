import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRecommendationReply,
  listOnHoldWork,
  recommendNextWork,
  refsNamedIn,
  renderOnHoldWork,
  startedOpenPhaseIds,
} from "../dist/index.js";

const now = "2026-09-28T00:00:00.000Z";
const feature = (id, number) => ({ id, number, name: `Feature ${number}`, status: "in-progress", priority: number, acceptedDecisions: [] });
const task = (id, number, status, reason = "") => ({
  id, number, title: `Task ${number}`, status, priority: number, dependsOn: [], acceptedDecisions: [], checklist: [],
  statusLog: reason ? [{ id: `${id}-log`, date: now, fromStatus: "planned", toStatus: status, title: `planned → ${status}`, description: reason }] : [],
  createdAt: now, updatedAt: now,
});
const phase = (id, number, featureId, tasks) => ({ id, number, featureId, title: `Phase ${number}`, status: "in-progress", priority: number, tasks, acceptedDecisions: [] });

// The heca shape: a phase whose planned work is finished, with parked tasks
// waiting on another phase that has since finished.
function hecaLike() {
  const features = [feature("f3", 3), feature("f11", 11)];
  const blocker = phase("p97", 97, "f3", [task("t501", 501, "done"), task("t502", 502, "canceled")]);
  const stillOpen = phase("p94", 94, "f11", [task("t449", 449, "planned")]);
  const current = phase("p82", 82, "f3", [
    task("t466", 466, "done"),
    task("t509", 509, "deferred", "Resume once P097(F003) lands."),
    task("t513", 513, "deferred", "Waits on P094(F011)/T449, which reshapes this area."),
    task("t514", 514, "deferred", "Parked until someone needs it."),
    task("t515", 515, "deferred", "Parked; see T509 and F003/P097."),
  ]);
  const later = phase("p22", 22, "f3", [task("t083", 83, "planned")]);
  return { features, phases: [current, blocker, stillOpen, later] };
}

test("refs named in a reason resolve by number, in every spelling, and never by title", () => {
  const { features, phases } = hecaLike();
  const refs = refsNamedIn("P097(F003), F011/P094/T449, P097/T501, T466, P999, HTTP2, T-shirt", phases, features);
  assert.deepEqual(refs.map((ref) => [ref.ref, ref.found, ref.finished]), [
    ["P097(F003)", true, true],
    ["P094(F011)/T449", true, false],
    ["P097/T501", true, true],
    ["T466", true, true],
    ["P999", false, false],
  ]);
  // A wrong feature for a phase is not a match.
  assert.deepEqual(refsNamedIn("P097(F011)", phases, features).map((ref) => ref.found), [false]);
});

test("a parked task is flagged only when every ref its reason names is finished", () => {
  const { features, phases } = hecaLike();
  const items = listOnHoldWork(features, phases);
  const byRef = Object.fromEntries(items.map((item) => [item.ref.split("/").pop(), item]));
  assert.equal(byRef.T509.readyToResume, true, "waits only on a finished phase");
  assert.equal(byRef.T513.readyToResume, false, "waits on an open task");
  assert.equal(byRef.T514.readyToResume, false, "free-text reason: shown, never flagged");
  assert.equal(byRef.T515.readyToResume, false, "names a sibling that is itself still parked");
  assert.equal(items[0].readyToResume, true, "flagged tasks come first");
  assert.equal(byRef.T509.reason, "Resume once P097(F003) lands.");
});

test("the recommendation surfaces parked work before sending the agent to another phase", () => {
  const { features, phases } = hecaLike();
  const result = recommendNextWork(features, phases);
  assert.equal(result.nextTask?.number, 83, "fresh priority work elsewhere is still the recommendation");
  const claim = result.claims.find((entry) => entry.source === "on-hold");
  assert.ok(claim, "the parked task that may be ready is a claim");
  assert.equal(claim.ref, "P082(F003)/T509");

  const reply = buildRecommendationReply(result, features);
  assert.match(reply.text, /On hold — check whether these can resume \(4 on hold, 1 may be ready\)/);
  assert.match(reply.text, /P082\(F003\)\/T509 .*MAY BE READY/);
  assert.match(reply.text, /Reason: Parked until someone needs it\./);
  assert.match(reply.text, /still waiting on P094\(F011\)\/T449/);
  assert.deepEqual(reply.structured.onHold, { total: 4, readyToResume: ["P082(F003)/T509"] });
});

test("parked work in a phase nobody has started stays out of the way", () => {
  const { features, phases } = hecaLike();
  phases.push(phase("p30", 30, "f3", [task("t900", 900, "deferred", "Later, after P097.")]));
  const started = startedOpenPhaseIds(phases);
  assert.equal(started.has("p30"), false);
  assert.equal(started.has("p82"), true);
  assert.equal(listOnHoldWork(features, phases, started).some((item) => item.ref.endsWith("/T900")), false);
});

test("a parked task's dependsOn counts like a ref named in the reason, even when the reason names nothing", () => {
  const { features, phases } = hecaLike();
  const current = phases.find((p) => p.id === "p82");
  const t514 = current.tasks.find((t) => t.number === 514); // reason: "Parked until someone needs it." — no refs
  t514.dependsOn = ["t501"]; // t501 is done, in phase p97
  const items = listOnHoldWork(features, phases);
  const byRef = Object.fromEntries(items.map((item) => [item.ref.split("/").pop(), item]));
  assert.deepEqual(byRef.T514.namedRefs.map((ref) => ref.ref), ["P097(F003)/T501"]);
  assert.equal(byRef.T514.readyToResume, true, "a dependsOn edge alone, with no ref in the reason, still flags ready once it is finished");
});

test("a dependsOn edge already named in the reason is merged, not duplicated", () => {
  const { features, phases } = hecaLike();
  const current = phases.find((p) => p.id === "p82");
  const t513 = current.tasks.find((t) => t.number === 513); // reason names P094(F011)/T449
  t513.dependsOn = ["t449"]; // same task the reason already names
  const items = listOnHoldWork(features, phases);
  const byRef = Object.fromEntries(items.map((item) => [item.ref.split("/").pop(), item]));
  assert.equal(byRef.T513.namedRefs.length, 1, "the dependency must not be listed twice");
  assert.equal(byRef.T513.namedRefs[0].ref, "P094(F011)/T449");
});

test("readyToResume requires every dependsOn edge finished too, not just the refs named in the reason", () => {
  const { features, phases } = hecaLike();
  const current = phases.find((p) => p.id === "p82");
  const t514 = current.tasks.find((t) => t.number === 514); // no refs in reason
  t514.dependsOn = ["t501", "t083"]; // t501 done; t083 (phase p22) still planned
  const items = listOnHoldWork(features, phases);
  const byRef = Object.fromEntries(items.map((item) => [item.ref.split("/").pop(), item]));
  assert.equal(byRef.T514.readyToResume, false, "not ready while one dependency is still open");
  assert.equal(byRef.T514.namedRefs.find((ref) => ref.ref === "P022(F003)/T083")?.finished, false);
});

test("the on-hold block is bounded", () => {
  const features = [feature("f1", 1)];
  const tasks = [task("done", 1, "done"), ...Array.from({ length: 30 }, (_, index) => task(`t${index}`, index + 10, "deferred", "x".repeat(500)))];
  const text = renderOnHoldWork(listOnHoldWork(features, [phase("p1", 1, "f1", tasks)]), 8);
  assert.match(text, /\(22 more on hold/);
  assert.ok(text.length < 3_000, `on-hold block grew to ${text.length}`);
});
