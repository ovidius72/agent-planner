/**
 * P105(F005)/T429: the re-runnable sweep that found ten functions written
 * independently in both adapter entry points, and three more shadowing a
 * plan-core export. Same method as `planner-skill-inventory.test.mjs`: parse
 * function declarations out of the adapter source with a regex, no fixtures,
 * no PlanStore.
 *
 * `^(export )?(async )?function (\w+)` anchored at line start only matches
 * top-level (module-scope) function declarations — never a nested helper,
 * an arrow function, or a class method — which is exactly what let the
 * original ten drift unnoticed: private, same-named, same-shaped, one per
 * adapter file.
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const FUNCTION_DECL_RE = /^(?:export )?(?:async )?function (\w+)/gm;

async function source(relativePath) {
  return readFile(join(root, relativePath), "utf8");
}

function declaredFunctionNames(input) {
  return new Set([...input.matchAll(FUNCTION_DECL_RE)].map((match) => match[1]));
}

async function coreExportedFunctionNames() {
  const dir = join(root, "packages/plan-core/src");
  const files = (await readdir(dir)).filter((name) => name.endsWith(".ts"));
  const names = new Set();
  for (const file of files) {
    const text = await readFile(join(dir, file), "utf8");
    for (const match of text.matchAll(/^export (?:async )?function (\w+)/gm)) names.add(match[1]);
  }
  return names;
}

test("no function is declared in both adapter entry points", async () => {
  const [mcp, pi] = await Promise.all([
    source("packages/plan-mcp/src/index.ts"),
    source("packages/pi-adapter/src/index.ts"),
  ]);
  const mcpNames = declaredFunctionNames(mcp);
  const piNames = declaredFunctionNames(pi);
  const shared = [...mcpNames].filter((name) => piNames.has(name)).sort();

  assert.deepEqual(
    shared,
    [],
    `these functions are declared independently in both packages/plan-mcp/src/index.ts and ` +
    `packages/pi-adapter/src/index.ts: ${shared.join(", ")}. A decision shared by both adapters ` +
    `belongs in @agent-plan/core (AGENTS.md rule 4) — either move the whole function (pure logic) ` +
    `or move the decision/message and leave each adapter's result envelope where it is ` +
    `(see mutation-reply.ts, handoff-reply.ts, accepted-decision-guard.ts for the pattern). ` +
    `A same-purpose per-adapter wrapper that must stay adapter-local is expected to carry an ` +
    `adapter-qualified name (e.g. mcpXxx / piXxx, see mcpContextReadActions / piContextReadActions).`,
  );
});

test("neither adapter entry point re-declares a function plan-core already exports", async () => {
  const [mcp, pi, coreNames] = await Promise.all([
    source("packages/plan-mcp/src/index.ts"),
    source("packages/pi-adapter/src/index.ts"),
    coreExportedFunctionNames(),
  ]);
  const mcpShadows = [...declaredFunctionNames(mcp)].filter((name) => coreNames.has(name)).sort();
  const piShadows = [...declaredFunctionNames(pi)].filter((name) => coreNames.has(name)).sort();

  assert.deepEqual(mcpShadows, [], `packages/plan-mcp/src/index.ts re-declares plan-core export(s): ${mcpShadows.join(", ")}. Delete the local copy and import from @agent-plan/core instead.`);
  assert.deepEqual(piShadows, [], `packages/pi-adapter/src/index.ts re-declares plan-core export(s): ${piShadows.join(", ")}. Delete the local copy and import from @agent-plan/core instead.`);
});
