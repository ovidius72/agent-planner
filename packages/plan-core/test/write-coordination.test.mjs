import { after, test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PlanStore, PlanWriterBusyError } from "../dist/index.js";
import { cleanupFixtures, createPlannerFixture, packageDist } from "../../../test/helpers/fixtures.mjs";

after(async () => {
  await cleanupFixtures();
});

const CORE_URL = pathToFileURL(packageDist("plan-core")).href;
const CHILD_SCRIPT = `
  import { writeFile } from "node:fs/promises";
  const { PlanStore } = await import(process.env.CORE_URL);
  const store = new PlanStore(process.env.PLAN_ROOT);
  await store.runBatch(async () => {
    await writeFile(process.env.READY_FILE, "ready", "utf8");
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.HOLD_MS)));
    await store.updateProject((project) => ({ ...project, description: process.env.DESCRIPTION }));
  });
`;

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

function startHoldingWriter(planRoot, readyFile, holdMs = 400) {
  const child = spawn(process.execPath, ["--input-type=module", "--eval", CHILD_SCRIPT], {
    env: {
      ...process.env,
      CORE_URL,
      PLAN_ROOT: planRoot,
      READY_FILE: readyFile,
      HOLD_MS: String(holdMs),
      DESCRIPTION: "written by the holding process",
    },
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

test("root write transactions serialize cross-process mutations while reads remain available", async () => {
  const fixture = await createPlannerFixture({ name: "root-writer-serialization", seed: "empty" });
  const readyFile = join(fixture.root, "writer-ready");
  const writer = startHoldingWriter(fixture.planRoot, readyFile, 450);
  await waitForFile(readyFile);

  const readStarted = Date.now();
  const duringWrite = await fixture.store.loadProject();
  assert.equal(duringWrite.name, "root-writer-serialization");
  assert.ok(Date.now() - readStarted < 200, "read-only access should not wait for the writer transaction");

  const writeStarted = Date.now();
  await fixture.store.updateProject((project) => ({ ...project, goal: "written by the waiting process" }));
  assert.ok(Date.now() - writeStarted >= 300, "the second writer should wait for the cross-process transaction");
  await writer.exited;

  const persisted = await fixture.store.loadProject();
  assert.equal(persisted.description, "written by the holding process");
  assert.equal(persisted.goal, "written by the waiting process");
  await assert.rejects(access(join(fixture.planRoot, ".local", "locks", "writer.lock")));
});

test("writer contention returns typed diagnostics without blocking read-only access", async () => {
  const fixture = await createPlannerFixture({ name: "root-writer-busy", seed: "empty" });
  const readyFile = join(fixture.root, "writer-ready");
  const writer = startHoldingWriter(fixture.planRoot, readyFile, 350);
  await waitForFile(readyFile);

  const previousTimeout = process.env.AGENT_PLAN_WRITE_LOCK_TIMEOUT_MS;
  const previousRetry = process.env.AGENT_PLAN_WRITE_LOCK_RETRY_MS;
  process.env.AGENT_PLAN_WRITE_LOCK_TIMEOUT_MS = "60";
  process.env.AGENT_PLAN_WRITE_LOCK_RETRY_MS = "10";
  try {
    await assert.rejects(
      fixture.store.updateProject((project) => ({ ...project, goal: "must not persist" })),
      (error) => {
        assert.ok(error instanceof PlanWriterBusyError);
        assert.equal(error.code, "PLAN_WRITER_BUSY");
        assert.equal(error.details.errorCode, "PLAN_WRITER_BUSY");
        assert.equal(error.details.planRoot, fixture.planRoot);
        assert.ok(error.details.owner?.pid > 0);
        assert.match(error.message, /Read-only operations remain available/);
        return true;
      },
    );
    const readable = await fixture.store.loadProject();
    assert.equal(readable.goal, "");
  } finally {
    if (previousTimeout === undefined) delete process.env.AGENT_PLAN_WRITE_LOCK_TIMEOUT_MS;
    else process.env.AGENT_PLAN_WRITE_LOCK_TIMEOUT_MS = previousTimeout;
    if (previousRetry === undefined) delete process.env.AGENT_PLAN_WRITE_LOCK_RETRY_MS;
    else process.env.AGENT_PLAN_WRITE_LOCK_RETRY_MS = previousRetry;
    await writer.exited;
  }
});

test("concurrent contenders recover one dead owner without deleting the new writer", async () => {
  const fixture = await createPlannerFixture({ name: "root-writer-recovery-race", seed: "empty" });
  const lockPath = join(fixture.planRoot, ".local", "locks", "writer.lock");
  await mkdir(lockPath, { recursive: true });
  await writeFile(join(lockPath, "owner.json"), JSON.stringify({
    token: "dead-owner",
    pid: 999_999,
    hostname: hostname(),
    cwd: fixture.root,
    acquiredAt: "2020-01-01T00:00:00.000Z",
  }), "utf8");

  await Promise.all([
    fixture.store.updateProject((project) => ({ ...project, goal: "first recovered write" })),
    fixture.store.updateProject((project) => ({ ...project, description: "second recovered write" })),
  ]);

  const persisted = await fixture.store.loadProject();
  assert.equal(persisted.goal, "first recovered write");
  assert.equal(persisted.description, "second recovered write");
  await assert.rejects(stat(lockPath));
  await assert.rejects(stat(join(fixture.planRoot, ".local", "locks", "writer-recovery.lock")));
});

test("stale remote writer ownership is recovered before the next mutation", async () => {
  const fixture = await createPlannerFixture({ name: "root-writer-stale", seed: "empty" });
  const lockPath = join(fixture.planRoot, ".local", "locks", "writer.lock");
  await mkdir(lockPath, { recursive: true });
  await writeFile(join(lockPath, "owner.json"), JSON.stringify({
    token: "dead-remote-owner",
    pid: process.pid,
    hostname: "unreachable-remote-host",
    cwd: fixture.root,
    acquiredAt: "2020-01-01T00:00:00.000Z",
  }), "utf8");
  const old = new Date(Date.now() - 60_000);
  await utimes(lockPath, old, old);

  await fixture.store.updateProject((project) => ({ ...project, goal: "recovered" }));
  assert.equal((await fixture.store.loadProject()).goal, "recovered");
  await assert.rejects(stat(lockPath));
});
