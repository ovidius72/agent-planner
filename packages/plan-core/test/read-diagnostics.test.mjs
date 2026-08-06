import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlanStore } from "../dist/index.js";

const dirs = [];
after(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "read-diag-"));
  dirs.push(root);
  const st = new PlanStore(join(root, ".planner"));
  await st.init("read diagnostics test");
  return { root, st };
}

function projectPath(root) {
  return join(root, ".planner", "project.json");
}

describe("PlanStore read diagnostics", () => {
  test("corrupt JSON includes jsonParseError details", async () => {
    const { root, st } = await setup();
    await writeFile(projectPath(root), '{ "name": "bad", "goal": "x",', "utf-8");

    try {
      await st.loadProject();
      assert.fail("expected read to throw");
    } catch (err) {
      assert.equal(err.name, "PlanStoreError", "error class");
      assert.ok(err.message.includes("read failed:"), "message mentions read failed");
      assert.ok(err.details, "details attached");
      assert.equal(err.details.path, projectPath(root), "details.path");
      assert.equal(err.details.operation, "readJson", "details.operation");
      assert.ok(err.details.jsonParseError, "jsonParseError present");
      assert.ok(err.details.jsonParseError.message.length > 0, "json parse message");
      assert.ok(typeof err.details.rawPreview === "string", "rawPreview present");
    }
  });

  test("schema validation includes validationErrors details", async () => {
    const { root, st } = await setup();
    // project.json missing required `name` (after parse we drop it)
    await writeFile(projectPath(root), JSON.stringify({ goal: "x", description: "y" }), "utf-8");

    try {
      await st.loadProject();
      assert.fail("expected read to throw");
    } catch (err) {
      assert.equal(err.name, "PlanStoreError", "error class");
      assert.ok(Array.isArray(err.details.validationErrors), "validationErrors array");
      assert.ok(err.details.validationErrors.length > 0, "at least one issue");
      const first = err.details.validationErrors[0];
      assert.ok(first.path.length > 0 || first.message.length > 0, "issue has path or message");
    }
  });

  test("valid .bak backup recovers without throwing", async () => {
    const { root, st } = await setup();
    const project = await st.loadProject();
    const valid = JSON.stringify(project);
    await writeFile(`${projectPath(root)}.bak`, valid, "utf-8");
    await writeFile(projectPath(root), "not json", "utf-8");

    const loaded = await st.loadProject();
    assert.equal(loaded.name, project.name, "recovered from backup");
  });

  test("corrupt primary and backup sets backupFailed", async () => {
    const { root, st } = await setup();
    await writeFile(projectPath(root), "not json", "utf-8");
    await writeFile(`${projectPath(root)}.bak`, "also not json", "utf-8");

    try {
      await st.loadProject();
      assert.fail("expected read to throw");
    } catch (err) {
      assert.equal(err.name, "PlanStoreError", "error class");
      assert.equal(err.details.backupTried, true, "backup was tried");
      assert.equal(err.details.backupFailed, true, "backup failed");
    }
  });
});
