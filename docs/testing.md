# Testing & Verification (F015)

This document explains how to run every test suite in Agent Plan, how to read
coverage, how to add a shared cross-harness scenario, how fixtures and the Pi
host boundary work, and how to debug the usual failure modes (WebSocket,
dynamic-port, flaky filesystem, browser).

Agent Plan verifies behavior across five boundaries: **core** (PlanStore +
pure helpers), **api** (plan-server HTTP routes), **mcp** (MCP tools),
**pi** (Pi extension commands/tools/hooks), and **ui/e2e** (React Web UI +
Playwright). The same business scenarios are exercised through every boundary
so that equivalent operations produce equivalent normalized outcomes.

## 1. Quick start

```bash
# Everything (builds deps, runs unit + integration, reports coverage at baseline)
pnpm test

# Unit only (package-local tests under packages/*/test + web-ui vitest)
pnpm test:unit

# Integration only (root suite under test/)
pnpm test:integration

# Enforce the FINAL coverage gate (CI)
pnpm test:coverage

# Playwright browser suite (rebuilds bundles first)
pnpm test:e2e

# Surface/scenario/fixture consistency check only
pnpm test:matrix
```

The root runner is `scripts/test-all.mjs`. Direct usage:

```bash
node scripts/test-all.mjs [unit|integration|all] [--gate] [--no-build] \
  [--package <plan-core|plan-server|plan-mcp|pi-adapter|agent-plan|plan-web-ui>] \
  [--report-dir <dir>]
```

- `--gate` enforces the final thresholds (CI). Without it, the baseline is
  reported but not enforced.
- `--no-build` skips the `tsc` build (use when `dist/` is already fresh).
- `--package <pkg>` limits **unit** scope to one package (and rebuilds only its
  dependency chain). `plan-web-ui` cannot be coverage-gated by the Node/V8
  runner (it is a browser bundle) — its component tests are run separately by
  vitest (section 8).

## 2. Suite map

| Scope            | Command                          | What it runs                                                        |
|------------------|----------------------------------|---------------------------------------------------------------------|
| unit             | `pnpm test:unit`                 | `packages/*/test/*.test.mjs` (node:test) + web-ui vitest `.test.*` |
| integration      | `pnpm test:integration`          | `test/*.test.mjs` (scenario matrix, surfaces, error parity)         |
| coverage gate    | `pnpm test:coverage`             | unit+integration with `--gate` thresholds                           |
| e2e (browser)    | `pnpm test:e2e`                  | Playwright `./e2e` (chromium + mobile-chromium)                     |
| consistency      | `pnpm test:matrix`               | `test/matrix-consistency.test.mjs`                                  |

Node packages run on the **compiled `dist/`** (like production), so `dist/` is
the measured surface. The web-ui component tests run under **vitest** against
`src/` (Vite/tsx), not node:test.

## 3. Coverage

Policy lives in `test/coverage.config.mjs` (single source of truth; no c8/nyc —
Node ≥ 25 ships the V8 collector with threshold flags).

- **Measured surface** = the compiled `dist/**/*.js` of `plan-core`,
  `plan-server`, `plan-mcp`, `pi-adapter`, `agent-plan`.
- **Excluded**: `web-ui-dist/**` (copied Vite bundle), `plan-web-ui/dist/**`,
  `**/dist/cli.js` (bootstrap entrypoints), `**/test/**`, `*.test.mjs`,
  `*.d.ts`, `**/node_modules/**`.
- **Final gate**: lines ≥ 80, functions ≥ 80, branches ≥ 70.
- **Baseline** (reported without `--gate`): `all`/`unit` → 79/76/72,
  `integration` → 60/65/66. Re-derive the baseline by hand (floor of the
  minimum observed across repeated runs) when big branches land — see the
  derivation comments in `coverage.config.mjs`.

Reports are always written (even on failure) to
`reports/<scope>[/<package>]/{results.json, coverage.lcov, report.json,
report.html}` so CI can inspect what broke.

### Changing exclusions / thresholds

Edit `test/coverage.config.mjs` only:

- Add a surface to `include` if it is real, unit-testable source that should
  count (rare — new packages are added there).
- Add to `exclude` for generated bundles, bootstrap entrypoints, or test code.
  **Do not exclude source just to raise the number** — that hides untestable
  code behind a mock and breaks the F015 contract.
- Raise `gate` only with explicit, agreed justification; lower it only when a
  genuinely unavoidable bootstrap wrapper is involved, and document why in the
  file's derivation comments.

