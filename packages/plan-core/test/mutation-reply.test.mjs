/**
 * T417 (P104/F005) — Pin the size of a mutation result.
 *
 * Before this task every adapter hand-built `{ ...entity, updated: true }`.
 * Measured against this repository's own planner directory: a one-field
 * update returned 139,805 characters on phase P104 and 33,499 on task T405.
 * Nothing failed, so nothing noticed.
 *
 * These tests build their fixtures in memory. They read no planner directory.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMutationReply,
  longTextFieldLimitNotice,
  MUTATION_ECHO_MAX_FIELD_CHARS,
  MUTATION_REPLY_MAX_CHARS,
  PLANNER_LONG_TEXT_FIELD_MAX_CHARS,
} from "../dist/index.js";

const size = (reply) => JSON.stringify(reply.structured).length;

/** A task the size of the worst real one: T405, 16,170-character description. */
function hugeDescription() {
  return "Diagnosing an oversized payload costs more context than the payload did. ".repeat(230);
}

test("a one-field update stays far under the ceiling even on the worst real entity", () => {
  const reply = buildMutationReply({
    identity: { entity: "phase", ref: "P104(F005)", id: "8f778bbb", shortId: "7QVCN", title: "Stop planner tools destroying and eliding state they report as intact", status: "in-progress" },
    operation: "update",
    updatedFields: ["status"],
    changedValues: { status: "in-progress", description: hugeDescription(), tasks: new Array(13).fill({ title: "x".repeat(400) }) },
    readBackCommand: "planner-phase-show P104(F005) full=true",
  });

  assert.ok(size(reply) < MUTATION_REPLY_MAX_CHARS, `structured payload was ${size(reply)}`);
  // The real regression: fields the caller did not change never travel, no
  // matter how large the entity is.
  assert.deepEqual(Object.keys(reply.structured.changed), ["status"]);
  assert.equal(reply.structured.description, undefined);
  assert.equal(reply.structured.tasks, undefined);
  assert.equal(reply.structured.phase, undefined);
});

test("mutation-integrity fields keep their exact shape", () => {
  const update = buildMutationReply({
    identity: { entity: "task", ref: "P104(F005)/T417" },
    operation: "update",
    updatedFields: ["status", "priority"],
  });
  assert.equal(update.structured.updated, true);
  assert.equal(update.structured.discussed, undefined);
  assert.deepEqual(update.structured.updatedFields, ["status", "priority"]);

  const discuss = buildMutationReply({
    identity: { entity: "feature", ref: "F005" },
    operation: "discuss",
    updatedFields: ["description"],
  });
  assert.equal(discuss.structured.discussed, true);
  assert.equal(discuss.structured.updated, undefined);
});

test("a changed long field is previewed with its true length, never echoed whole", () => {
  const description = hugeDescription();
  const reply = buildMutationReply({
    identity: { entity: "task", ref: "P104(F005)/T417", title: "Bound tool results" },
    operation: "update",
    updatedFields: ["description"],
    changedValues: { description },
  });

  assert.ok(size(reply) < MUTATION_REPLY_MAX_CHARS, `structured payload was ${size(reply)}`);
  const echoed = reply.structured.changed.description;
  assert.equal(echoed.truncated, true);
  assert.equal(echoed.fullLength, description.length);
  assert.ok(echoed.preview.length <= MUTATION_ECHO_MAX_FIELD_CHARS);
  assert.deepEqual(reply.structured.truncatedFields, ["description"]);
  // Cut at a word boundary, like every other truncation in the project.
  assert.ok(!echoed.preview.endsWith(" "));
});

test("a short changed field travels whole, so the caller can confirm what landed", () => {
  const reply = buildMutationReply({
    identity: { entity: "task", ref: "P104(F005)/T417" },
    operation: "update",
    updatedFields: ["title", "status"],
    changedValues: { title: "Bound tool results and state payload limits before a call fails", status: "in-progress" },
  });
  assert.equal(reply.structured.changed.title, "Bound tool results and state payload limits before a call fails");
  assert.equal(reply.structured.changed.status, "in-progress");
  assert.equal(reply.structured.truncatedFields, undefined);
});

