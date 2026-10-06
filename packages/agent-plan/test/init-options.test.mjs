import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(packageRoot, "dist", "index.js");
const roots = [];

after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function freshDir() {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "agent-plan-init-")));
  roots.push(cwd);
  return cwd;
}

function runInit(cwd, args) {
  return spawnSync(process.execPath, [cliPath, "init", ...args], { cwd, encoding: "utf-8" });
}

test("init --json with --description and --goal creates the planner and reports it on one line", async () => {
  const cwd = await freshDir();
  const result = runInit(cwd, ["Demo", "--description", "A demo project", "--goal=Ship it", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { status: "created", root: join(cwd, ".planner"), name: "Demo" });
  const project = JSON.parse(await readFile(join(cwd, ".planner", "project.json"), "utf-8"));
  assert.equal(project.name, "Demo");
  assert.equal(project.description, "A demo project");
  assert.equal(project.goal, "Ship it");
});

test("init --json on an existing planner reports exists and changes nothing", async () => {
  const cwd = await freshDir();
  assert.equal(runInit(cwd, ["First", "--description", "Original", "--yes"]).status, 0);
  const again = runInit(cwd, ["Second", "--description", "Overwrite", "--goal", "New goal", "--json"]);
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(JSON.parse(again.stdout), { status: "exists", root: join(cwd, ".planner"), name: "First" });
  const project = JSON.parse(await readFile(join(cwd, ".planner", "project.json"), "utf-8"));
  assert.equal(project.description, "Original");
  assert.equal(project.goal, "");
});

test("init --json without a name never prompts and uses the folder name", async () => {
  const cwd = await freshDir();
  const result = runInit(cwd, ["--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).name, cwd.split("/").pop());
});

test("init without new flags keeps the original text output", async () => {
  const cwd = await freshDir();
  const result = runInit(cwd, ["Plain", "--yes"]);
  assert.match(result.stdout, /Initialized \.planner\/ for "Plain"/);
  assert.match(runInit(cwd, ["--yes"]).stdout, /already exists/);
});

test("a value flag without a value fails with exit code 1", async () => {
  const cwd = await freshDir();
  const result = runInit(cwd, ["Demo", "--goal"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--goal needs a value/);
});