## 4. Fixtures & determinism

All fixtures live in an isolated `mkdtemp` directory and **never touch a user
repository**. See `test/helpers/fixtures.mjs`.

- `createPlannerFixture({ name, seed })` → `{ root, planRoot, store }` with a
  fresh `PlanStore` on `<root>/.planner`. `store.enableAutoSync(true)` is on.
- `seedFixture(store, seed)` re-seeds an existing store (second pass).
- Seeds: `empty` (init only), `minimal` (1 feature + 1 phase + 1 task + 1
  linked requirement), `full` (3 features × mixed-status phases + requirements
  + pending/archived handoffs), `terminal`, `resume-needed`,
  `legacy-single-file`.
- `readPlanSnapshot(planRoot)` returns a deterministic JSON view for
  persistence assertions. `BASE_TIME` is fixed so seeded plans are byte-stable.
- **Cleanup**: every temp root is tracked in a registry; `cleanupFixtures()`
  (called by `after()` hooks) drains it. Never point a store at `cwd`, a real
  project, or `~`; always use a fixture or `createTempRoot()`.

## 5. Adding a shared scenario

Scenarios are harness-agnostic and defined once in `test/scenario-matrix.mjs`.
Runners (P053–P059) consume them and MUST NOT redefine scenario content.

A scenario:

```js
{
  id: "group.domain.name",          // stable, namespaced
  title: "human readable",
  group,                            // bootstrap|create|refs|atomicity|checklist|
                                    // reorder|rollup|requirements|handoff|
                                    // lifecycle|repair|loadstop|resume|ui
  category,                         // positive|negative|lifecycle|persistence|parity|e2e
  harnesses: ["core","api","mcp","pi"],  // subset of core|api|mcp|pi|ui|e2e
  fixture: "minimal",               // one of the SEEDERS
  surfaces: ["core.saveFeature", "api.createFeature", "mcp.featureAdd", "pi.tool.featureCreate"],
  steps: ["Create a feature with a valid name.", "…"],
  expects: {
    ok: true,
    errorMatch: /name required/i,   // optional
    errorCategory: "validation",    // optional
    status: /done/i,                // optional
    data: { id: (v) => typeof v === "string" },  // named checks on normalized data
    snapshot: { /* checks on persisted JSON */ },
    verify: async (ctx) => { /* deeper cross-checks via ctx.{store,api,mcp,pi} */ },
  },
}
```

Steps:

1. Add the scenario to `scenario-matrix.mjs` with the `surfaces` it exercises
   (ids must already exist in `surfaces.mjs` — see section 6).
2. If a new harness boundary (executor) is needed, register it in
   `test/helpers/runner.mjs` (`registerExecutor`). The node packages call the
   real handler modules directly (no child process) so they **contribute
   coverage**.
3. Run `pnpm test:matrix` — `test/matrix-consistency.test.mjs` asserts unique
   ids, valid enum values, fixture names exist, surface references resolve, and
   expectation contracts are well-formed.

## 6. Public-surface inventory workflow

`test/surfaces.mjs` is the single test-owned inventory of every public surface
that must be exercised. It is pure data (no imports/side effects). Groups:

- `coreSurfaces` — `PlanStore` methods + pure helpers (`naming`, `refs`,
  `checklist`, `display-status`, `schema`, `recap`, …).
- `apiSurfaces` — HTTP routes in `packages/plan-server/src/serve.ts`.
- `mcpSurfaces` — MCP tools in `packages/plan-mcp/src/index.ts`.
- `piSurfaces` — Pi commands/tools/hooks in `packages/pi-adapter/src/index.ts`.
- `uiSurfaces` — Web UI loaders/actions/components.

Workflow when a surface is added or changed:

1. Add an entry to the right `*Surfaces` array: `{ id, kind, name, description,
   anchor }`. `anchor` is a `file:line` source reference (may drift; the runner
   keys on the stable `id`).
2. If no scenario references it yet, set `coverage: { phase, reason }` naming
   the phase that will exercise it (so the inventory stays honest about gaps).
3. Reference the `id` from one or more scenarios (section 5).
4. `pnpm test:matrix` validates the whole graph.

`matrix-consistency.test.mjs` (P052) is the guard that keeps the inventory,
matrix, fixtures, and runner coherent across refactors.

## 7. Pi host boundary (how to write a Pi adapter test)

