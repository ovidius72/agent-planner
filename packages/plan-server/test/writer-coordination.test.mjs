import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { cleanupFixtures, packageDist } from "../../../test/helpers/fixtures.mjs";
import { closeServerFixture, cleanupServerFixtures, startServerFixture } from "../../../test/helpers/server-fixture.mjs";

const SERVER_URL = pathToFileURL(packageDist("plan-server")).href;
const CHILD_SERVER_SCRIPT = `
  import { writeFile } from "node:fs/promises";
  const { serve } = await import(process.env.SERVER_URL);
  const handle = await serve({
    planRoot: process.env.PLAN_ROOT,
    host: "127.0.0.1",
    port: 0,
    staticDir: "",
    quiet: true,
  });
  await writeFile(process.env.URL_FILE, handle.url, "utf8");
  const stop = async () => {
    await handle.close();
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
`;

const LONG_DESCRIPTION = "src/writer-coordination.test.mjs:1 verifies that two independent dynamic-port planner servers preserve linked phase writes under one root transaction.";

after(async () => {
  await cleanupServerFixtures();
  await cleanupFixtures();
});

async function waitForServerUrl(path, timeoutMs = 10_000) {
  const started = Date.now();
  for (;;) {
    try {
      const value = await readFile(path, "utf8");
      if (value.startsWith("http://") || value.startsWith("https://")) return value;
    } catch {
      // The child has not created the readiness file yet.
    }
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for a server URL in ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function startSecondaryServer(planRoot, urlFile) {
  const child = spawn(process.execPath, ["--input-type=module", "--eval", CHILD_SERVER_SCRIPT], {
    env: { ...process.env, SERVER_URL, PLAN_ROOT: planRoot, URL_FILE: urlFile },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const exited = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => code === 0 || signal === "SIGTERM" || signal === "SIGINT" ? resolve() : reject(new Error(`Secondary server exited ${code ?? signal}: ${stderr}`)));
  });
  return { child, exited };
}

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Planner-Source": "web-ui" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  return { status: response.status, body: result };
}

async function createPhase(baseUrl, featureId, title) {
  const result = await postJson(baseUrl, "/phases", { title, featureId, description: LONG_DESCRIPTION });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body;
}

test("normal and development-style servers on dynamic ports serialize one planner root", async () => {
  const primary = await startServerFixture({ name: "server-writer-collision" });
  const urlFile = join(primary.root, "secondary-server-url");
  const secondary = startSecondaryServer(primary.planRoot, urlFile);
  const secondaryUrl = await waitForServerUrl(urlFile);
  const feature = (await primary.store.loadFeatures()).features[0];
  assert.ok(feature);

  try {
    const [primaryPhase] = await Promise.all([
      createPhase(primary.handle.url, feature.id, "Primary server phase"),
      createPhase(secondaryUrl, feature.id, "Development server phase"),
    ]);

    const phases = (await primary.store.loadAllPhases()).filter((phase) => phase.title.endsWith("server phase"));
    assert.equal(phases.length, 2);
    assert.equal(new Set(phases.map((phase) => phase.priority)).size, 2, "nextPriority allocation must be serialized");
    const persistedFeature = (await primary.store.loadFeatures()).features.find((entry) => entry.id === feature.id);
    assert.ok(persistedFeature);
    assert.ok(phases.every((phase) => persistedFeature.phaseIds.includes(phase.id)), "both cross-process feature links must persist");

    await primary.store.updateFeatures((document) => {
      const current = document.features.find((entry) => entry.id === feature.id);
      if (current) current.contextReady = true;
      return document;
    });
    await primary.store.updatePhase(primaryPhase.id, (phase) => ({ ...phase, contextReady: true }));
    const [firstTask, secondTask] = await Promise.all([
      postJson(primary.handle.url, `/phases/${primaryPhase.id}/tasks`, { title: "Primary start candidate", description: LONG_DESCRIPTION }),
      postJson(secondaryUrl, `/phases/${primaryPhase.id}/tasks`, { title: "Secondary start candidate", description: LONG_DESCRIPTION }),
    ]);
    assert.equal(firstTask.status, 201, JSON.stringify(firstTask.body));
    assert.equal(secondTask.status, 201, JSON.stringify(secondTask.body));
    const createdTasks = (await primary.store.loadPhase(primaryPhase.id)).tasks.filter((task) => task.title.endsWith("start candidate"));
    assert.equal(createdTasks.length, 2);
    assert.equal(new Set(createdTasks.map((task) => task.priority)).size, 2, "concurrent task priority allocation must be serialized");

    const starts = await Promise.all([
      postJson(primary.handle.url, `/tasks/${firstTask.body.id}/start`, {}),
      postJson(secondaryUrl, `/tasks/${secondTask.body.id}/start`, {}),
    ]);
    assert.deepEqual(starts.map((result) => result.status).sort((left, right) => left - right), [200, 409]);
    const active = (await primary.store.loadAllPhases()).flatMap((phase) => phase.tasks).filter((task) => task.status === "in-progress");
    assert.equal(active.length, 1, "the root transaction must preserve the single-active-task invariant");
  } finally {
    secondary.child.kill("SIGTERM");
    await secondary.exited;
    await closeServerFixture(primary);
  }
});
