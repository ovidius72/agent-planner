import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createPlannerFixture, readPlanSnapshot, cleanupFixtures } from "./helpers/fixtures.mjs";
import {
  normalizeToolResult,
  normalizeHttpResult,
  normalizeCoreResult,
  normalizePersistedSnapshot,
  assertScenarioExpectations,
} from "./helpers/runner.mjs";

after(async () => {
  await cleanupFixtures();
});

test("normalizeToolResult merges Pi details and extracts canonical refs/status", () => {
  const normalized = normalizeToolResult({
    content: [{ type: "text", text: "✅ Task started: P001(F001)/T001 — Implement login (in-progress)" }],
    details: {
      status: "in-progress",
      taskRef: "P001(F001)/T001",
      phaseRef: "P001(F001)",
    },
  });

  assert.equal(normalized.ok, true);
  assert.equal(normalized.status, "in-progress");
  assert.equal(normalized.reference, "P001(F001)/T001");
  assert.deepEqual(normalized.data, {
    status: "in-progress",
    taskRef: "P001(F001)/T001",
    phaseRef: "P001(F001)",
  });
  assert.ok(normalized.references.includes("P001(F001)"));
});

test("normalizeToolResult classifies semantic not-found failures from tool text", () => {
  const normalized = normalizeToolResult({
    isError: true,
    content: [{ type: "text", text: "Task not found: P999(F999)/T999" }],
  });

  assert.equal(normalized.ok, false);
  assert.equal(normalized.errorCategory, "not_found");
  assert.match(normalized.error, /Task not found/);
  assert.equal(normalized.reference, "P999(F999)/T999");
});

test("normalizeHttpResult classifies validation failures and preserves JSON payloads", async () => {
  const normalized = await normalizeHttpResult({
    status: 400,
    async text() {
      return JSON.stringify({ error: "title required", field: "title" });
    },
  });

  assert.equal(normalized.ok, false);
  assert.equal(normalized.errorCategory, "validation");
  assert.equal(normalized.error, "title required");
  assert.deepEqual(normalized.data, { error: "title required", field: "title" });
});

test("normalizePersistedSnapshot converts UUID links to composite refs across plan + resume state", async () => {
  const full = await createPlannerFixture({ name: "normalize-full", seed: "full" });
  const fullSnapshot = normalizePersistedSnapshot(await readPlanSnapshot(full.planRoot));
  assert.equal(fullSnapshot.features[0].ref, "F001");
  const authDesign = fullSnapshot.phases.find((phase) => phase.ref === "P001(F001)");
  assert.ok(authDesign, "expected normalized Auth design phase");
  assert.equal(authDesign.tasks[1].ref, "T002(P001/F001)");
  assert.deepEqual(fullSnapshot.requirements[0].linkedPhaseRefs, ["P001(F001)"]);
  assert.equal(fullSnapshot.handoffArchive.length, 1);
  assert.equal(fullSnapshot.handoffArchive[0].firstLine, "# Payments implement handoff");

  const resumeFixture = await createPlannerFixture({ name: "normalize-resume", seed: "resume-needed" });
  const resumeSnapshot = normalizePersistedSnapshot(await readPlanSnapshot(resumeFixture.planRoot));
  assert.equal(resumeSnapshot.resume.currentFeatureRef, "F001");
  assert.equal(resumeSnapshot.resume.currentPhaseRef, "P001(F001)");
  assert.equal(resumeSnapshot.resume.currentTaskRef, "T001(P001/F001)");
  assert.deepEqual(resumeSnapshot.resume.inProgressTaskRefs, ["T001(P001/F001)"]);
});

test("assertScenarioExpectations supports errorCategory/status/reference/text/snapshot contracts", async () => {
  const fixture = await createPlannerFixture({ name: "normalize-assertions", seed: "resume-needed" });
  const planSnapshot = await readPlanSnapshot(fixture.planRoot);
  const normalized = normalizeCoreResult({
    ok: false,
    error: "Task not found: P999(F999)/T999",
    text: "Resume context missing. Web UI: http://127.0.0.1:56321",
    data: {
      status: "paused",
      taskRef: "P999(F999)/T999",
      planSnapshot,
    },
  });

  await assertScenarioExpectations(
    {
      id: "t253.normalized.contract",
      harnesses: ["core"],
      expects: {
        ok: false,
        errorMatch: /Task not found/,
        errorCategory: "not_found",
        status: "paused",
        reference: /P999\(F999\)\/T999/,
        textIncludes: [/Web UI:/, "Resume context"],
        snapshot: {
          project: (project) => project?.name?.includes("normalize-assertions"),
          resume: (resume) => resume?.currentTaskRef === "T001(P001/F001)",
        },
      },
    },
    normalized,
    {},
  );
});
