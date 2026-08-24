import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { cleanupFixtures, readPlanSnapshot } from "./fixtures.mjs";
import { startServerFixture, closeServerFixture, request as serverRequest } from "./server-fixture.mjs";
import { startMcpFixture, closeMcpFixture, cleanupMcpFixtures, callTool } from "./mcp-fixture.mjs";
import { createPiHost, closePiHost, cleanupPiHosts } from "../../packages/pi-adapter/test/helpers/pi-host-fixture.mjs";
import { registerExecutor, normalizeCoreResult, normalizeHttpResult, normalizeToolResult } from "./runner.mjs";

const LONG_DESCRIPTION = "src/error-parity.ts:10 existing state and the concrete goal for cross-harness validation parity; include file refs and preserved behaviors so the description exceeds the 50-char minimum.";
const UNKNOWN_UUID = "00000000-0000-4000-8000-000000000000";
const NOW = "2026-01-01T00:00:00.000Z";

const json = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function plainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function attachSnapshot(planRoot, normalized, extraData = {}) {
  const planSnapshot = await readPlanSnapshot(planRoot);
  return normalizeCoreResult({
    ok: normalized.ok,
    error: normalized.error,
    text: normalized.text,
    data: {
      ...plainObject(normalized.data),
      ...extraData,
      planSnapshot,
    },
    raw: normalized.raw,
  });
}

async function normalizeApiCall(fixture, path, init, expectStatus, extraData = {}) {
  const result = await serverRequest(fixture, path, { ...init, expectStatus });
  const text = typeof result.body === "string" ? result.body : JSON.stringify(result.body ?? null);
  const normalized = await normalizeHttpResult({
    status: result.status,
    async text() {
      return text;
    },
  });
  return attachSnapshot(fixture.planRoot, normalized, extraData);
}

