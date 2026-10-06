/**
 * `serve --reuse` and `stop`: a program that owns a long-running server must be
 * able to find the one already running for a folder, and stop only the one it
 * is allowed to stop. Real processes, real HTTP, temp folders only.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { cleanupCliProcesses, plannerFixture, runCli, runCliAsync, startServe } from "./helpers/cli-process.mjs";
import { serve } from "../../plan-server/dist/index.js";

after(cleanupCliProcesses);

test("serve --reuse prints the running server's address and starts nothing", async () => {
  const cwd = await plannerFixture();
  const first = startServe(cwd, ["--port", "0", "--json"]);
  const running = JSON.parse(await first.firstLine);
  assert.equal(running.reused, false);

  const again = runCli(["serve", "--reuse", "--json"], { cwd, timeout: 10000 });
  assert.equal(again.status, 0, again.stderr);
  const reused = JSON.parse(again.stdout);
  assert.equal(reused.reused, true);
  assert.equal(reused.url, running.url);
  assert.equal(reused.port, running.port);
  assert.equal(reused.root, running.root);
  assert.equal(again.stdout.trim().split("\n").length, 1, "--json prints exactly one line");

  const text = runCli(["serve", "--reuse"], { cwd, timeout: 10000 });
  assert.match(text.stdout, /already running at http:\/\/127\.0\.0\.1:\d+/);
  first.child.kill("SIGTERM");
  await first.exited;
});

test("serve --reuse starts a server when none is running", async () => {
  const cwd = await plannerFixture();
  const started = startServe(cwd, ["--reuse", "--port", "0", "--json"]);
  const info = JSON.parse(await started.firstLine);
  assert.equal(info.reused, false);
  assert.ok(info.port > 0);
  assert.equal((await fetch(`${info.localUrl}/health`)).status, 200);
  started.child.kill("SIGTERM");
  await started.exited;
});

test("serve --reuse ignores a record left behind by a killed server", async () => {
  const cwd = await plannerFixture();
  const killed = startServe(cwd, ["--port", "0", "--json"]);
  await killed.firstLine;
  killed.child.kill("SIGKILL");
  await killed.exited;

  const started = startServe(cwd, ["--reuse", "--port", "0", "--json"]);
  assert.equal(JSON.parse(await started.firstLine).reused, false, "a dead server's record is not reused");
  started.child.kill("SIGTERM");
  await started.exited;
});

test("stop ends the server that serve started and removes its record", async () => {
  const cwd = await plannerFixture();
  const started = startServe(cwd, ["--port", "0", "--json"]);
  const info = JSON.parse(await started.firstLine);

  const stopped = await runCliAsync(["stop", "--json"], { cwd });
  assert.equal(stopped.status, 0, stopped.stderr);
  const result = JSON.parse(stopped.stdout);
  assert.equal(result.stopped, true);
  assert.equal(result.pid, started.child.pid);
  assert.equal((await started.exited).code, 0, "serve closes cleanly when stopped");
  await assert.rejects(fetch(`${info.localUrl}/health`), "the server no longer answers");
  const { existsSync } = await import("node:fs");
  assert.equal(existsSync(join(cwd, ".planner", ".local", "server.json")), false);
});

test("stop with nothing running exits 0 and says so", async () => {
  const cwd = await plannerFixture();
  const json = runCli(["stop", "--json"], { cwd });
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), { root: join(cwd, ".planner"), stopped: false, reason: "not-running" });
  assert.match(runCli(["stop"], { cwd }).stdout, /No planner server is running/);
});

test("stop never signals a server embedded in another program", async () => {
  const cwd = await plannerFixture();
  const embedded = await serve({ planRoot: join(cwd, ".planner"), port: 0, staticDir: "", quiet: true });
  try {
    const result = await runCliAsync(["stop", "--json"], { cwd });
    assert.equal(result.status, 1);
    const body = JSON.parse(result.stdout);
    assert.equal(body.stopped, false);
    assert.equal(body.reason, "embedded");
    assert.equal(body.pid, process.pid);
    assert.equal((await fetch(`${embedded.url}/health`)).status, 200, "the embedded server is untouched");
  } finally {
    await embedded.close();
  }
});

test("stop and --reuse accept --root from another folder", async () => {
  const cwd = await plannerFixture();
  const elsewhere = await plannerFixture("agent-plan-cli-elsewhere-");
  const started = startServe(cwd, ["--port", "0", "--json"]);
  await started.firstLine;
  const root = join(cwd, ".planner");
  const reused = JSON.parse(runCli(["serve", "--reuse", "--json", "--root", root], { cwd: elsewhere, timeout: 10000 }).stdout);
  assert.equal(reused.reused, true);
  assert.equal(JSON.parse((await runCliAsync(["stop", "--json", `--root=${root}`], { cwd: elsewhere })).stdout).stopped, true);
  await started.exited;
});