test("a large array degrades to a count, never to half an array read as whole", () => {
  const checklist = new Array(60).fill(null).map((_, index) => ({ id: `c${index}`, title: `Step ${index} `.repeat(12), checked: index % 2 === 0 }));
  const reply = buildMutationReply({
    identity: { entity: "task", ref: "P104(F005)/T417" },
    operation: "update",
    updatedFields: ["checklist"],
    changedValues: { checklist },
  });
  assert.equal(reply.structured.changed.checklist.count, 60);
  assert.equal(reply.structured.changed.checklist.truncated, true);
  assert.equal(Array.isArray(reply.structured.changed.checklist), false);
});

test("diagnostics survive the trim; they are the reason to read the result", () => {
  const reply = buildMutationReply({
    identity: { entity: "task", ref: "P104(F005)/T418" },
    operation: "update",
    updatedFields: ["description"],
    changedValues: { description: hugeDescription() },
    extras: {
      descriptionFreshness: { diagnostics: [{ ownerRef: "P104(F005)", state: "stale" }] },
      staleParentRefs: ["P104(F005)"],
      checklistLostTicks: ["Add the regression"],
    },
    notices: ["⚠️ Lost tick on 1 checklist item."],
  });
  assert.deepEqual(reply.structured.staleParentRefs, ["P104(F005)"]);
  assert.deepEqual(reply.structured.checklistLostTicks, ["Add the regression"]);
  assert.ok(reply.structured.descriptionFreshness);
  assert.match(reply.text, /Lost tick/);
});

test("what does not fit the budget is named, not silently dropped", () => {
  const changedValues = {};
  const updatedFields = [];
  for (let index = 0; index < 12; index += 1) {
    const field = `field${index}`;
    updatedFields.push(field);
    changedValues[field] = "x".repeat(MUTATION_ECHO_MAX_FIELD_CHARS - 1);
  }
  const reply = buildMutationReply({
    identity: { entity: "task", ref: "P104(F005)/T417" },
    operation: "update",
    updatedFields,
    changedValues,
  });

  assert.ok(size(reply) < MUTATION_REPLY_MAX_CHARS, `structured payload was ${size(reply)}`);
  assert.ok(reply.structured.omittedValues.length > 0);
  // Every field is still accounted for: echoed, or named as omitted.
  const accounted = [...Object.keys(reply.structured.changed), ...reply.structured.omittedValues];
  assert.deepEqual(accounted.sort(), updatedFields.slice().sort());
  // And updatedFields itself is never trimmed — integrity checking reads it.
  assert.deepEqual(reply.structured.updatedFields, updatedFields);
});

test("the reply carries the canonical ref and the command for the rest", () => {
  const reply = buildMutationReply({
    identity: { entity: "task", ref: "P104(F005)/T417", id: "af8bd80c", shortId: "QFYXV" },
    operation: "update",
    updatedFields: ["status"],
    readBackCommand: "planner-task-show P104(F005)/T417 full=true",
  });
  assert.equal(reply.structured.ref, "P104(F005)/T417");
  assert.equal(reply.structured.readBack, "planner-task-show P104(F005)/T417 full=true");
});

test("a value the caller did not change is never echoed, even when handed one", () => {
  const reply = buildMutationReply({
    identity: { entity: "task", ref: "P104(F005)/T417" },
    operation: "update",
    updatedFields: ["status"],
    changedValues: { status: "done", description: "not touched by this call" },
  });
  assert.deepEqual(Object.keys(reply.structured.changed), ["status"]);
});

test("the long-text limit is stated in words a tool description can carry", () => {
  const notice = longTextFieldLimitNotice("description");
  assert.match(notice, /12,000/);
  assert.match(notice, /descriptionRef/);
  assert.match(notice, /\.planner\/docs\//);
  assert.equal(PLANNER_LONG_TEXT_FIELD_MAX_CHARS, 12_000);
});
