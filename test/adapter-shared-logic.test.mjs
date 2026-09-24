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
 *
 * P105(F005)/T432 added `plan-server/src/serve.ts` as a third entry point:
 * it carried its own weaker copy of `resolveAcceptedDecisionTarget`,
 * `nowISO`, and `applyTaskLifecycleDates`, found only because nothing swept
 * the server the way this file already swept the two adapters. Any pair of
 * these three entry points sharing a function name — or any of the three
 * shadowing a plan-core export — means the same duplication class has
 * regrown; this test fails on that, not just on the mcp/pi pair.
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const FUNCTION_DECL_RE = /^(?:export )?(?:async )?function (\w+)/gm;

const ENTRY_POINTS = [
  { label: "packages/plan-mcp/src/index.ts", path: "packages/plan-mcp/src/index.ts" },
  { label: "packages/pi-adapter/src/index.ts", path: "packages/pi-adapter/src/index.ts" },
  { label: "packages/plan-server/src/serve.ts", path: "packages/plan-server/src/serve.ts" },
];

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

test("no function is declared in more than one of the three entry points (plan-mcp, pi-adapter, plan-server)", async () => {
  const sources = await Promise.all(ENTRY_POINTS.map((entry) => source(entry.path)));
  const namesByEntry = ENTRY_POINTS.map((entry, index) => ({ label: entry.label, names: declaredFunctionNames(sources[index]) }));

  const violations = [];
  for (let i = 0; i < namesByEntry.length; i++) {
    for (let j = i + 1; j < namesByEntry.length; j++) {
      const left = namesByEntry[i];
      const right = namesByEntry[j];
      const shared = [...left.names].filter((name) => right.names.has(name)).sort();
      for (const name of shared) violations.push(`${name} (${left.label} + ${right.label})`);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `these functions are declared independently in more than one entry point: ${violations.join(", ")}. ` +
    `A decision shared by more than one surface belongs in @agent-plan/core (AGENTS.md rule 4) — either move ` +
    `the whole function (pure logic) or move the decision/message and leave each surface's result envelope ` +
    `where it is (see mutation-reply.ts, handoff-reply.ts, accepted-decision-guard.ts for the pattern). ` +
    `A same-purpose per-surface wrapper that must stay local is expected to carry a surface-qualified name ` +
    `(e.g. mcpXxx / piXxx / resolveAcceptedDecisionEventTarget, see mcpContextReadActions / piContextReadActions).`,
  );
});

test("none of the three entry points re-declares a function plan-core already exports", async () => {
  const [sources, coreNames] = await Promise.all([
    Promise.all(ENTRY_POINTS.map((entry) => source(entry.path))),
    coreExportedFunctionNames(),
  ]);

  for (const [index, entry] of ENTRY_POINTS.entries()) {
    const shadows = [...declaredFunctionNames(sources[index])].filter((name) => coreNames.has(name)).sort();
    assert.deepEqual(shadows, [], `${entry.path} re-declares plan-core export(s): ${shadows.join(", ")}. Delete the local copy and import from @agent-plan/core instead.`);
  }
});
