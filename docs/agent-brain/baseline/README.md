# Agent Brain baseline — P116(F025)/T461

Reproducible baseline for the six reported reliability failures and the
migration storage boundary, captured on:

- **Checkout**: `feat/agent-brain @ 59f9028059e3b6206dd2545ec405f6fdc8d139e1`
- **Packages**: `@agent-plan/core` 0.4.11, `@agent-plan/mcp` 0.4.11, `@agent-plan/server` 0.4.11
- **Date**: 2026-11-14 (checkout), report finalized 2026-11-15

Every claim below is backed by a runnable fixture. The fixtures assert the
**current observable behavior** of this checkout — not the desired behavior.
When T462/T463/T464 change behavior, the assertions are updated to the
corrected contract with new evidence.

| Suite | Runner |
|---|---|
| Core (six failures + storage boundary) | `packages/plan-core/test/agent-brain-baseline.test.mjs` |
| Real MCP outputs | `packages/plan-mcp/test/agent-brain-baseline-mcp.test.mjs` |
| Real server behaviors | `packages/plan-server/test/agent-brain-baseline-server.test.mjs` |
| Measurements | `packages/plan-core/test/agent-brain-baseline-measurements.test.mjs` → `docs/agent-brain/baseline/measurements.json` |

All suites use `mkdtemp` isolation and stop every owned process. No real
project is migrated, no dashboard is started, and no real planner data is
touched.

## The six reported failures

### 1. Several handoffs

**Reproducible input** (`case 1: several handoffs`): three phases of one
feature, each carrying a persisted handoff, fed into
`recommendNextWork(..., evidence.handoffs)` in persistence order.

**Current observable behavior**: all three handoffs surface as advisory
claims and carry no precedence distinction (`claims.source === "handoff"`
with a single shared kind); replacing one handoff archives the superseded
content (`listArchivedHandoffs` length 1). A phase file degraded to the old
format (no `sessionInfo`, no `handoffUpdatedAt`, inline `handoff`) still
reloads with defaults filling the newer fields.

**Expected correction** (T462): one shared next-work contract with a
deterministic precedence order over handoff evidence, so a resume session
never has to guess which handoff is authoritative.

### 2. Repeated resume reads

**Reproducible input** (`case 2: repeated resume reads`): a task/phase/feature
with persisted `sessionInfo` attestations at T0; then an unrelated write (a
second task) bumps the phase revision.

**Current observable behavior**: a fresh session with no read evidence must
read all three entities (task+phase+feature, `requiredReads.length === 3`).
After the unrelated write, the phase attestation goes **stale**
(`entityRevision > entry.createdAt`) even though the entity content the
session needs did not change. The MCP measurement adds a concrete cost: a
start attempt after task/phase/feature reads still fails with
`REQUIREMENTS_READ_REQUIRED`, forcing one more read per task
(`measurements.json` → `mcpScenario`).

**Expected correction** (T462/T489): attestation/revision scoping in the new
storage boundary so a valid attestation survives unrelated writes.

### 3. Ignored conventions

**Reproducible input** (`case 3: ignored conventions`): project guidelines
with content but no session attestation; a `.planner/SKILL.md` overwritten
with diverging content after provisioning.

**Current observable behavior**: `projectGuidelinesReadStateForSession`
returns `missing`, while `checkExplicitTaskStart` stays **eligible** —
conventions are advisory only, no gate consults them. A customized managed
skill is preserved with `status: "customized"` and the reply says
"Reconcile it manually" — no reconciliation mechanism exists.

**Expected correction** (AB-IMP-003/T505, T468): configurable conduct rules
delivered consistently, with enforcement at the right gate instead of
advisories.

### 4. Nested detours

**Reproducible input** (`case 4: nested detours`): two approved deviations,
A (resume → T1, temporary → T2) and B (resume → T2, temporary → T3), taken
in that order.

**Current observable behavior**: while both deviations are live the
selector follows the newest (B) and proposes its temporary task (T3). Once
T3 is done the chain returns exactly one LIFO level (to T2's detour task,
not straight to the outermost preserved task). Resume proposals are
standardized (`buildResumeRequiredProposal`).

**Expected correction** (T464): nested interrupted work preserved and
resumed across phase closure with an explicit chain; the LIFO behavior
observed here is the baseline the fix must subsume. *Uncertain cause*: the
reported loss/loop cases were observed in live sessions; this fixture only
certifies the pure selector path, not adapter drift.

### 5. Current-phase priority bias (AB-IMP-007 / AB-IMP-008)

**Reproducible input** (`case 5`): (a) a low-priority feature with a ready
task plus a foreign high-priority feature passed as `currentPhaseId`;
(b) a priority-0 phase with zero tasks plus a task-bearing fallback phase.

**Current observable behavior**: (a) `currentPhaseId` overrides global
priority unconditionally ("Continue the current phase") with **no
session-ownership check** — a session pointed at another agent's phase
receives that phase's work, which is exactly the reported AB-IMP-007
failure; (b) the empty high-priority phase is skipped silently and no claim
proposes discussing it (`planningClaims.length === 0`), the reported
AB-IMP-008 failure.

