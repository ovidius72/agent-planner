/**
 * T326 (P078/F018) — ordered full-context read enforcement.
 *
 * The read state is module-level and shared across tests in the process, so
 * every test clears it first.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  contextReadEligibility,
  hasReadParents,
  hasReadRequirements,
  invalidateReads,
  markFeatureRead,
  markPhaseRead,
  markRequirementRead,
  markTaskRead,
  readTrackingSnapshot,
  requirementReadAdvisory,
} from "../dist/index.js";

const eligible = () => contextReadEligibility("T1", "P1", "F1");

test("a fresh read state denies lifecycle work until the task is read", () => {
  invalidateReads();
  assert.deepEqual(eligible(), { eligible: false, reason: "Read this exact task with full=true first." });
});

test("a task read does not imply its parent phase or feature", () => {
  invalidateReads();
  markTaskRead("T1", "P1", "F1");
  assert.deepEqual(eligible(), { eligible: false, reason: "After reading the task, read its parent phase with full=true." });
  assert.equal(hasReadParents("F1", "P1"), false);
});

test("the required context order is task, then phase, then feature", () => {
  invalidateReads();
  markFeatureRead("F1");
  markTaskRead("T1", "P1", "F1");
  markPhaseRead("P1", "F1");
  assert.deepEqual(eligible(), { eligible: false, reason: "After reading the phase, read its parent feature with full=true." });

  markFeatureRead("F1");
  assert.deepEqual(eligible(), { eligible: true, reason: "" });
});

test("reading another task, phase, or feature cannot satisfy the target lineage", () => {
  invalidateReads();
  markTaskRead("T2", "P1", "F1");
  markPhaseRead("P2", "F1");
  markFeatureRead("F2");
  assert.deepEqual(eligible(), { eligible: false, reason: "Read this exact task with full=true first." });
});

test("orphan phases require only task then phase", () => {
  invalidateReads();
  markTaskRead("T1", "P1");
  markPhaseRead("P1");
  assert.deepEqual(contextReadEligibility("T1", "P1"), { eligible: true, reason: "" });
});

test("hasReadParents remains a compatibility check for independent parent reads", () => {
  invalidateReads();
  markPhaseRead("P1", "F1");
  markFeatureRead("F1");
  assert.equal(hasReadParents("F1", "P1"), true);
});

test("invalidateReads clears context sequence and linked requirements", () => {
  invalidateReads();
  markTaskRead("T1", "P1", "F1");
  markPhaseRead("P1", "F1");
  markFeatureRead("F1");
  markRequirementRead("R1");
  assert.equal(eligible().eligible, true);
  assert.equal(hasReadRequirements(["R1"]), true);

  invalidateReads();
  assert.equal(eligible().eligible, false);
  assert.equal(hasReadRequirements(["R1"]), false);
  assert.deepEqual(readTrackingSnapshot(), { features: [], phases: [], requirements: [] });
});

test("requirements remain an independent explicit-read gate", () => {
  invalidateReads();
  assert.equal(requirementReadAdvisory([]), "", "empty list means nothing required");
  assert.notEqual(requirementReadAdvisory(["R1"]), "", "unread requirement warns");
  markRequirementRead("R1");
  assert.equal(hasReadRequirements(["R1"]), true);
  assert.equal(requirementReadAdvisory(["R1"]), "");
});
