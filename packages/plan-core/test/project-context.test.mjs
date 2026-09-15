import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import {
  PlanStore,
  RequirementSchema,
  createCompleteProjectContextDelivery,
  createProjectContextChunks,
  createProjectContextSnapshot,
  projectContextFingerprint,
  renderProjectContext,
  verifyProjectContextChunks,
} from "../dist/index.js";
import { packageDist } from "../../../test/helpers/fixtures.mjs";

const roots = [];
after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function setup(name = "Project context") {
  const root = await mkdtemp(join(tmpdir(), "project-context-"));
  roots.push(root);
  const planRoot = join(root, ".planner");
  const store = new PlanStore(planRoot);
  await store.init(name);
  return { store, planRoot };
}

const CORE_URL = pathToFileURL(packageDist("plan-core")).href;

async function waitForFile(path, timeoutMs = 2_000) {
  const started = Date.now();
  for (;;) {
    try {
      await access(path);
      return;
    } catch {
      if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${path}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

/** Spawn a child process that holds the plan-root write lock for holdMs. */
function startHoldingWriter(planRoot, readyFile, holdMs = 400) {
  const script = `
    import { writeFile } from "node:fs/promises";
    const { PlanStore } = await import(process.env.CORE_URL);
    const store = new PlanStore(process.env.PLAN_ROOT);
    await store.runBatch(async () => {
      await writeFile(process.env.READY_FILE, "ready", "utf8");
      await new Promise((resolve) => setTimeout(resolve, Number(process.env.HOLD_MS)));
      await store.updateProject((project) => ({ ...project, description: "written by the holding process" }));
    });
  `;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
    env: { ...process.env, CORE_URL, PLAN_ROOT: planRoot, READY_FILE: readyFile, HOLD_MS: String(holdMs) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const exited = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Writer child exited ${code}: ${stderr}`)));
  });
  return { child, exited };
}

const acceptedDecision = {
  id: "decision-project-context",
  title: "Keep project context lossless",
  decision: "Every project field must be delivered before the read is attested.",
  rationale: "Partial context causes incorrect agent decisions.",
  implementationNotes: "Use explicit completeness evidence.",
  acceptedAt: "2026-09-14T08:00:00.000Z",
};

const requirement = RequirementSchema.parse({
  id: "requirement-project-context",
  title: "Agents receive project context",
  description: "Agents can read every project Requirement at planner load.",
  linkedPhaseIds: ["phase-one"],
  macroTasks: [{
    id: "MT-001",
    title: "Deliver the context",
    description: "Preserve every canonical field.",
    status: "in-progress",
    createdAt: "2026-09-14T08:01:00.000Z",
    updatedAt: "2026-09-14T08:02:00.000Z",
  }],
  createdAt: "2026-09-14T08:00:00.000Z",
  updatedAt: "2026-09-14T08:02:00.000Z",
});

test("an empty project produces one complete canonical delivery", async () => {
  const { store } = await setup("Empty project context");
  const delivery = await store.loadProjectContextDelivery();

  assert.equal(delivery.evidence.status, "complete");
  assert.equal(delivery.evidence.complete, true);
  assert.equal(delivery.evidence.truncated, false);
  assert.equal(delivery.evidence.chunked, false);
  assert.equal(delivery.evidence.deliveredChunks, 1);
  assert.equal(delivery.chunks[0].status, "partial");
  assert.equal(delivery.chunks[0].complete, false);
  assert.equal(delivery.chunks[0].truncated, false);
  assert.equal(delivery.chunks[0].cursor, undefined);
  assert.equal(delivery.chunks[0].nextCursor, undefined);
  assert.equal(delivery.snapshot.project.name, "Empty project context");
  assert.deepEqual(delivery.snapshot.requirements, []);
  assert.deepEqual(delivery.snapshot.project.acceptedDecisions, []);
  assert.equal(projectContextFingerprint(delivery.snapshot), delivery.evidence.fingerprint);
});

test("the canonical snapshot and renderer include every project-context field", async () => {
  const { store } = await setup();
  await store.updateProject((project) => ({
    ...project,
    goal: "Deliver reliable planning context",
    description: "Short project description",
    descriptionRef: ".planner/docs/context.md",
    scope: ["Project loading"],
    outOfScope: ["Unrelated UI redesign"],
    technologies: ["TypeScript"],
    tools: ["pnpm"],
    contentLanguage: "English",
    chatLanguage: "Italian",
    projectGuidelines: { ...project.projectGuidelines, content: "Keep the core harness-agnostic." },
    acceptedDecisions: [acceptedDecision],
  }));
  await store.saveRequirements({ requirements: [requirement] });

  const delivery = await store.loadProjectContextDelivery(100_000);
  const text = renderProjectContext(delivery.snapshot);
  assert.equal(delivery.chunks.length, 1);
  assert.match(text, /Short project description/);
  assert.match(text, /\.planner\/docs\/context\.md/);
  assert.match(text, /Deliver reliable planning context/);
  assert.match(text, /Project loading/);
  assert.match(text, /Unrelated UI redesign/);
  assert.match(text, /TypeScript/);
  assert.match(text, /pnpm/);
  assert.match(text, /Keep the core harness-agnostic/);
  assert.match(text, /requirement-project-context/);
  assert.match(text, /MT-001/);
  assert.match(text, /decision-project-context/);
  assert.match(text, /Partial context causes incorrect agent decisions/);
  assert.equal("sessionInfo" in delivery.snapshot.requirements[0], false, "operational read metadata is excluded from content fingerprints");
});

test("oversized context reconstructs exactly and missing or tampered chunks never attest completeness", async () => {
  const { store } = await setup();
  await store.updateProject((project) => ({ ...project, description: "context ".repeat(700), acceptedDecisions: [acceptedDecision] }));
  await store.saveRequirements({ requirements: [requirement] });
  const project = await store.loadProject();
  const requirements = await store.loadRequirements();
  const snapshot = createProjectContextSnapshot(project, requirements);
  const chunks = createProjectContextChunks(snapshot, 256);

  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.content.length <= 256));
  assert.ok(chunks.every((chunk) => chunk.status === "partial" && !chunk.complete && chunk.truncated));
  assert.equal(chunks[0].cursor, `${chunks[0].fingerprint}:0`);
  assert.equal(chunks[0].nextCursor, `${chunks[0].fingerprint}:1`);
  assert.equal(chunks.at(-1).nextCursor, undefined);
  const reconstructed = verifyProjectContextChunks(chunks);
  assert.deepEqual(reconstructed.snapshot, snapshot);
  assert.equal(reconstructed.evidence.status, "complete");
  assert.equal(reconstructed.evidence.chunked, true);
  assert.equal(reconstructed.evidence.truncated, false);
  assert.throws(
    () => verifyProjectContextChunks(chunks.slice(0, -1)),
    (error) => error.code === "PROJECT_CONTEXT_DELIVERY_INCOMPLETE",
  );
  assert.throws(
    () => verifyProjectContextChunks([chunks[0], chunks[0], ...chunks.slice(2)]),
    (error) => error.code === "PROJECT_CONTEXT_DELIVERY_INCOMPLETE",
  );
  assert.throws(
    () => verifyProjectContextChunks([chunks[1], chunks[0], ...chunks.slice(2)]),
    (error) => error.code === "PROJECT_CONTEXT_DELIVERY_INCOMPLETE",
  );
  const tampered = chunks.map((chunk, index) => index === 1 ? { ...chunk, content: `${chunk.content}x` } : chunk);
  assert.throws(
    () => verifyProjectContextChunks(tampered),
    (error) => error.code === "PROJECT_CONTEXT_DELIVERY_INVALID",
  );
});

test("PlanStore records only a complete current delivery and detects later project or Requirement changes", async () => {
  const { store, planRoot } = await setup();
  await store.updateProject((project) => ({
    ...project,
    description: "Initial context",
    projectGuidelines: { ...project.projectGuidelines, content: "Read this guideline." },
    acceptedDecisions: [acceptedDecision],
  }));
  await store.saveRequirements({ requirements: [requirement] });
  const delivery = await store.loadProjectContextDelivery(180);

  await assert.rejects(
    store.recordProjectContextRead({ sessionId: "session-a", chunks: delivery.chunks.slice(0, -1) }),
    (error) => error.code === "PROJECT_CONTEXT_DELIVERY_INCOMPLETE",
  );
  assert.equal(await store.projectContextReadStateForSession("session-a"), "missing");

  await store.recordProjectContextRead({
    sessionId: "session-a",
    chunks: delivery.chunks,
    createdAt: "2026-09-14T09:00:00.000Z",
  });
  assert.equal(await store.projectContextReadStateForSession("session-a"), "valid");
  const projectAfterRead = await store.loadProject();
  const requirementsAfterRead = await store.loadRequirements();
  const persistedReadState = JSON.parse(await readFile(join(planRoot, ".local", "project-context-reads.json"), "utf8"));
  assert.equal(persistedReadState.sessionInfo[0].fingerprint, delivery.evidence.fingerprint);
  assert.equal(projectAfterRead.projectGuidelines.sessionInfo[0].sessionId, "session-a");
  assert.equal(requirementsAfterRead.requirements[0].sessionInfo[0].sessionId, "session-a");

  await store.updateProject((project) => ({ ...project, goal: "Changed after delivery" }));
  assert.equal(await store.projectContextReadStateForSession("session-a"), "stale");
  await assert.rejects(
    store.recordProjectContextRead({ sessionId: "session-b", chunks: delivery.chunks }),
    (error) => error.code === "PROJECT_CONTEXT_DELIVERY_STALE",
  );

  const refreshed = await store.loadProjectContextDelivery();
  await store.recordProjectContextRead({ sessionId: "session-a", chunks: refreshed.chunks });
  assert.equal(await store.projectContextReadStateForSession("session-a"), "valid");
  await store.updateRequirement(requirement.id, (current) => ({ ...current, description: "Changed Requirement", updatedAt: "2026-09-14T10:00:00.000Z" }));
  assert.equal(await store.projectContextReadStateForSession("session-a"), "stale");
});

test("legacy projects without project-context read state parse without rewriting authored content", async () => {
  const { store, planRoot } = await setup("Legacy project");
  const projectPath = join(planRoot, "project.json");
  const before = await readFile(projectPath, "utf8");

  const legacyStore = new PlanStore(planRoot);
  const loaded = await legacyStore.loadProject();
  assert.equal(loaded.name, "Legacy project");
  assert.equal(await legacyStore.projectContextReadStateForSession("legacy-session"), "missing");
  assert.equal(await readFile(projectPath, "utf8"), before);

  const delivery = createCompleteProjectContextDelivery(loaded, await store.loadRequirements());
  assert.equal(delivery.evidence.complete, true);
});

test("recordProjectContextRead routes writes through saveProject/saveRequirements: timestamp bumps and workDeviations never reach shared project.json", async () => {
  const { store, planRoot } = await setup("Attested project");
  await store.updateProject((project) => ({
    ...project,
    projectGuidelines: { ...project.projectGuidelines, content: "Read this guideline." },
  }));
  await store.saveRequirements({ requirements: [requirement] });

  const before = await store.loadManifest();
  const delivery = await store.loadProjectContextDelivery();

  // Simulate workDeviations having leaked into the shared project.json (the
  // defect this fix defends against, even though normal writes never put
  // them there post-migration). The project-context snapshot excludes
  // workDeviations, so this does not change the delivery's fingerprint.
  const projectPath = join(planRoot, "project.json");
  const onDiskBefore = JSON.parse(await readFile(projectPath, "utf8"));
  await writeFile(projectPath, JSON.stringify({
    ...onDiskBefore,
    workDeviations: [{
      id: "deviation-1",
      recommendedTaskId: "task-a",
      temporaryTaskId: "task-b",
      resumeTaskId: "task-a",
      reason: "test",
      snapshot: null,
      requestedBy: "agent",
      approvedBy: "user",
      state: "approved",
      createdAt: "2026-09-14T08:00:00.000Z",
    }],
  }), "utf8");

  await store.recordProjectContextRead({ sessionId: "session-timestamp", chunks: delivery.chunks });

  const after = await store.loadManifest();
  assert.notEqual(after.updatedAt, before.updatedAt, "recordProjectContextRead must bump the planner timestamp marker via saveProject");

  const onDiskAfter = JSON.parse(await readFile(projectPath, "utf8"));
  assert.deepEqual(onDiskAfter.workDeviations, [], "saveProject must strip workDeviations before they reach shared project.json");
});

test("loadProjectContextDelivery and projectContextReadStateForSession take no write lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-context-nolock-"));
  roots.push(root);
  const planRoot = join(root, ".planner");
  const store = new PlanStore(planRoot);
  await store.init("No-lock reads");

  const readyFile = join(root, "writer-ready");
  const writer = startHoldingWriter(planRoot, readyFile, 450);
  await waitForFile(readyFile);

  const deliveryStarted = Date.now();
  const delivery = await store.loadProjectContextDelivery();
  assert.equal(delivery.evidence.complete, true);
  assert.ok(Date.now() - deliveryStarted < 200, "loadProjectContextDelivery must not wait behind the plan-root write lock");

  const readStateStarted = Date.now();
  await store.projectContextReadStateForSession("session-nolock");
  assert.ok(Date.now() - readStateStarted < 200, "projectContextReadStateForSession must not wait behind the plan-root write lock");

  await writer.exited;
});