The Pi adapter is a module singleton, so at most one host is active per
process. The harness in `packages/pi-adapter/test/helpers/pi-host-fixture.mjs`
loads the **real** `dist/index.js` against a **fake Pi host** that implements
only the `ExtensionAPI`/`ExtensionContext` surface the adapter touches
(`on`, `registerTool`, `registerCommand`, `sendMessage`, `appendEntry`, and a
recording `ui` + `sessionManager`). Persistence stays REAL: real `PlanStore`
on a real temporary `.planner`, real in-process web server for `planner-web`
and `/planner load`.

```js
import { createPiHost, cleanupPiHosts, toolText } from "./helpers/pi-host-fixture.mjs";

test("feature create validates name", async () => {
  const host = await createPiHost({ name: "feat", seed: "minimal" });
  try {
    const res = await host.runTool("feature_create", { name: "" });
    assert.equal(res.isError, true);
    assert.match(toolText(res), /name/i);
  } finally {
    await host.close();   // emits session_shutdown → stops server, resets adapter state, removes temp root
  }
});

after(cleanupPiHosts);   // safety net drains every live host
```

Key points:

- `host.runCommand(args)` drives the `/planner` command; `host.runTool(name,
  params)` drives a registered tool; `host.emit(event, payload)` drives a
  lifecycle hook (`session_start`, `session_shutdown`, `turn_start`, …).
- `keepRootOnClose: true` keeps the root so a second host can reopen the same
  project (repeated-session tests).
- The fake `ui` records `notify/input/select/confirm/editor` calls; set
  `ui.confirmAnswer`, `ui.selectAnswer`, `ui.inputAnswers` to script
  interactions.
- **Mock policy**: only the Pi host boundary is mocked. Never mock `PlanStore`,
  the filesystem, or the scenario matrix.

## 8. Web UI component tests

Web UI tests run under **vitest** (not node:test) and are not part of the V8
coverage gate. Run them with `pnpm --filter @agent-plan/web-ui exec vitest run`
(or `pnpm test:unit`, which includes them).

Fixtures in `packages/plan-web-ui/test/fixtures.tsx` provide `makeFeature`,
`makePhase`, `makeTask`, `makeRequirement`, `makeProject`, `installFetchMock`
(mocks `globalThis.fetch`), `jsonResponse`/`textResponse`, and `renderRoute`
(React Router memory router + `@testing-library/react`). Tests assert DOM and
loader/action behavior against a mocked API client — no real server needed.

## 9. Playwright e2e (browser)

`playwright.config.ts` runs `./e2e` on two projects: `chromium` (Desktop
Chrome) and `mobile-chromium` (Pixel 7). `trace`/`screenshot`/`video` are
retained on failure; `retries: 2` and `workers: 2` only under `CI`.

`e2e/fixtures.ts` self-starts a **real** `plan-server` against the built web-ui
bundle on a **dynamic port** (`port: 0`), so each test owns an isolated
temporary project:

```ts
test("dashboard renders", async ({ planner }) => {
  await planner.seed("full");
  const res = await planner.request("/project");
  expect(res.body.name).toBeDefined();
  // … browser assertions via page …
});
```

- Always use `planner.url` / `planner.handle.url` and `port: 0`; **never
  hardcode** 3030/5175/3090.
- `pnpm test:e2e` rebuilds the web-ui + server dist (the e2e `staticDir` is
  `packages/plan-web-ui/dist`), so a stale bundle is not served.
- `pnpm test:e2e:install` installs browsers (`playwright install chromium`)
  when they are missing.

## 10. Troubleshooting

### WebSocket failures
The hub is `packages/plan-server/src/ws-hub.ts` (events `connected`,
`ping-pong`, `file-changed`, `plan-rendered`). In tests, prefer **API
assertions over WebSocket timing** — live-update events are eventually
consistent and are the usual source of flake. When proxying in dev, forward
`/ws` with `ws: true`. If a test needs the socket, connect to
`${handle.url}/ws` after the server is up and assert on the first
`connected` frame.

### Dynamic-port / EADDRINUSE
If you see "address already in use", you hardcoded a port. Every server (dev
server, `plan-server`, e2e, MCP/in-process web) must use `port: 0` and read
back `handle.url`. Two fixtures colliding on a port means they are not using
per-test temp roots / `testInfo.parallelIndex` in the fixture name.

