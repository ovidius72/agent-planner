"use strict";

const STABLE_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const STABLE_TAG = /^v(\d+\.\d+\.\d+)$/;

function parseStableVersion(version) {
  const match = STABLE_VERSION.exec(version);
  if (!match) throw new Error(`Expected a stable semantic version (X.Y.Z), received: ${version}`);
  return match.slice(1).map(Number);
}

function compareStableVersions(left, right) {
  const a = parseStableVersion(left);
  const b = parseStableVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function maxStableVersion(versions) {
  const stable = versions.filter((version) => STABLE_VERSION.test(version));
  if (stable.length === 0) return null;
  return stable.reduce((latest, version) => compareStableVersions(version, latest) > 0 ? version : latest);
}

function latestStableTag(tags) {
  const versions = tags
    .map((tag) => STABLE_TAG.exec(tag.trim())?.[1])
    .filter(Boolean);
  return maxStableVersion(versions);
}

function bumpStableVersion(version, level) {
  const [major, minor, patch] = parseStableVersion(version);
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  if (level === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown release level: ${level}`);
}

function resolveReleaseTarget(stableBase, requested = "patch") {
  parseStableVersion(stableBase);
  const target = STABLE_VERSION.test(requested)
    ? requested
    : bumpStableVersion(stableBase, requested);
  if (compareStableVersions(target, stableBase) <= 0) {
    throw new Error(`Target ${target} is not greater than latest stable ${stableBase}.`);
  }
  return target;
}

module.exports = {
  bumpStableVersion,
  compareStableVersions,
  latestStableTag,
  maxStableVersion,
  parseStableVersion,
  resolveReleaseTarget,
};
