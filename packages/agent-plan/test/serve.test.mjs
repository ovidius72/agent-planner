import { after, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { cliPath, cleanupCliProcesses, plannerFixture, startServe, tempDir } from "./helpers/cli-process.mjs";

after(cleanupCliProcesses);

test("serve --json prints one JSON line with the real port and stops cleanly on SIGTERM", async () => {
  const cwd = await plannerFixture();
  const { child, firstLine, exited } = startServe(cwd, ["--port", "0", "--json"]);
  try {
    const info = JSON.parse(await firstLine);
    assert.ok(info.port > 0, "port 0 must be replaced by the assigned port");
    assert.equal(info.host, "127.0.0.1");
    assert.equal(info.root, join(cwd, ".planner"));
    assert.match(info.url, /^http:\/\/127\.0\.0\.1:\d+/);
    const response = await fetch(`${info.localUrl.replace(/\/$/, "")}/api/health`);
    assert.equal(response.status, 200);
    child.kill("SIGTERM");
    const { code } = await exited;
    assert.equal(code, 0);
  } finally {
    child.kill("SIGKILL");
  }
});

test("serve --root serves a planner outside the working directory", async () => {
  const cwd = await plannerFixture();
  const other = await tempDir("agent-plan-serve-cwd-");
  const { child, firstLine } = startServe(other, [`--root=${join(cwd, ".planner")}`, "--port", "0", "--json"]);
  try {
    assert.equal(JSON.parse(await firstLine).root, join(cwd, ".planner"));
  } finally {
    child.kill("SIGKILL");
  }
});

test("serve fails with exit code 1 and a message on stderr for a folder without a planner", async () => {
  const cwd = await tempDir("agent-plan-serve-empty-");
  const result = spawnSync(process.execPath, [cliPath, "serve", "--port", "0"], { cwd, encoding: "utf-8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No \.planner\/ found/);
  assert.equal(result.stdout, "");
});

test("serve rejects a port that is not a number", async () => {
  const cwd = await plannerFixture();
  for (const port of ["abc", "70000", "-1"]) {
    const result = spawnSync(process.execPath, [cliPath, "serve", "--port", port], { cwd, encoding: "utf-8" });
    assert.equal(result.status, 1, `port ${port}`);
    assert.match(result.stderr, /Invalid --port/);
  }
});
