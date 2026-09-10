import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { finalGateCacheDecision, repositoryFingerprint } from "../scripts/verify.mjs";

function fingerprintRunner({ diff = "", untracked = "" } = {}) {
  return (_command, args) => {
    const operation = args[0];
    if (operation === "rev-parse") return { status: 0, stdout: "abc123\n", stderr: "" };
    if (operation === "diff") return { status: 0, stdout: diff, stderr: "" };
    if (operation === "ls-files") return { status: 0, stdout: untracked, stderr: "" };
    throw new Error(`unexpected git operation ${operation}`);
  };
}

test("verification fingerprint is stable and changes with tracked or untracked content", () => {
  const base = repositoryFingerprint({ runner: fingerprintRunner(), readFile: () => Buffer.from("") });
  assert.equal(base, repositoryFingerprint({ runner: fingerprintRunner(), readFile: () => Buffer.from("") }));
  assert.notEqual(base, repositoryFingerprint({ runner: fingerprintRunner({ diff: "+changed" }), readFile: () => Buffer.from("") }));
  assert.notEqual(base, repositoryFingerprint({ runner: fingerprintRunner({ untracked: "new-file.mjs\0" }), readFile: () => Buffer.from("new") }));
});

test("final verification reuses success and blocks unchanged failures outside CI", () => {
  const fingerprint = "abc";
  assert.equal(finalGateCacheDecision({ fingerprint, status: "passed" }, fingerprint), "reuse");
  assert.equal(finalGateCacheDecision({ fingerprint, status: "failed" }, fingerprint), "block-unchanged-failure");
  assert.equal(finalGateCacheDecision({ fingerprint: "other", status: "passed" }, fingerprint), "run");
  assert.equal(finalGateCacheDecision({ fingerprint, status: "passed" }, fingerprint, { ci: true }), "run");
  assert.equal(finalGateCacheDecision({ fingerprint, status: "failed" }, fingerprint, { forceRun: true }), "run");
});

test("focused verification fails fast unless exactly one bounded scope is selected", () => {
  const result = spawnSync(process.execPath, ["scripts/verify.mjs", "focused"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires exactly one of --package <name> or --test <path>/);
});

test("repository governance routes broad verification through the canonical runner", async () => {
  const [agents, packageJson, ci, release, releaseNext, smoke] = await Promise.all([
    readFile("AGENTS.md", "utf8"),
    readFile("package.json", "utf8"),
    readFile(".github/workflows/ci.yml", "utf8"),
    readFile("scripts/release.cjs", "utf8"),
    readFile("scripts/release-next.cjs", "utf8"),
    readFile("scripts/installed-artifact-smoke.mjs", "utf8"),
  ]);
  assert.match(agents, /Never stream verbose build, coverage, or browser output/);
  assert.match(agents, /freshly packed artifacts/);
  assert.match(packageJson, /"verify:final": "node scripts\/verify\.mjs final"/);
  assert.match(ci, /pnpm verify:final -- --ci/);
  assert.doesNotMatch(ci, /run: pnpm test:coverage/);
  assert.match(release, /pnpm verify:final -- --force/);
  assert.match(releaseNext, /pnpm verify:final -- --force/);
  assert.match(smoke, /mkdtemp/);
  assert.match(smoke, /planner-load/);
  assert.match(smoke, /structured\.webUi\?\.address/);
});
