# Agent Plan — Checklist & Release Notes

## P039 — Derived parent display statuses + Web UI status readability

### New derived presentation statuses (parent-only)

The canonical workflow model remains unchanged:

```
planned | in-progress | waiting | blocked | deferred | done | canceled | rejected
```

For parent entities (`feature`, `phase`) two **presentation-only** statuses are now derived at read time and used by the Web UI:

- `started` — the parent has clearly begun (historical progress exists) but no child is active now, and the unfinished remainder is mixed or cannot honestly collapse to one specific workflow label.
- `closed` — every child is terminal but outcomes are mixed (e.g. `done + canceled`, `canceled + rejected`).

These states are **never persisted**; they are computed from children's canonical workflow statuses.

### Derivation algorithm

1. If any meaningful child is active now → `in-progress`.
2. If every child is terminal:
   - all `done` → `done`
   - all `canceled` → `canceled`
   - all `rejected` → `rejected`
   - otherwise → `closed`
3. Compute `unfinished = meaningful ∩ {planned, waiting, blocked, deferred}`.
   - homogeneous `waiting` → `waiting`
   - homogeneous `blocked` → `blocked`
   - homogeneous `deferred` → `deferred`
4. If all unfinished are `planned` and the entity has never started → `planned`.
5. Fallback → `started`.

`meaningful` excludes `canceled` and `rejected` (terminal non-positive outcomes).

### Visual signals (color + icon + pattern)

Each display status maps to a token with color, icon, and pattern so states remain distinguishable in grayscale / colorblind mode:

| Status        | Color var                   | Icon        | Pattern      | Meaning                     |
|---------------|-----------------------------|-------------|--------------|-----------------------------|
| planned       | `--color-status-planned`    | circle      | solid        | Not started                 |
| started       | `--color-status-started`    | play-start  | dashed       | Begun but not active now    |
| in-progress   | `--color-status-in-progress`| play        | pulse        | Active now                  |
| waiting       | `--color-status-waiting`    | clock       | solid        | Waiting on dependency       |
| blocked       | `--color-status-blocked`    | stop        | solid        | Impediment                  |
| deferred      | `--color-status-deferred`   | pause       | solid        | Postponed                   |
| done          | `--color-status-done`       | check       | solid        | Completed                   |
| closed        | `--color-status-closed`     | check-mixed | stripe       | Closed with mixed outcomes  |
| canceled      | `--color-status-canceled`   | ban         | hatch        | Canceled                    |
| rejected      | `--color-status-rejected`   | x           | crosshatch   | Rejected                    |

### Surfaces updated

- `packages/plan-core/src/display-status.ts` — core algorithm and types.
- `packages/plan-web-ui/src/lib/derive-display.ts` — browser-safe mirror of the algorithm.
- `packages/plan-web-ui/src/lib/display-status-tokens.ts` — token mapping.
- `packages/plan-web-ui/src/components/ui/status-badge.tsx` — `DisplayStatusBadge` primitive with icon + pattern + breakdown tooltip.
- `packages/plan-web-ui/src/lib/dashboard-tree.ts` — `WorkTreeFeature` / `WorkTreePhase` now carry a computed `ParentDisplay`.
- `packages/plan-web-ui/src/components/dashboard/work-tree-rows.tsx` — feature/phase rows render `DisplayStatusBadge` with breakdown.
- `packages/plan-web-ui/src/routes/feature-detail/route.tsx` — feature header badge uses display layer.
- `packages/plan-web-ui/src/routes/phase-detail/route.tsx` — phase header badge uses display layer.
- `packages/plan-web-ui/src/components/features/feature-row.tsx` — feature list row badge uses display layer.
- `packages/plan-web-ui/src/components/phases/phase-row.tsx` — phase list row badge uses display layer.
- Task rows and task-detail headers keep canonical workflow status (using the new token styling).

### Accessibility

- Every `DisplayStatusBadge` exposes an `aria-label` / tooltip like `Started · 1 done · 2 planned · 1 waiting` when a breakdown is provided.
- Icons differ between statuses so color is not the only signal.
- Patterns (`dashed`, `pulse`, `stripe`, `hatch`, `crosshatch`) provide shape/texture differentiation.
- Reduced-motion preference disables the `in-progress` pulse animation.

### Filters

List filters continue to operate on **canonical workflow status**; the display layer is presentation-only and does not change filter semantics.

### Open questions resolved

- Derived display status is computed client-side in the Web UI via the browser-safe `derive-display.ts` helper. The core exports the same algorithm for adapters/servers that want it.
- `started` and `closed` are not persisted workflow statuses; they are parent-only derived presentation states.

## Unreleased changes

### Core

- Strict ref resolution in create tools: `task_create` / `phase_create` resolve and validate the target ref as a UUID before allocating sequence numbers or writing.
- `validateResolvedTarget` helper added to `@agent-plan/core/naming` and used by both `pi-adapter` and `plan-mcp`.
- `PhaseSchema.featureId` and `TaskSchema.phaseId` require UUIDs; `savePhase` enforces an existing owning feature.
- Added display-status derivation module (`packages/plan-core/src/display-status.ts`).

### Adapters

- Pi adapter and MCP server now return a clear error and skip number allocation when a create tool receives an unresolved/orphan ref.
- Added adapter-level integration tests for valid ref canonicalization, orphan ref rejection, and race-condition target deletion.

### Web UI

- Derived display-status layer applied to Work Tree, detail headers, and list rows.
- New `DisplayStatusBadge` primitive with icon + pattern + breakdown tooltip.
- Responsive mobile layout preserved; filter semantics unchanged.

### Tests

- Added core tests: `validate-resolved-target.test.mjs`, `create-validation.test.mjs`.
- Added adapter integration tests: `packages/pi-adapter/test/ref-validation.test.mjs`, `packages/plan-mcp/test/ref-validation.test.mjs`.
- Full suites: core, pi-adapter, plan-mcp tests pass; monorepo `pnpm check` is clean.
