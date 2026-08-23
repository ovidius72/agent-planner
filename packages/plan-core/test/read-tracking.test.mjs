/**
 * T307 (P072/F005) — tracked, deduplicated parent read-enforcement.
 *
 * The read set is module-level and shared across tests in the process, so each
 * test calls invalidateReads() first to stay isolated.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { markFeatureRead, markPhaseRead, markTaskRead, hasReadParents, invalidateReads, readTrackingSnapshot } from "../dist/index.js";

test("a fresh read set requires both feature and phase", () => {
  invalidateReads();
  assert.equal(hasReadParents("F1", "P1"), false);
});

test("reading a feature alone does NOT satisfy the phase requirement", () => {
  invalidateReads();
  markFeatureRead("F1");
  assert.equal(hasReadParents("F1", "P1"), false); // phase still missing
});

test("reading a phase records feature + phase, covering all its tasks", () => {
  invalidateReads();
  markPhaseRead("P1", "F1");
  assert.equal(hasReadParents("F1", "P1"), true);
  // a sibling task in the same phase is covered without re-reading
  markTaskRead("T2", "P1", "F1");
  assert.equal(hasReadParents("F1", "P1"), true);
});

test("reading a task records its parent feature + phase", () => {
  invalidateReads();
  markTaskRead("T1", "P1", "F1");
  assert.equal(hasReadParents("F1", "P1"), true);
});

test("a different phase/feature fails until it is read", () => {
  invalidateReads();
  markPhaseRead("P1", "F1");
  assert.equal(hasReadParents("F2", "P2"), false);
});

test("an orphan phase (no feature) only requires the phase", () => {
  invalidateReads();
  markPhaseRead("P1"); // no featureId
  assert.equal(hasReadParents(undefined, "P1"), true);
});

test("invalidateReads clears the set", () => {
  invalidateReads();
  markPhaseRead("P1", "F1");
  assert.equal(hasReadParents("F1", "P1"), true);
  invalidateReads();
  assert.equal(hasReadParents("F1", "P1"), false);
  assert.deepEqual(readTrackingSnapshot(), { features: [], phases: [] });
});
