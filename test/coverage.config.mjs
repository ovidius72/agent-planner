/**
 * Coverage configuration (F015/P052 — coverage policy).
 *
 * Single source of truth for Node's built-in V8 coverage (node:test
 * --experimental-test-coverage). No c8/nyc dependency: Node >=25 ships the
 * collector with threshold flags, which keeps the gate CI-friendly.
 *
 * Policy:
 *  - We measure the COMPILED code executed by the tests (package dist dirs) —
 *    tests run against dist (like the existing suite), so dist is the executed
 *    surface. tsc emits a 1:1 file map for core/server/mcp/pi/adapter.
 *  - GENERATED BUNDLES are excluded: the Vite web-ui bundle and the copied
 *    web-ui-dist assets shipped inside plan-server/pi-adapter (hashed,
 *    minified, not unit-testable).
 *  - BOOTSTRAP-ONLY code is excluded: dist/cli.js entrypoints (arg parsing +
 *    process boot) and dist/index.js barrel re-exports are not unit targets.
 *  - test/ files are never coverage targets.
 *  - Mock policy: only the Pi host boundary is mocked; PlanStore + filesystem
 *    are always real. MCP subprocess tests do NOT contribute coverage (child
 *    process V8 profiles are not merged), so MCP/Pi scenarios must exercise
 *    handlers in-process too.
 *
 * Targets (P060/T257 enforces the gate; baseline runs report without gating):
 *  - Final gate:   lines/functions >= 80, branches >= 70 (feature target).
 *  - Baseline:     measured values below — raised as P053–P059 land.
 *
 * Baseline derivation (2026-08-09, Node built-in V8 coverage via `pnpm test:*`).
 * Node's coverage table columns are: line % | branch % | funcs % — each
 * baseline value = FLOOR of the minimum observed across repeated runs, so an
 * accurate baseline is green without hiding meaningful coverage:
 *   unit        — line% 44.68/44.73/44.95 · branch% 72.65/73.11/73.14 · func% 59.80×5 → 44/72/59
 *   integration — line% 60.90 · branch% 66.92 · func% 65.37                              → 60/66/65
 *   all         — line% 45.05 · branch% 74.36 · func% 61.01                              → 45/74/61
 */

export const COVERAGE = {
  /** Compiled code executed by the suite — the measured surface. */
  include: [
    "packages/plan-core/dist/**/*.js",
    "packages/plan-server/dist/**/*.js",
    "packages/plan-mcp/dist/**/*.js",
    "packages/pi-adapter/dist/**/*.js",
    "packages/agent-plan/dist/**/*.js",
  ],
  /** Generated bundles, bootstrap entrypoints, deps, and test code. */
  exclude: [
    "**/node_modules/**",
    "**/web-ui-dist/**", // copied Vite bundle (server + pi-adapter)
    "packages/plan-web-ui/dist/**", // Vite build output
    "**/dist/cli.js", // bootstrap entry: argv parsing + process boot
    "**/test/**",
    "**/*.test.mjs",
    "**/*.d.ts",
  ],
  /** Final gate (enforced by `--gate` / CI). */
  gate: { lines: 80, functions: 80, branches: 70 },
  /** Baseline gates per scope — floor of real measured minima (see derivation above). */
  baseline: {
    all: { lines: 45, functions: 61, branches: 74 },
    unit: { lines: 44, functions: 59, branches: 72 },
    integration: { lines: 60, functions: 65, branches: 66 },
  },
};

/**
 * Build the node:test coverage flag list.
 * @param {object} [opts] — { gate?: boolean, scope?: 'all'|'unit'|'integration', thresholds?: {lines,functions,branches} }
 */
export function coverageFlags({ gate = false, scope = "all", thresholds } = {}) {
  const t = thresholds ?? (gate ? COVERAGE.gate : COVERAGE.baseline[scope] ?? COVERAGE.baseline.all);
  const flags = ["--experimental-test-coverage"];
  for (const inc of COVERAGE.include) flags.push("--test-coverage-include", inc);
  for (const exc of COVERAGE.exclude) flags.push("--test-coverage-exclude", exc);
  flags.push(
    `--test-coverage-lines=${t.lines}`,
    `--test-coverage-functions=${t.functions}`,
    `--test-coverage-branches=${t.branches}`,
  );
  return flags;
}
