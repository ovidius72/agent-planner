/**
 * P104(F005)/T428 — Stop a task reporting done while every step says not
 * done.
 *
 * Before this task, `planner-task-complete` / `task_complete` refused an
 * incomplete checklist with a message naming only `force=true` — never the
 * way to satisfy the gate (`planner-task-checklist-toggle` /
 * `task_checklist_toggle`). 26 tasks in this project ended up `done` with
 * every checklist item still unticked, because the only route the refusal
 * ever showed was the bypass. These tests pin: the refusal names the toggle
 * command first, `force` requires a motivation (reusing `needsMotivation`'s
 * convention), a forced completion records what it overrode, and nothing
 * here ever ticks an item on the caller's behalf.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateTaskCompletionGate,
  taskCompletionChecklistRefusal,
  taskCompletionForceMotivationRequired,
  taskCompletionOverrideNote,
  taskCompletionMismatchLine,
  needsMotivation,
} from "../dist/index.js";

function item(title, checked) {
  return { id: `id-${title}`, number: 1, title, checked };
}

test("evaluateTaskCompletionGate allows a fully-checked checklist with nothing to override", () => {
  const decision = evaluateTaskCompletionGate([item("Write tests", true), item("Ship it", true)], false, undefined);
  assert.equal(decision.allowed, true);
  assert.deepEqual(decision.uncheckedItems, []);
  assert.deepEqual(decision.overriddenItems, []);
});

test("evaluateTaskCompletionGate allows an empty checklist (no gate applies)", () => {
  const decision = evaluateTaskCompletionGate([], false, undefined);
  assert.equal(decision.allowed, true);
  assert.deepEqual(decision.overriddenItems, []);
});

test("evaluateTaskCompletionGate denies open items without force", () => {
  const decision = evaluateTaskCompletionGate([item("Write tests", false), item("Ship it", true)], false, undefined);
  assert.equal(decision.allowed, false);
  assert.equal(decision.errorCode, "CHECKLIST_INCOMPLETE");
  assert.deepEqual(decision.uncheckedItems.map((i) => i.title), ["Write tests"]);
});

test("evaluateTaskCompletionGate denies force=true without a motivation", () => {
  const decision = evaluateTaskCompletionGate([item("Write tests", false)], true, undefined);
  assert.equal(decision.allowed, false);
  assert.equal(decision.errorCode, "FORCE_MOTIVATION_REQUIRED");

  const blank = evaluateTaskCompletionGate([item("Write tests", false)], true, "   ");
  assert.equal(blank.allowed, false);
  assert.equal(blank.errorCode, "FORCE_MOTIVATION_REQUIRED");
});

test("evaluateTaskCompletionGate allows force=true with a motivation, and reports exactly the overridden items", () => {
  const unchecked = item("Write tests", false);
  const checked = item("Ship it", true);
  const decision = evaluateTaskCompletionGate([unchecked, checked], true, "Checklist no longer matches — tests were covered by a different task.");
  assert.equal(decision.allowed, true);
  assert.deepEqual(decision.overriddenItems, [unchecked]);
  // The gate never mutates: the input items are untouched (still unchecked).
  assert.equal(unchecked.checked, false);
});

test("taskCompletionChecklistRefusal names the toggle command before force", () => {
  const message = taskCompletionChecklistRefusal([item("Write tests", false)], "planner-task-checklist-toggle P1(F1)/T1 <item>");
  const toggleIndex = message.indexOf("planner-task-checklist-toggle");
  const forceIndex = message.indexOf("force=true");
  assert.ok(toggleIndex >= 0, "message names the toggle command");
  assert.ok(forceIndex >= 0, "message still names force as the exception");
  assert.ok(toggleIndex < forceIndex, "the toggle command is named before force, not after");
  assert.ok(message.includes("Write tests"));
});

test("taskCompletionForceMotivationRequired names the motivation parameter", () => {
  const message = taskCompletionForceMotivationRequired([item("Write tests", false)]);
  assert.ok(message.includes("motivation"));
  assert.ok(message.includes("1"));
});

test("taskCompletionOverrideNote is empty when nothing was overridden, and names titles + motivation otherwise", () => {
  assert.equal(taskCompletionOverrideNote([], undefined), "");

  const note = taskCompletionOverrideNote([item("Write tests", false), item("Get review", false)], "Scope moved to a follow-up task.");
  assert.ok(note.includes("Write tests"));
  assert.ok(note.includes("Get review"));
  assert.ok(note.includes("Scope moved to a follow-up task."));
});

test("taskCompletionMismatchLine is silent for a non-done task and for a done task with nothing open", () => {
  assert.equal(taskCompletionMismatchLine("in-progress", [item("Write tests", false)]), "");
  assert.equal(taskCompletionMismatchLine("done", [item("Write tests", true)]), "");
  assert.equal(taskCompletionMismatchLine("done", []), "");
});

test("taskCompletionMismatchLine names the open items on a task marked done with open checklist items", () => {
  const line = taskCompletionMismatchLine("done", [item("Write tests", false), item("Ship it", true)]);
  assert.ok(line.includes("done"));
  assert.ok(line.includes("Write tests"));
  assert.ok(line.includes("1"));
});

// needsMotivation already gates blocked/canceled/deferred/rejected/waiting
// and →planned; this task reuses it for forced completions rather than
// inventing a second convention. Pin both: existing behavior is untouched,
// and the new `forced` case is additive.
test("needsMotivation is unchanged for every existing caller (forced defaults to false)", () => {
  assert.equal(needsMotivation("in-progress", "done"), false);
  assert.equal(needsMotivation("in-progress", "blocked"), true);
  assert.equal(needsMotivation("in-progress", "canceled"), true);
  assert.equal(needsMotivation("done", "planned"), true);
  assert.equal(needsMotivation("planned", "planned"), false);
});

test("needsMotivation requires motivation for a forced →done transition only", () => {
  assert.equal(needsMotivation("in-progress", "done", true), true);
  assert.equal(needsMotivation("in-progress", "done", false), false);
});
