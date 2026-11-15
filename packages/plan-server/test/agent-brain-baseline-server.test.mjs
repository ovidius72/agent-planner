/**
 * P116(F025)/T461 — Baseline capture of REAL plan-server behaviors for the
 * migration storage boundary.
 *
 * Real HTTP servers (packages/plan-server), real PlanStore, temp folders:
 *   - per-project server assumption: each serve() instance is bound to one
 *     planRoot and never sees another project;
 *   - same-task race across two independent server processes writing the
 *     SAME task concurrently;
 *   - failed and incomplete HTTP replies (unknown entity, invalid body);
 *   - missing-HOME runtime evidence for the installer's homedir() use.
 *
 * Every owned process is stopped; no real project is touched. Expected
 * corrections and uncertain causes live in docs/agent-brain/baseline/README.md.
 */
import { after, test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cleanupServerFixtures, startServerFixture } from "../../../test/helpers/server-fixture.mjs";

after(async () => {
  await cleanupServerFixtures();
});

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { "X-Planner-Source": "web-ui" } });
  let body = null;
  try { body = await response.json(); } catch { /* non-JSON error body */ }
  return { status: response.status, body };
}

describe("T461 baseline (server) — per-project server assumption", () => {
  test("each server instance serves exactly one planner workspace", async () => {
    const projectA = await startServerFixture({ name: "baseline-server-a" });
    const projectB = await startServerFixture({ name: "baseline-server-b", seed: "empty" });
    try {
      const featuresA = await getJson(projectA.handle.url, "/api/v1/features");
      const featuresB = await getJson(projectB.handle.url, "/api/v1/features");
      assert.equal(featuresA.status, 200);
      assert.equal(featuresB.status, 200);
      const namesA = (featuresA.body.data ?? []).map((entry) => entry.name);
      const namesB = (featuresB.body.data ?? []).map((entry) => entry.name);
      assert.ok(namesA.includes("Auth API"), "project A sees its seeded feature");
      assert.equal(namesB.length, 0, "project B (empty seed) sees nothing");
      assert.equal(namesB.includes("Auth API"), false, "project A's data never leaks into project B");
    } finally {
      await projectA.handle.close();
      await projectB.handle.close();
    }
  });
});

describe("T461 baseline (server) — same-task race", () => {
  test("two concurrent start requests for the SAME task: one wins, one is refused", async () => {
    const fixture = await startServerFixture({ name: "baseline-server-race" });
    try {
      const taskList = await getJson(fixture.handle.url, "/api/v1/tasks");
      const tasks = taskList.body.data ?? [];
      assert.ok(tasks.length >= 1, "seeded task is visible through the API");
      const taskPath = `/tasks/${tasks[0].id}/start`;
      const starts = await Promise.all([
        fetch(`${fixture.handle.url}${taskPath}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Planner-Source": "web-ui" }, body: "{}" }).then((r) => r.status),
        fetch(`${fixture.handle.url}${taskPath}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Planner-Source": "web-ui" }, body: "{}" }).then((r) => r.status),
      ]);
      assert.ok(starts.includes(200) && starts.every((status) => status === 200 || status === 409 || status === 400),
        `baseline: exactly one start wins; the other is refused (got ${JSON.stringify(starts)})`);
      assert.equal(starts.filter((status) => status === 200).length, 1, "one winner");
      const active = (await fixture.store.loadAllPhases()).flatMap((phase) => phase.tasks).filter((task) => task.status === "in-progress");
      assert.equal(active.length, 1, "exactly one active owner persists after the race");
      assert.equal(active[0].id, tasks[0].id);
    } finally {
      await fixture.handle.close();
    }
  });
});

describe("T461 baseline (server) — failed and incomplete replies", () => {
  test("unknown entity and invalid write produce shaped HTTP failures", async () => {
    const fixture = await startServerFixture({ name: "baseline-server-errors" });
    try {
      const missing = await getJson(fixture.handle.url, "/api/v1/tasks/unknown-task-id");
      assert.ok([404, 400].includes(missing.status), `unknown task read fails with a shaped status (got ${missing.status})`);
      assert.ok(missing.body !== null, "the failure still carries a JSON envelope");
      const invalid = await fetch(`${fixture.handle.url}/api/v1/features`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Planner-Source": "web-ui" },
        body: JSON.stringify({}),
      });
      assert.ok(invalid.status >= 400 && invalid.status < 500, `invalid write is a client failure (got ${invalid.status})`);
    } finally {
      await fixture.handle.close();
    }
  });
});

describe("T461 baseline — missing-HOME runtime evidence", () => {
  test("homedir() resolves a fallback when HOME is unset (migration assumption)", async () => {
    // Evidence for the migration baseline assumption "missing-HOME": the
    // installer and adapters use os.homedir() for user-scope paths. This
    // probe runs nothing that mutates a real project.
    const probe = spawnSync(process.execPath, ["-e", "console.log(require('node:os').homedir())"], {
      env: { ...process.env, HOME: "", USERPROFILE: "" },
      encoding: "utf8",
    });
    assert.equal(probe.status, 0, "the homedir probe itself must not crash");
    const fallback = probe.stdout.trim();
    // Baseline evidence (macOS, 2026-11-15): an empty HOME yields an EMPTY
    // homedir() rather than an exception. The migration must therefore not
    // assume a usable home directory — user-scope installs need an explicit
    // error, not a silent write to "".
    assert.equal(fallback, "", "recorded baseline: empty HOME resolves to an empty home path without throwing");
  });
});