**Expected correction** (T462/T463): session-aware phase continuity and an
explicit proposal for higher-priority empty phases. *Uncertain cause* for
AB-IMP-007: `currentPhaseId` is adapter-supplied state; whether the bug
originates in a stale adapter value or in the selector's missing ownership
check cannot be decided from the fixture alone — both are recorded.

### 6. Duplicate capability creation

**Reproducible input** (`case 6: duplicate capability creation`):
repeated `syncProjectPlannerSkill`/`syncProjectGrillMeSkill` calls, plus an
old-format copy without the managed hash header.

**Current observable behavior**: `store.init()` already provisions both
managed skills; repeated syncs are idempotent (`created` → `current`, no
duplicate files). A legacy copy with canonical content but no header is
adopted in place (`adopted`/`updated`), not duplicated. Drift is contained
by the managed hash header — but a *customized* copy simply stalls (see
case 3), and nothing reconciles multiple harnesses to one source.

**Expected correction** (T468/T469): canonical cross-harness delivery with
single-source ownership; the baseline certifies that duplication is
prevented within one planner root.

## Races, failed/incomplete replies, workspace inference

- **Same-task race (MCP)** (`agent-brain-baseline-mcp.test.mjs`): two
  concurrent MCP sessions starting the same task — exactly one gets
  `started: true`; the loser's reply explains the denial. One persisted
  owner afterwards.
- **Same-task race (HTTP server)** (`agent-brain-baseline-server.test.mjs`):
  two concurrent POSTs to `/tasks/:id/start` — one 200, one refusal
  (400 today, not a typed 409 conflict). Exactly one active owner persists.
- **Failed/incomplete replies**: unknown task/phase reads reply with
  readable failures (not crashes); incomplete tool arguments still produce a
  defined reply (baseline — schema strictness may change with T462); the
  core surfaces `Task not found` / `read failed: <path>`; empty plans yield
  an explicit `insufficient` recommendation.
- **Source workspace inference**: without `AGENT_PLAN_ROOT` the MCP server
  resolves the planner as `cwd/.planner` (real stdio capture in the MCP
  suite). Recorded as a migration assumption: the storage boundary must make
  the workspace identity explicit instead of inferring it from the process
  cwd.

## Migration baseline assumptions (storage boundary)

Captured without touching real data (mkdtemp fixtures in
`agent-brain-baseline.test.mjs` → `migration storage boundary`, and
`agent-brain-baseline-server.test.mjs`):

| Assumption | Current evidence |
|---|---|
| **Descriptor missing** | A `.planner/` without `manifest.json` is reported by `exists()` as **not a plan**; `loadManifest()` fails with `read failed` — the descriptor is the identity anchor of a workspace. |
| **Descriptor incompatible** | A manifest with `schemaVersion: 999` is rejected by Zod validation (`schemaVersion` literal), never migrated silently. |
| **Legacy layout** | A legacy single-file `features.json` still loads through the fallback path and migrates to per-feature files on demand. |
| **Per-project server** | Each `serve()` instance is bound to one `planRoot`; two servers on two roots never see each other's features (real HTTP capture). |
| **Missing HOME** | With `HOME=""`/`USERPROFILE=""`, `os.homedir()` returns **""** without throwing (macOS probe, 2026-11-15). User-scope installs must fail explicitly rather than write into an empty path. |

## Measurements

`docs/agent-brain/baseline/measurements.json` holds the checked-in snapshot
(regenerate with `AB_BASELINE_REPORT=<path> node --test
--test-name-pattern "no-op, small and large"
packages/plan-core/test/agent-brain-baseline-measurements.test.mjs`).

Headline findings:

- The recommendation **reply** is size-bounded and independent of plan
  scale: 1560 bytes at 27 entities and at 632 entities, claim list capped
  at 8. The full recommendation **object** grows with plan size
  (4566 → 10341 bytes). The reported diagnostic cost lives in what adapters
  emit around the bounded core, not inside it.
- Real MCP resume-context scenario: 6 tool calls, 1723 text bytes,
  6699 structured bytes — ~4x text-to-structured duplication — plus one
  extra forced read per task (`REQUIREMENTS_READ_REQUIRED` on start).
- Model tokens are not observable at core/MCP/server layers and stay `null`
  in every measurement; they require adapter-level capture and are recorded
  as an open boundary rather than invented.

## Unverified boundaries

- The six failure fixtures certify the core selectors, the real MCP server
  surface and the real HTTP server. They do not exercise the Pi adapter or
  a live model session, so token costs and agent-driven read repetition
  remain model-visible only.
- The reported AB-IMP-007 failure has two candidate causes (stale adapter
  `currentPhaseId` vs missing session-ownership check in the selector);
  both are recorded, neither is attributed.
- Same-task races are captured against one server process and two MCP
  processes; a two-computer scenario is explicitly out of scope
  (architecture.md).