async function executeApiScenario(id, seed) {
  const fx = await startServerFixture({ name: `${id}-api`, seed });
  try {
    const feature = (await fx.store.loadFeatures()).features[0];
    const phase = (await fx.store.loadAllPhases())[0];
    switch (id) {
      case "create.feature.missingName":
        return await normalizeApiCall(fx, "/features", json({ description: LONG_DESCRIPTION }), 400);
      case "create.phase.missingTitle":
        return await normalizeApiCall(fx, "/phases", json({ featureId: feature.id }), 400);
      case "create.phase.missingFeature":
        return await normalizeApiCall(fx, "/phases", json({ title: "No feature" }), 400);
      case "create.phase.unknownFeature":
        return await normalizeApiCall(fx, "/phases", json({ title: "Ghost phase", featureId: UNKNOWN_UUID }), 404);
      case "create.task.missingTitle":
        return await normalizeApiCall(fx, `/phases/${phase.id}/tasks`, json({}), 400);
      case "create.task.unknownPhase":
        return await normalizeApiCall(fx, `/phases/${UNKNOWN_UUID}/tasks`, json({ title: "Ghost task" }), 404);
      case "create.requirement.missingTitle":
        return await normalizeApiCall(fx, "/requirements", json({
          id: randomUUID(),
          description: "",
          status: "planned",
          macroTasks: [],
          linkedPhaseIds: ["P001"],
          createdAt: NOW,
          updatedAt: NOW,
        }), 500);
      case "refs.unknown.notFound":
        return await normalizeApiCall(fx, `/tasks/${UNKNOWN_UUID}`, {}, 404);
      case "requirements.link.missingPhase":
        return await normalizeApiCall(fx, "/requirements", json({
          id: randomUUID(),
          title: "Broken requirement",
          description: "",
          status: "planned",
          macroTasks: [],
          linkedPhaseIds: ["P999"],
          createdAt: NOW,
          updatedAt: NOW,
        }), 400);
      case "requirements.link.unknownPhase":
        return await normalizeApiCall(fx, "/requirements", json({
          id: randomUUID(),
          title: "Broken requirement",
          description: "",
          status: "planned",
          macroTasks: [],
          linkedPhaseIds: [UNKNOWN_UUID],
          createdAt: NOW,
          updatedAt: NOW,
        }), 400);
      case "requirements.link.emptyList":
        return await normalizeApiCall(fx, "/requirements", json({
          id: randomUUID(),
          title: "Broken requirement",
          description: "",
          status: "planned",
          macroTasks: [],
          linkedPhaseIds: [],
          createdAt: NOW,
          updatedAt: NOW,
        }), 400);
      case "requirements.link.atomicity": {
        const requirementsPath = join(fx.planRoot, "requirements.json");
        const before = await readFile(requirementsPath, "utf8");
        const normalized = await normalizeApiCall(fx, "/requirements", json({
          id: randomUUID(),
          title: "Broken requirement",
          description: "",
          status: "planned",
          macroTasks: [],
          linkedPhaseIds: ["P999"],
          createdAt: NOW,
          updatedAt: NOW,
        }), 400);
        const after = await readFile(requirementsPath, "utf8");
        return await attachSnapshot(fx.planRoot, normalized, { unchanged: before === after });
      }
      case "lifecycle.motivation.required":
        return await normalizeApiCall(fx, `/tasks/${phase.tasks[0].id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phaseId: phase.id, status: "blocked" }),
        }, 400);
      default:
        throw new Error(`No API executor for ${id}`);
    }
  } finally {
    await closeServerFixture(fx);
  }
}

async function executeMcpScenario(id, seed) {
  const session = await startMcpFixture({ name: `${id}-mcp`, seed });
  try {
    let result;
    switch (id) {
      case "create.feature.missingName":
        result = await callTool(session, "planner-feature-add", { description: LONG_DESCRIPTION });
        break;
      case "create.phase.missingTitle":
        result = await callTool(session, "planner-phase-add", { feature: "F001", description: LONG_DESCRIPTION });
        break;
      case "create.phase.missingFeature":
        result = await callTool(session, "planner-phase-add", { title: "No feature", description: LONG_DESCRIPTION });
        break;
      case "create.phase.unknownFeature":
        result = await callTool(session, "planner-phase-add", { title: "Ghost phase", feature: "F999", description: LONG_DESCRIPTION });
        break;
      case "create.task.missingTitle":
        result = await callTool(session, "planner-task-add", { feature: "F001", phase: "P001", description: LONG_DESCRIPTION });
        break;
      case "create.task.unknownPhase":
        result = await callTool(session, "planner-task-add", { feature: "F001", phase: "P999", title: "Ghost task", description: LONG_DESCRIPTION });
        break;
      case "refs.unknown.notFound":
        result = await callTool(session, "planner-task-show", { task: "T999" });
        break;
      case "refs.ambiguous.rejected":
        await callTool(session, "planner-feature-add", { name: "Shared Ambiguous A", description: LONG_DESCRIPTION });
        await callTool(session, "planner-feature-add", { name: "Shared Ambiguous B", description: LONG_DESCRIPTION });
        result = await callTool(session, "planner-feature-show", { feature: "Shared" });
        break;
      case "handoff.write.genericTitle.rejected":
        result = await callTool(session, "planner-handoff-write", { phaseRef: "P001", title: "Handoff", content: "Body of the handoff.", confirmed: true });
        break;
      case "lifecycle.motivation.required":
        result = await callTool(session, "planner-task-update", { task: "T001", status: "blocked" });
        break;
      default:
        throw new Error(`No MCP executor for ${id}`);
    }
    return await attachSnapshot(session.planRoot, normalizeToolResult(result));
  } finally {
    await closeMcpFixture(session);
  }
}

async function safePiTool(host, name, params) {
  try {
    return await host.runTool(name, params);
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
  }
}

async function executePiScenario(id, seed) {
  const host = await createPiHost({ name: `${id}-pi`, seed });
  try {
    let result;
    switch (id) {
      case "create.feature.missingName":
        result = await safePiTool(host, "feature_create", { description: LONG_DESCRIPTION });
        break;
      case "create.phase.missingTitle":
        result = await safePiTool(host, "phase_create", { title: "", featureId: "F001", description: LONG_DESCRIPTION });
        break;
      case "create.phase.missingFeature":
        result = await safePiTool(host, "phase_create", { title: "No feature", description: LONG_DESCRIPTION });
        break;
      case "create.phase.unknownFeature":
        result = await safePiTool(host, "phase_create", { title: "Ghost phase", featureId: "F999", description: LONG_DESCRIPTION });
        break;
      case "create.task.missingTitle":
        result = await safePiTool(host, "task_create", { title: "", featureId: "F001", phaseId: "P001", description: LONG_DESCRIPTION });
        break;
      case "create.task.unknownPhase":
        result = await safePiTool(host, "task_create", { featureId: "F001", phaseId: "P999", title: "Ghost task", description: LONG_DESCRIPTION });
        break;
      case "create.requirement.missingTitle":
        result = await safePiTool(host, "requirement_create", { title: "", description: "", linkedPhaseIds: ["P001"] });
        break;
      case "refs.unknown.notFound":
        result = await safePiTool(host, "task_get", { taskId: "T999" });
        break;
      case "refs.ambiguous.rejected":
        await host.runTool("feature_create", { name: "Shared Ambiguous A", description: LONG_DESCRIPTION });
        await host.runTool("feature_create", { name: "Shared Ambiguous B", description: LONG_DESCRIPTION });
        result = await safePiTool(host, "feature_get", { featureId: "Shared" });
        break;
      case "requirements.link.missingPhase":
        result = await safePiTool(host, "requirement_create", { title: "Broken requirement", description: "", linkedPhaseIds: ["P999"] });
        break;
      case "requirements.link.unknownPhase":
        result = await safePiTool(host, "requirement_create", { title: "Broken requirement", description: "", linkedPhaseIds: [UNKNOWN_UUID] });
        break;
      case "requirements.link.emptyList":
        result = await safePiTool(host, "requirement_create", { title: "Broken requirement", description: "", linkedPhaseIds: [] });
        break;
      case "requirements.link.atomicity": {
        const requirementsPath = join(host.planRoot, "requirements.json");
        const before = await readFile(requirementsPath, "utf8");
        const raw = await safePiTool(host, "requirement_create", { title: "Broken requirement", description: "", linkedPhaseIds: ["P999"] });
        const normalized = await attachSnapshot(host.planRoot, normalizeToolResult(raw));
        const after = await readFile(requirementsPath, "utf8");
        return await attachSnapshot(host.planRoot, normalized, { unchanged: before === after });
      }
      case "handoff.write.genericTitle.rejected":
        result = await safePiTool(host, "handoff_write", { phaseRef: "P001", title: "Handoff", content: "Body of the handoff.", confirmed: true });
        break;
      case "lifecycle.motivation.required":
        result = await safePiTool(host, "task_update", { taskId: "T001", status: "blocked" });
        break;
      default:
        throw new Error(`No Pi executor for ${id}`);
    }
    return await attachSnapshot(host.planRoot, normalizeToolResult(result));
  } finally {
    await closePiHost(host);
  }
}

const apiIds = [
  "create.feature.missingName",
  "create.phase.missingTitle",
  "create.phase.missingFeature",
  "create.phase.unknownFeature",
  "create.task.missingTitle",
  "create.task.unknownPhase",
  "create.requirement.missingTitle",
  "refs.unknown.notFound",
  "requirements.link.missingPhase",
  "requirements.link.unknownPhase",
  "requirements.link.emptyList",
  "requirements.link.atomicity",
  "lifecycle.motivation.required",
];

const mcpIds = [
  "create.feature.missingName",
  "create.phase.missingTitle",
  "create.phase.missingFeature",
  "create.phase.unknownFeature",
  "create.task.missingTitle",
  "create.task.unknownPhase",
  "refs.unknown.notFound",
  "refs.ambiguous.rejected",
  "handoff.write.genericTitle.rejected",
  "lifecycle.motivation.required",
];

const piIds = [
  "create.feature.missingName",
  "create.phase.missingTitle",
  "create.phase.missingFeature",
  "create.phase.unknownFeature",
  "create.task.missingTitle",
  "create.task.unknownPhase",
  "create.requirement.missingTitle",
  "refs.unknown.notFound",
  "refs.ambiguous.rejected",
  "requirements.link.missingPhase",
  "requirements.link.unknownPhase",
  "requirements.link.emptyList",
  "requirements.link.atomicity",
  "handoff.write.genericTitle.rejected",
  "lifecycle.motivation.required",
];

export const parityCases = [
  { id: "create.feature.missingName", harnesses: ["api", "mcp", "pi"] },
  { id: "create.phase.missingTitle", harnesses: ["api", "mcp", "pi"] },
  { id: "create.phase.missingFeature", harnesses: ["api", "mcp", "pi"] },
  { id: "create.phase.unknownFeature", harnesses: ["api", "mcp", "pi"] },
  { id: "create.task.missingTitle", harnesses: ["api", "mcp", "pi"] },
  { id: "create.task.unknownPhase", harnesses: ["api", "mcp", "pi"] },
  { id: "create.requirement.missingTitle", harnesses: ["api", "pi"] },
  { id: "refs.unknown.notFound", harnesses: ["api", "mcp", "pi"] },
  { id: "refs.ambiguous.rejected", harnesses: ["mcp", "pi"], compareSnapshot: false },
  { id: "requirements.link.missingPhase", harnesses: ["api", "pi"] },
  { id: "requirements.link.unknownPhase", harnesses: ["api", "pi"] },
  { id: "requirements.link.emptyList", harnesses: ["api", "pi"] },
  { id: "requirements.link.atomicity", harnesses: ["api", "pi"] },
  { id: "handoff.write.genericTitle.rejected", harnesses: ["mcp", "pi"] },
  { id: "lifecycle.motivation.required", harnesses: ["api", "mcp", "pi"] },
];

export function registerErrorParityExecutors() {
  for (const id of apiIds) registerExecutor("api", id, (ctx) => executeApiScenario(id, ctx.scenario.fixture));
  for (const id of mcpIds) registerExecutor("mcp", id, (ctx) => executeMcpScenario(id, ctx.scenario.fixture));
  for (const id of piIds) registerExecutor("pi", id, (ctx) => executePiScenario(id, ctx.scenario.fixture));
}

export function comparableSnapshot(snapshot) {
  if (!snapshot) return snapshot;
  return {
    ...snapshot,
    project: snapshot.project ? { ...snapshot.project, name: "" } : snapshot.project,
    resume: snapshot.resume
      ? {
        ...snapshot.resume,
        updatedAt: "",
        nextStepsUpdatedAt: "",
      }
      : snapshot.resume,
  };
}

export function compareParityResults(results, harnesses, { compareSnapshot = true } = {}) {
  const baselineHarness = harnesses[0];
  const baseline = results[baselineHarness];
  const mismatches = [];
  for (const harness of harnesses.slice(1)) {
    const current = results[harness];
    if (current.ok !== baseline.ok) mismatches.push(`${harness}: ok mismatch (${current.ok} !== ${baseline.ok})`);
    if (current.errorCategory !== baseline.errorCategory) {
      mismatches.push(`${harness}: errorCategory mismatch (${current.errorCategory} !== ${baseline.errorCategory})`);
    }
    if (compareSnapshot) {
      try {
        assert.deepEqual(comparableSnapshot(current.snapshot), comparableSnapshot(baseline.snapshot));
      } catch {
        mismatches.push(`${harness}: normalized snapshot mismatch`);
      }
    }
  }
  return mismatches;
}

export async function cleanupErrorParityHarnesses() {
  await cleanupMcpFixtures();
  await cleanupPiHosts();
  await cleanupFixtures();
}
