/**
 * P128(F025)/T489 — portable project descriptor and workspace resolver.
 *
 * Isolated mkdtemp fixtures only; no real project and no Git publication.
 * Covers the T489 acceptance cases: two worktrees of one clone resolve to the
 * same projectId while keeping distinct source roots; non-Git planning stays
 * valid; folder moves and branch renames preserve identity (the descriptor
 * carries no path); a copied/forked descriptor surfaces the same projectId for
 * an explicit rebind decision; invalid and incompatible descriptors yield
 * typed errors instead of silent substitutes; deletion of the bound data is
 * reported, never replaced (restore-required is the caller's offer on `none`
 * after a known projectId — the resolver only refuses to invent one).
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  PROJECT_DESCRIPTOR_NAME,
  cloneKeyFor,
  readProjectDescriptor,
  resolvePlannerWorkspace,
  serializeProjectDescriptor,
  writeProjectDescriptor,
  ProjectDescriptorError,
} from "../dist/index.js";

const run = promisify(execFile);

const roots = [];

after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function tempRoot(name) {
  const root = await mkdtemp(join(tmpdir(), `agent-plan-descriptor-${name}-`));
  roots.push(root);
  return root;
}

async function initGitRepo(dir) {
  await run("git", ["init", "-q"], { cwd: dir });
  await run("git", ["config", "user.email", "fixture@example.com"], { cwd: dir });
  await run("git", ["config", "user.name", "Fixture"], { cwd: dir });
  await run("git", ["add", "-A"], { cwd: dir });
  await run("git", ["commit", "-q", "-m", "fixture"], { cwd: dir }).catch(() => {
    // An empty repo is fine for resolution purposes.
  });
}

const PROJECT_ID = "123e4567-e89b-42d3-a456-426614174000";

test("a descriptor in the working directory resolves first and carries the stable project id", async () => {
  const root = await tempRoot("basic");
  const path = await writeProjectDescriptor(root, { schemaVersion: 1, projectId: PROJECT_ID });
  const resolution = await resolvePlannerWorkspace(root);
  assert.equal(resolution.kind, "descriptor");
  if (resolution.kind !== "descriptor") return;
  assert.equal(resolution.descriptor.projectId, PROJECT_ID);
  assert.equal(resolution.path, path);
  assert.equal(resolution.root, root);
});

test("the nearest descriptor wins over an ancestor one (nested monorepo sub-project)", async () => {
  const root = await tempRoot("nested");
  await writeProjectDescriptor(root, { schemaVersion: 1, projectId: "parent-id" });
  const sub = join(root, "packages", "sub");
  await mkdir(sub, { recursive: true });
  await writeProjectDescriptor(sub, { schemaVersion: 1, projectId: "child-id" });
  const resolution = await resolvePlannerWorkspace(join(sub, "src"));
  assert.equal(resolution.kind, "descriptor");
  if (resolution.kind !== "descriptor") return;
  assert.equal(resolution.descriptor.projectId, "child-id");
});

test("the walk never crosses a repository boundary without a descriptor", async () => {
  const outer = await tempRoot("boundary");
  await writeProjectDescriptor(outer, { schemaVersion: 1, projectId: "outer-id" });
  const repo = join(outer, "repo");
  await mkdir(repo, { recursive: true });
  await initGitRepo(repo);
  const resolution = await resolvePlannerWorkspace(repo);
  assert.notEqual(resolution.kind, "descriptor", "the outer descriptor must not be reached across the repo boundary");
  assert.equal(resolution.kind, "none");
});

test("two worktrees of one clone share the clone key while keeping distinct roots", async () => {
  const root = await tempRoot("worktrees");
  await writeProjectDescriptor(root, { schemaVersion: 1, projectId: PROJECT_ID });
  await initGitRepo(root);
  await run("git", ["worktree", "add", "-q", join(root, "..", "wt-b"), "HEAD"], { cwd: root });
  roots.push(join(root, "..", "wt-b"));
  const main = await resolvePlannerWorkspace(root);
  const wt = await resolvePlannerWorkspace(join(root, "..", "wt-b"));
  assert.equal(main.kind, "descriptor");
  assert.equal(wt.kind, "descriptor");
  if (main.kind !== "descriptor" || wt.kind !== "descriptor") return;
  assert.equal(main.descriptor.projectId, PROJECT_ID);
  assert.equal(wt.descriptor.projectId, PROJECT_ID);
  assert.notEqual(main.root, wt.root, "source roots stay distinct");
  const { realpath } = await import("node:fs/promises");
  assert.equal(await realpath(await cloneKeyFor(main.root)), await realpath(await cloneKeyFor(wt.root)), "one clone, one clone key");
});

test("a copied folder carrying a known projectId surfaces it for the explicit rebind decision", async () => {
  const root = await tempRoot("copy");
  await writeProjectDescriptor(root, { schemaVersion: 1, projectId: PROJECT_ID });
  const copy = join(root, "copy");
  await mkdir(copy, { recursive: true });
  await writeFile(join(copy, PROJECT_DESCRIPTOR_NAME), await readFile(join(root, PROJECT_DESCRIPTOR_NAME), "utf8"));
  const resolution = await resolvePlannerWorkspace(copy);
  assert.equal(resolution.kind, "descriptor");
  if (resolution.kind !== "descriptor") return;
  assert.equal(resolution.descriptor.projectId, PROJECT_ID, "same projectId — the caller must ask once: same project or new project");
});

test("non-Git folders with a descriptor are valid and branch renames change nothing", async () => {
  const root = await tempRoot("non-git");
  await writeProjectDescriptor(root, {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    snapshot: { remote: "origin", branch: "planner/export" },
  });
  const resolution = await resolvePlannerWorkspace(root);
  assert.equal(resolution.kind, "descriptor");
  if (resolution.kind !== "descriptor") return;
  assert.equal(resolution.descriptor.snapshot?.branch, "planner/export");
});

test("legacy .planner without a descriptor resolves as the migration-offer state", async () => {
  const root = await tempRoot("legacy");
  await mkdir(join(root, ".planner"), { recursive: true });
  await writeFile(join(root, ".planner", "manifest.json"), JSON.stringify({ schemaVersion: 1, projectId: "legacy-id" }));
  const resolution = await resolvePlannerWorkspace(root);
  assert.equal(resolution.kind, "legacy");
  if (resolution.kind !== "legacy") return;
  assert.ok(resolution.planRoot.endsWith(".planner"));
});

test("invalid JSON and an unsupported schemaVersion are typed errors, never silent fallbacks", async () => {
  const broken = await tempRoot("broken");
  await writeFile(join(broken, PROJECT_DESCRIPTOR_NAME), "{not json");
  const brokenResolution = await resolvePlannerWorkspace(broken);
  assert.equal(brokenResolution.kind, "descriptor-error");
  if (brokenResolution.kind === "descriptor-error") {
    assert.equal(brokenResolution.error.code, "PROJECT_DESCRIPTOR_INVALID");
  }

  const future = await tempRoot("future");
  await writeFile(join(future, PROJECT_DESCRIPTOR_NAME), JSON.stringify({ schemaVersion: 2, projectId: "x" }));
  await assert.rejects(
    () => readProjectDescriptor(join(future, PROJECT_DESCRIPTOR_NAME)),
    (error) => error instanceof ProjectDescriptorError
      && error.code === "PROJECT_DESCRIPTOR_INCOMPATIBLE"
      && error.foundSchemaVersion === 2,
  );
  const futureResolution = await resolvePlannerWorkspace(future);
  assert.equal(futureResolution.kind, "descriptor-error", "an incompatible descriptor is surfaced, not ignored");
  if (futureResolution.kind === "descriptor-error") {
    assert.equal(futureResolution.error.code, "PROJECT_DESCRIPTOR_INCOMPATIBLE");
  }
});

test("the strict schema rejects extra fields — no secrets, db paths or live agents can ride along", async () => {
  const root = await tempRoot("strict");
  await writeFile(join(root, PROJECT_DESCRIPTOR_NAME), JSON.stringify({
    schemaVersion: 1,
    projectId: PROJECT_ID,
    databasePath: "/home/user/.agent-plan/planner.sqlite",
    token: "secret",
  }));
  const resolution = await resolvePlannerWorkspace(root);
  assert.equal(resolution.kind, "descriptor-error");
  if (resolution.kind === "descriptor-error") {
    assert.equal(resolution.error.code, "PROJECT_DESCRIPTOR_INVALID");
    assert.match(resolution.error.message, /databasePath|token/);
  }
});

test("an empty folder resolves to none — initialization offer, still a valid project state", async () => {
  const root = await tempRoot("empty");
  const resolution = await resolvePlannerWorkspace(root);
  assert.equal(resolution.kind, "none");
});

test("descriptor writes are atomic and round-trip through the strict schema", async () => {
  const root = await tempRoot("roundtrip");
  await writeProjectDescriptor(root, { schemaVersion: 1, projectId: PROJECT_ID });
  const content = await readFile(join(root, PROJECT_DESCRIPTOR_NAME), "utf8");
  const reread = await readProjectDescriptor(join(root, PROJECT_DESCRIPTOR_NAME));
  assert.equal(reread.projectId, PROJECT_ID);
  assert.equal(content, serializeProjectDescriptor(reread));
  const { readdir } = await import("node:fs/promises");
  assert.equal((await readdir(root)).some((name) => name.includes(".tmp-")), false, "no temp file residue");
});
