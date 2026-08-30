import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

async function source(relativePath) {
  return readFile(join(root, relativePath), "utf8");
}

function matches(input, pattern) {
  return [...input.matchAll(pattern)].map((match) => match[1]);
}

test("canonical planner skill covers every registered MCP and Pi tool", async () => {
  const [skill, mcp, pi] = await Promise.all([
    source("packages/plan-core/planner-skill.md"),
    source("packages/plan-mcp/src/index.ts"),
    source("packages/pi-adapter/src/index.ts"),
  ]);

  const mcpTools = matches(mcp, /server\.registerTool\("([^"]+)"/g);
  const piTools = matches(pi, /pi\.registerTool\(\{\s*\n\s*name:\s*"([^"]+)"/g);

  assert.ok(mcpTools.length >= 48, `expected the full MCP inventory, found ${mcpTools.length}`);
  assert.ok(piTools.length >= 52, `expected the full Pi inventory, found ${piTools.length}`);
  for (const tool of [...mcpTools, ...piTools]) {
    assert.ok(skill.includes(`\`${tool}\``), `missing planner skill inventory entry: ${tool}`);
  }
});

test("canonical planner skill covers every Pi slash-command completion", async () => {
  const [skill, pi] = await Promise.all([
    source("packages/plan-core/planner-skill.md"),
    source("packages/pi-adapter/src/index.ts"),
  ]);
  const start = pi.indexOf("const PLANNER_COMMAND_COMPLETIONS = [");
  const end = pi.indexOf("];", start);
  assert.ok(start >= 0 && end > start, "PLANNER_COMMAND_COMPLETIONS not found");
  const values = matches(pi.slice(start, end), /value:\s*"([^"]+)"/g);

  for (const value of values) {
    assert.ok(skill.includes(`/planner ${value}`), `missing planner slash-command entry: /planner ${value}`);
  }
});

test("generated planner skill copies match the plan-core canonical source", async () => {
  const [canonical, shared, claude] = await Promise.all([
    source("packages/plan-core/planner-skill.md"),
    source("plugins/_shared/planner-skill.md.in"),
    source("plugins/claude-code/skills/planner/SKILL.md"),
  ]);

  assert.equal(shared, canonical);
  assert.equal(claude, canonical);
});