### Flaky filesystem / cleanup
Fixtures use `mkdtemp` per test and a tracked registry drained by `after()`
(`cleanupFixtures` / `cleanupPiHosts`). Symptoms of a leak: "file already
exists", "ENOENT on reload", or leftover `agent-plan-*` dirs in the system
temp. Fix: ensure every `createPiHost`/`createPlannerFixture` is closed or
covered by an `after()` drain, and never share a temp root across parallel
tests.

### Browser context / cache
Playwright launches its own browser; no shared cache. If the UI looks stale,
the bundle is stale — `pnpm test:e2e` rebuilds it. Inspect
`playwright-report/` and `test-results/playwright/` (trace/screenshot/video)
from failed runs.

### Failing consistency check
`pnpm test:matrix` fails when a scenario references a missing surface id, a
fixture seed name is wrong, ids collide, or an `expects` contract is
malformed. Read the assertion message — it names the offending id.

## 11. CI

`.github/workflows/ci.yml` wires `pnpm test:coverage` (build + unit +
integration + gate) and a self-contained Playwright `e2e` job (installs
chromium, `pnpm build`, `playwright test`, uploads `playwright-report` and
`test-results` on failure). Coverage reports are uploaded always. Publication
(`publish.yml`) is separate and never runs tests.

The coverage gate is **red by design until the codebase reaches 80/80/70**;
the baseline is reported so progress is visible. Do not "fix" a red gate by
widening exclusions — raise coverage or, for genuinely unavoidable bootstrap
code, document a threshold exception in `coverage.config.mjs`.

## 12. Deterministic cleanup, quarantine & repeatability

### Cleanup contract
- Every fixture owns a `mkdtemp` root; `createPlannerFixture` / `createTempRoot`
  register it in a tracked registry drained by `cleanupFixtures()`, and
  `createPiHost` is drained by `cleanupPiHosts()`. Both run in an `after()` hook
  in every test file, so a leaked fixture is reclaimed at file end.
- Long-lived resources are closed **per test** in `finally`: Pi hosts call
  `host.close()` (emits `session_shutdown` → stops the in-process web server,
  resets singleton adapter state, removes the temp root); `server-fixture` and
  `mcp-fixture` call `handle.close()`; the e2e `planner` fixture closes the
  server and `rm`s its temp root in `finally`.
- A `describe`/file must never share a temp root across parallel tests, and must
  never point a `PlanStore` at `cwd` or a real project — only at a fixture root.

### Quarantine policy (environment-dependent checks)
Tests that invoke the **real `pi` CLI / a model provider** are environment-
Dependent and flaky by nature. They are **quarantined**, not run in the default
CI suite:
- Gated behind an opt-in env flag (e.g. `PLANNER_CLI_SMOKE=1`).
- Self-probe the binary/provider first; if absent, call `t.skip(...)` with a
  clear reason so the main suite is never blocked (see
  `packages/pi-adapter/test/resume.test.mjs`).
- Never counted toward the `pass === tests` invariant of the main suite.

When you add a new environment-dependent check, wrap it the same way: env flag +
capability probe + `skip` on missing capability.

### Retry policy
- **Playwright e2e** retries (`retries: 2`, `workers: 2`) only under `CI` —
  justified for genuine browser/timing flake.
- **Node suites (node:test)** must **not** retry. A flaky node test is a real
  bug (timing, leaked port, singleton state, shared temp root); fix the root
  cause, do not mask it with retries.

### Determinism & repeatability
- Clocks/IDs are fixed: `fixtures.mjs` uses `BASE_TIME` and deterministic
  counters, so seeded plans and references are byte-stable across runs.
- Every server uses `port: 0` and reads back `handle.url`; no hardcoded ports.
- **Verify stability**: run `pnpm test` twice back-to-back; the pass counts must
  match run-to-run, and `git status` must show **no changes** to the repo
  `.planner/` (fixtures are isolated under `mkdtemp`). If the repo planner state
  changes, a test is pointing at `cwd` — stop and fix it.

### Failure diagnostics
- Every scenario assertion carries `where: <scenarioId> (<harnesses>)` in its
  error (see `assertScenarioExpectations` in `test/helpers/runner.mjs`), so a
  cross-harness parity failure names the exact scenario and the mismatching
  boundary.
- Data/snapshot mismatches print `expected … got …` with the actual normalized
  value; persistence checks compare the transport-independent
  `normalizePersistedSnapshot` view, so a CI failure names the ref/field.
- For surface/scenario/fixture coherence errors, run `pnpm test:matrix` — it
  reports the offending `id` (duplicate id, missing surface reference, unknown
  fixture seed, malformed `expects`).
