/**
 * T413 (P104/F005) — Replacing a task checklist must never silently drop
 * tick state.
 *
 * `replaceChecklist` (packages/plan-core/src/checklist.ts) rebuilds a
 * checklist from plain title strings while carrying over `checked` state
 * from the items being replaced. Two passes: exact trimmed title match
 * (order-independent, each surviving item consumed at most once), then a
 * positional fallback restricted to equal-length lists so a rename keeps
 * its tick without letting an insertion or deletion shift a tick onto a
 * neighbour. Anything still unmatched is reported in `lostTicks` rather
 * than dropped in silence.
 *
 * These tests build their fixtures in memory; they read no planner
 * directory.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { replaceChecklist } from "../dist/index.js";
import { createChecklistItemId } from "../dist/naming.js";

const TASK_ID = "T413-test-task";

function item(number, title, checked) {
  return { id: createChecklistItemId(TASK_ID, number, title), number, title, checked };
}

test("editing a title keeps the tick when the list length is unchanged (the reported failure)", () => {
  const existing = [item(1, "Write tests", true), item(2, "Ship it", false)];
  const result = replaceChecklist(existing, ["Write regression tests", "Ship it"], TASK_ID);
  assert.equal(result.items[0].title, "Write regression tests");
  assert.equal(result.items[0].checked, true, "renamed item at the same position should keep its tick");
  assert.equal(result.items[1].checked, false);
  assert.deepEqual(result.lostTicks, []);
});

test("reordering the list keeps every tick (order-independent exact match)", () => {
  const existing = [item(1, "Alpha", true), item(2, "Beta", false), item(3, "Gamma", true)];
  const result = replaceChecklist(existing, ["Gamma", "Alpha", "Beta"], TASK_ID);
  const byTitle = Object.fromEntries(result.items.map((i) => [i.title, i.checked]));
  assert.equal(byTitle.Gamma, true);
  assert.equal(byTitle.Alpha, true);
  assert.equal(byTitle.Beta, false);
  assert.deepEqual(result.lostTicks, []);
});

test("duplicate titles carry over one tick each and do not multiply", () => {
  const existing = [item(1, "Review", true), item(2, "Review", false)];
  const result = replaceChecklist(existing, ["Review", "Review"], TASK_ID);
  const checkedCount = result.items.filter((i) => i.checked).length;
  assert.equal(checkedCount, 1, "only one of the two duplicate titles should carry a tick");
  assert.deepEqual(result.lostTicks, []);
});

test("an insertion does not shift a tick onto a neighbour", () => {
  const existing = [item(1, "First", true), item(2, "Second", false)];
  const result = replaceChecklist(existing, ["New first", "First", "Second"], TASK_ID);
  // Length changed (2 -> 3), so positional fallback must not run.
  assert.equal(result.items[0].title, "New first");
  assert.equal(result.items[0].checked, false, "the inserted item must not inherit a neighbour's tick");
  assert.equal(result.items[1].title, "First");
  assert.equal(result.items[1].checked, true, "the exact-title match for 'First' must still carry its tick");
  assert.equal(result.items[2].checked, false);
  assert.deepEqual(result.lostTicks, []);
});

test("a deletion does not shift a tick onto a neighbour", () => {
  const existing = [item(1, "First", true), item(2, "Second", true), item(3, "Third", false)];
  const result = replaceChecklist(existing, ["First", "Third"], TASK_ID);
  // Length changed (3 -> 2), so positional fallback must not run; only exact
  // title matches carry over.
  assert.equal(result.items[0].title, "First");
  assert.equal(result.items[0].checked, true);
  assert.equal(result.items[1].title, "Third");
  assert.equal(result.items[1].checked, false, "'Third' was never ticked and must not inherit 'Second's tick");
  assert.deepEqual(result.lostTicks, ["Second"]);
});

test("an empty array clears the checklist deliberately and reports every lost tick", () => {
  const existing = [item(1, "Alpha", true), item(2, "Beta", true), item(3, "Gamma", false)];
  const result = replaceChecklist(existing, [], TASK_ID);
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.lostTicks.sort(), ["Alpha", "Beta"]);
});

test("a task with no existing checklist starts every new item unchecked with no lost ticks", () => {
  const result = replaceChecklist([], ["First", "Second"], TASK_ID);
  assert.equal(result.items.length, 2);
  assert.ok(result.items.every((i) => i.checked === false));
  assert.deepEqual(result.lostTicks, []);
});

test("a same-length rename carries the tick positionally (no loss)", () => {
  const existing = [item(1, "Ticked", true), item(2, "Untouched", false)];
  const result = replaceChecklist(existing, ["Renamed", "Untouched"], TASK_ID);
  assert.equal(result.items[0].title, "Renamed");
  assert.equal(result.items[0].checked, true, "position 0 carries 'Ticked's tick since the list length is unchanged");
  assert.deepEqual(result.lostTicks, []);
});

test("an exact match to an unticked item is not overwritten by a stray tick from its new position", () => {
  // Equal length (2 -> 2). "Ship" exactly matches the existing unchecked
  // "Ship" (which sits at index 1), correctly carrying checked=false. That
  // must stand even though index 0 in the new list — where "Ship" now
  // lands — used to hold a *ticked* item ("Review"). The positional
  // fallback exists only for titles with no exact match at all; it must
  // never override a real match's result, ticked or not.
  const existing = [item(1, "Review", true), item(2, "Ship", false)];
  const result = replaceChecklist(existing, ["Ship", "Brand new"], TASK_ID);
  assert.equal(result.items[0].title, "Ship");
  assert.equal(result.items[0].checked, false, "'Ship' was unticked and its exact match must not be overwritten by Review's stale position-0 tick");
  assert.equal(result.items[1].checked, false);
  assert.deepEqual(result.lostTicks, ["Review"], "'Review's tick has nowhere to go and must be reported, not silently reassigned to 'Ship'");
});

test("lostTicks is reported, not silent, when an exact title match elsewhere strands a ticked item's position", () => {
  // Equal length (2 -> 2), so positional fallback is in play. "B" moves to
  // position 0 by exact title match, consuming existing index 1 in the
  // process. That leaves existing index 0 ("A", ticked) unclaimed: the
  // positional pass only ever looks at existing[index] for the cleanTitle
  // at that same index, and the cleanTitle at index 0 already carried its
  // tick from "B"'s exact match, so nothing revisits existing index 0.
  const existing = [item(1, "A", true), item(2, "B", true)];
  const result = replaceChecklist(existing, ["B", "C"], TASK_ID);
  assert.equal(result.items[0].title, "B");
  assert.equal(result.items[0].checked, true, "'B' carries its own tick via exact title match");
  assert.equal(result.items[1].title, "C");
  assert.equal(result.items[1].checked, false, "'C' is a genuinely new item");
  assert.deepEqual(result.lostTicks, ["A"], "'A' was ticked and its title is gone; the loss must be reported, not silent");
});
