import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStaleProcessCheck } from "../dist/index.js";

async function manifest(version) {
  const dir = await mkdtemp(join(tmpdir(), "agent-plan-stale-"));
  const path = join(dir, "package.json");
  await writeFile(path, JSON.stringify({ name: "@agent-plan/mcp", version }));
  return { dir, path };
}

test("no notice while the installed version matches the loaded one", async () => {
  const { dir, path } = await manifest("0.3.1");
  try {
    const check = createStaleProcessCheck({ name: "@agent-plan/mcp", version: "0.3.1", packageJsonPath: path });
    assert.equal(check(), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an upgrade after start produces one notice line, rechecked at most once per interval", async () => {
  const { dir, path } = await manifest("0.3.0");
  try {
    let clock = 0;
    const check = createStaleProcessCheck({ name: "@agent-plan/mcp", version: "0.3.0", packageJsonPath: path }, { intervalMs: 1_000, now: () => clock });
    assert.equal(check(), undefined);

    await writeFile(path, JSON.stringify({ name: "@agent-plan/mcp", version: "0.3.1" }));
    clock = 500;
    assert.equal(check(), undefined, "not rechecked inside the interval");

    clock = 1_500;
    const notice = check();
    assert.match(notice, /running @agent-plan\/mcp 0\.3\.0, but 0\.3\.1 is now installed/);
    assert.match(notice, /Restart the session/);
    assert.equal(notice.split("\n").length, 1, "one line");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unreadable or missing manifest never produces a notice or throws", async () => {
  assert.equal(createStaleProcessCheck({ name: "x", version: "1.0.0", packageJsonPath: "/nonexistent/package.json" })(), undefined);
  assert.equal(createStaleProcessCheck({ name: "x", version: "1.0.0" })(), undefined);
});
