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
 *
 * Re-derived 2026-08-11 (P056 lands the Pi host harness, which executes big
 * chunks of the 487-branch pi-adapter; V8 counts branches only in executed
 * code, so newly-measured adapter branches dilute the % even as absolute
 * hits rise — floors below reflect the new honest minimum):
 *   unit        — line% 68.14/68.18 · branch% 72.99/73.19 · func% 75.27               → 68/72/75
 *   all         — line% 68.18/68.20 · branch% 72.81/73.26 · func% 75.37/76.27         → 68/72/75
 *
 * Re-derived again 2026-08-11 (T242 lands Pi mutation/handoff tests):
 *   unit        — line% 79.29/79.48/79.57 · branch% 72.72/72.74/72.88 · func% 77.79/78.06/78.15 → 79/72/77
 *   all         — line% 79.31×3            · branch% 72.85×3            · func% 77.88×3         → 79/72/77
 *
 * Re-derived 2026-08-19 (P066 lands task-focus suspension: paused lifecycle,
 * structured snapshots, atomic pause/switch, GET /tasks/focus, resume UI).
 * New covered functions dilute the func% floor slightly (V8 counts functions
 * only in executed code); honest measured minimum drops to 76.76% (unit) /
 * 76.93% (all), so the func floor is re-based to 76:
 *   unit        — line% 79.31 · branch% 72.85 · func% 76.76 → 79/72/76
 *   all         — line% 79.31 · branch% 72.85 · func% 76.93 → 79/72/76
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
    all: { lines: 79, functions: 76, branches: 72 },
    unit: { lines: 79, functions: 76, branches: 72 },
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
