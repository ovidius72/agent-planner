import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  compareStableVersions,
  latestStableTag,
  maxStableVersion,
  parseStableVersion,
  resolveReleaseTarget,
} = require("../scripts/release-version.cjs");

test("stable tag discovery ignores prerelease and malformed tags and compares numerically", () => {
  assert.equal(latestStableTag(["v0.2.9", "v0.2.22", "v0.10.0", "0.11.0", "v0.12.0-next.1", "release/v1.0.0"]), "0.10.0");
  assert.equal(latestStableTag([]), null);
});

test("origin/main fallback considers stable versions only", () => {
  assert.equal(maxStableVersion(["0.2.22-next.3", "0.2.21", "0.2.22"]), "0.2.22");
  assert.equal(maxStableVersion(["0.2.22-next.3"]), null);
});

test("a parameterless release bumps the latest stable patch", () => {
  assert.equal(resolveReleaseTarget("0.2.22"), "0.2.23");
});

test("release levels are computed from the stable base instead of develop prereleases", () => {
  assert.equal(resolveReleaseTarget("0.2.22", "patch"), "0.2.23");
  assert.equal(resolveReleaseTarget("0.2.22", "minor"), "0.3.0");
  assert.equal(resolveReleaseTarget("0.2.22", "major"), "1.0.0");
});

test("explicit stable targets retain downgrade and equality guards", () => {
  assert.equal(resolveReleaseTarget("0.2.22", "0.2.24"), "0.2.24");
  assert.throws(() => resolveReleaseTarget("0.2.22", "0.2.22"), /not greater/);
  assert.throws(() => resolveReleaseTarget("0.2.22", "0.2.21"), /not greater/);
  assert.throws(() => resolveReleaseTarget("0.2.22", "0.3.0-next.1"), /Unknown release level/);
});

test("stable version parsing rejects prerelease input", () => {
  assert.deepEqual(parseStableVersion("1.2.3"), [1, 2, 3]);
  assert.throws(() => parseStableVersion("1.2.3-next.1"), /stable semantic version/);
  assert.ok(compareStableVersions("0.10.0", "0.2.99") > 0);
});
