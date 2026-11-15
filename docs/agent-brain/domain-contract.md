# Agent Brain shared domain contract

Status: contract v1 defined 2026-11-15 at checkout `feat/agent-brain` @ `d574dd6` (P116(F025)/T462). This is the one domain contract for identity, work ordering, typed results, context delivery, phase continuity and revision-aware results. Service, storage and recovery architecture live in [architecture.md](architecture.md); product decisions live in the [decision register](decisions.md). Where this contract names current behavior, it cites the owning module at the inspected checkout as dated evidence — the contract is normative for the implementers, not a description claim.

## 0. Scope, authority and versioning

Consumers: `@agent-plan/core` (reference implementation today), `@agent-plan/mcp`, `@agent-plan/server`, `@agent-plan/pi-adapter` and the Web UI. Implementing owners: T489 (identity separation), T502 (SQLite authority), T490 (one coordinated service), T463/T464 (selector and returns), T465/T466 (resume/context), T496 (consistency), T509/T510 (session continuity and empty-phase claims).

Precedence: canonical Accepted Decisions > this contract > current adapter behavior. Persisted fixture behavior is evidence, never a production policy source. The contract is versioned: additive clarifications update this document in place; a change that would break an existing consumer's parsed shapes requires an explicit version transition (the `version` field on delivered documents, see §4), never a silent reinterpretation.

## 1. Identity contract

All seven identities stay distinct. Confusing any two is a contract violation, not a spelling choice.

| Identity | Meaning | Stable across | Current carrier (evidence) | Boundary owner |
| --- | --- | --- | --- | --- |
| `projectId` | Durable planner identity | branches, renames, relocations | implicit — the `.planner` directory is the de-facto id | T489 |
| Repository registration | One local clone of the project | worktrees of that clone | none (no registration record exists) | T489 |
| `workspaceId` | One registered checkout/worktree | nothing — path and branch are mutable locators | none | T489 |
| Planner caller | Authenticated client/session whose reads and task lifecycle are audited | the client's connection | `sessionId` strings passed by adapters (e.g. `mcp-process:<uuid>`, seen in `sessionInfo`) | T490 |
| Native harness session | The harness conversation itself | the harness session | not represented; adapters may only pass their own session id as caller — never as a client-set ownership alias | T490/T491 |
| `executionId` | One attributable attempt at a task: caller, source fingerprint, evidence | the attempt | none (no execution records exist) | T491 |
| Actor / requester | Who performs vs who requested a mutation | the mutation | both default to the caller today | T490 |

Resolution rules (normative; architecture.md §3 remains the binding narrative):

1. The nearest descriptor walking up from the working directory wins; sub-projects of a monorepo get their own planner.
2. A compatible descriptor resolves through the service; an incompatible one yields a typed compatibility error.
3. Missing descriptor with legacy `.planner` offers a validated migration; neither present offers initialization.
4. Never fall back silently, and never create an empty substitute when data is missing (baseline: a `.planner/` without `manifest.json` is reported as not a plan; a `schemaVersion: 999` manifest is rejected, not migrated).
5. Caller identity comes from authenticated transport, never from client-supplied strings that claim ownership (baseline: with `AGENT_PLAN_ROOT` unset the MCP server infers `cwd/.planner` — workspace identity must be explicit, not inferred from process cwd).

## 2. Work ordering contract

One explainable order, evaluated top-down; the first hit wins. Selection is advisory: eligibility (§2.1) is separate and mandatory.

| # | Rule | Owner of current implementation |
| --- | --- | --- |
| 0 | Multiple active tasks for the caller's scope → typed `conflict`, never an automatic pick | `task-selection.ts` (`recommendNextTask`) |
| 1 | Owned active work: the caller's single `in-progress` task is resumed (a session-less caller resumes any single active task) | `task-selection.ts` |
| 2 | Valid returns, newest first: a deviation in a return-required state (`resume-required`, legacy synonym `resolved`) returns to its preserved task; otherwise a live approved/active deviation continues its temporary task; then the most recent `pauseSnapshot` checkpoint (LIFO) | `task-selection.ts`, `schema.ts` `WorkDeviationSchema` |
| 3 | Exclusion: tasks held by another session's live return stack are never offered to this caller | `task-selection.ts`, `session-focus.ts` (`deviationsForSession`) |
| 4 | Global ready work: `planned` tasks whose `dependsOn` are all `done`, whose parents are not hard-unavailable (`blocked`/`deferred`/`canceled`/`rejected`), ordered feature → phase → task by `(priority, number)` | `task-selection.ts` |
| 5 | Current-phase affinity: `currentPhaseId` may reorder only within rule 4's globally ready set and only for work this caller may own. Today it overrides global priority unconditionally with no ownership check (AB-IMP-007 baseline) — the fix belongs to T509 on the shared selector; T462/T463 keep ownership of the contract | T509 (adaptation), T463 (unification) |
| 6 | An eligible but empty higher-priority phase must surface a planning claim, not vanish silently (AB-IMP-008 baseline) | T510 (adaptation), T463 (unification) |
| 7 | Parked tasks (`deferred`/`waiting`/`blocked`) whose every named ref is finished are flagged "may be ready" and compete with fresh work in the claims list | `on-hold.ts` (`listOnHoldWork`, `readyToResume`) |

Standing decisions this contract preserves: no global individual-task queue, no automatic priority preemption of active work, recommendations advisory, and the warning-only no-task guard (Accepted Decision `7995854e`). Phase continuity never introduces a global exclusive phase lock (decisions.md §Agents).

### 2.1 Eligibility for explicit starts (separate from ordering)

`checkExplicitTaskStart` owns the mandatory invariants; priority is never one of them:

- The task exists and its status is startable (`planned`, or parked `waiting`/`blocked`/`deferred`).
- Parent availability blocks only on hard-unavailable statuses, and a parked task is never blocked by a parent that merely *derived* `blocked`/`deferred` from parked children.
- Every `dependsOn` edge is `done`, except for a task that is the temporary target of a live approved deviation.
- Done/canceled/rejected tasks refuse with the exact reopening wording produced once in core (`startRefusalReason`), so every adapter shows the same text.

Dependency readiness is a distinct mechanism from desired ordering: the same `dependsOn` edges gate explicit starts (mandatory) and merely annotate selection claims (advisory `dependency-ready` claims). They are not scheduling dependencies and never create a queue.

## 3. Typed results and error contract

Every surface consumes the same shapes; no adapter re-derives them.

- **Recommendation result.** `NextWorkRecommendation` (versioned shape): `selection` (`kind`: `active` | `resume` | `priority` | `conflict` | `none`), summaries, bounded `claims` and `onHold`. Claims are capped at 8 (`RECOMMENDATION_CLAIM_LIMIT`); each carries `kind` (`recommendation` | `advisory` | `conflict` | `insufficient`) and `source` (`priority` | `active-task` | `resume-deviation` | `dependency-ready` | `handoff` | `archived-handoff` | `on-hold`, extensible only additively for future evidence sources such as provider/target availability). A claim without surviving evidence yields an explicit `insufficient` claim — never an empty reply.
- **Resume proposal.** `buildResumeRequiredProposal` is the single standardized shape (text + structured `taskId`/`phaseId`/snapshot). A pending resume surfaces loudly but never hard-blocks an explicit start.
- **Typed failures.** Ref resolution distinguishes not-found from ambiguous (`resolveFeatureRefStrict` returns a typed error). Races on one task produce exactly one winner and a typed refusal to the loser (baseline: HTTP start race yields one 200 and one client-error refusal — the loser must become a typed conflict, owner T496). Every failure reaches the client as a shaped reply (JSON envelope, readable reason); an unhandled exception never crashes the host process.
- **Versioned envelope.** HTTP replies carry `apiVersion` and `data`; MCP replies fold reply text into `structuredContent` so structured-only hosts still receive the full text. Result-shape changes ride the §0 version rule.

## 4. Context delivery contract

What "read" means, what counts as evidence, and what may be reused.

- **Gated entities.** Canonical full reads of the exact task, its parent phase, the parent feature, the target-scoped linked requirements, and Project Guidelines. A broad unscoped inventory does not satisfy a start gate.
- **Attestation.** `sessionInfo` entries persist per caller session. A persisted attestation is `valid` while the entity's contract revision is at or before the attestation timestamp, `stale` when it advanced, `missing` when absent. The contract revision is `descriptionUpdatedAt` for phases/features when present, else `updatedAt` — an unrelated write must not invalidate an attestation that did not change the delivered content (T461 baseline case 2; revision scoping is owned by T489/T496).
- **Completeness proof.** A canonical full read is attestable only when the delivered content contains every field of every Accepted Decision (`markCanonicalFullReadForSessionId` throws otherwise). Title-only or truncated reads never count as full reads.
- **Delivery evidence records completed delivery**, never model understanding, comprehension or retained context. After compaction or a context reset, restoration is required even if a persistent receipt survives; reuse is valid only while the content remains in the effective session context.
- **Bounded, lossless delivery.** Oversized content is chunked with a canonical fingerprint and ordered cursors; only a verified complete sequence attests a read (`verifyProjectContextChunks`). A single-response overflow is *not* attested and returns explicit `nextActions` (retry with a larger bound) — partial delivery never masquerades as complete.
- **Restore only what is missing or stale**, rechecked transactionally at start. Truncation, when applied to advisory context, is explicit with a safe-boundary cut and a pointer to the canonical full read.
- **Role-aware API parity.** All surfaces call the same domain functions; no client constructs its own operational store; every mutation records actor and requester. Role/portable-guidance enforcement points are extension seams owned by T467–T469/T504/T505 — today guidelines read-state is advisory only, and this contract records that as the baseline, not the target.

## 5. Phase continuity and returns contract

- **Deviation states** (`WorkDeviationSchema`): `approved` → `active` while temporary work runs; completion of temporary work yields `resume-required` (legacy persisted `resolved` is read as the same state); `resumed`/`canceled` close the entry. `ownerSession` scopes visibility: a session sees its own deviations plus unowned legacy ones (`deviationsForSession`); resume-session storage is pruned to 20 (`RESUME_SESSION_LIMIT`).
- **Nested detours** A → B → C persist, for every level: source task/phase, checkpoint (reason, resume location, how to resume), caller/execution, temporary target and return condition. Completion of C offers B, then A — one LIFO level at a time (T461 baseline case 4; durable multi-level preservation across phase closure is T464's implementation).
- **Blocked returns stay visible** with their reason; they never disappear behind new priority work, and a return to a task taken over meanwhile reports the takeover instead of failing.
- **Execution lock is the only planner block** (decisions.md §Agents): `in-progress` blocks another live session's start; `parked` does not block (takeover warns and is recorded); `abandoned` follows the heartbeat lease (~30 s heartbeat in code, ~2 min expiry). The same logical agent reclaims its own tasks from a new conversation; idle live owners are shown idle and taken over only with explicit confirmation; the Web UI offers a human Release action. These states are contract targets; today only `activeOwnerSession` atomicity and the pause snapshot exist (dated evidence).

## 6. Source/target availability extension points

This contract reserves the seams; implementation owners are named:

- **Provider/target availability states** — `absent`, `unbound`, `incompatible`, `denied`, `disconnected`, `stale` — are typed facts, never booleans or silent empty results (owners T473–T475 for providers, T491–T493 for target integration).
- **Verification evidence** is revision-bound: a result at one revision never certifies another (owner T491; AgentTest scope decided 2026-11-02).
- **Claim source extensibility**: new evidence kinds enter as additive `RecommendationClaimSource` values with their own precedence discussion; they never silently outrank rules 1–4 above.

## 7. Bounded budgets with explicit continuation

Every budget has a named constant, one owner, and an explicit continuation path. These are contract floors measured today; implementers may tighten them only with a measured replacement.

| Budget | Constant | Module | Continuation |
| --- | --- | --- | --- |
| Recommendation claims | `RECOMMENDATION_CLAIM_LIMIT` = 8 | `task-selection.ts` | `onHold` list carries the overflow; dependency-ready claims name the reason |
| On-hold reason preview | 160 chars, list limit 8 | `on-hold.ts` (`renderOnHoldWork`) | full reason in the task's status log; count of withheld items stated |
| Ambient decision / phase work-map context | 8000 chars each | `task-context.ts` | truncation suffix points to canonical full reads; open work admitted before closed |
| Single project-context response | 32000 chars default (`maxChars`) | `project-context.ts` | ordered fingerprint cursors; retry with a larger bound; overflow is never attested |
| Resume sessions per project | `RESUME_SESSION_LIMIT` = 20 | `session-focus.ts` | least-recently-updated pruned |
| Task start context block | phase/feature/requirements/work-map injection, no model tokens | `task-context.ts` (`buildPhaseContextBlock`) | canonical full reads on demand |

## 8. Baseline case → implementation owner mapping

Every T461 baseline case (docs/agent-brain/baseline/README.md) maps to exactly one implementation owner; the contract rules above are the acceptance bar.

| Baseline case | Contract rule | Implementation owner |
| --- | --- | --- |
| 1. Several handoffs, no precedence | Rule 2 orders returns deterministically; handoff evidence is advisory, archived handoffs never authoritative | T463 (selector), T465 (resume overview) |
| 2. Repeated resume reads / stale attestations | §4 revision scoping; unrelated writes never stale a valid attestation | T489 (storage), T496 (consistency), T466 (reuse) |
| 3. Ignored conventions / customized skills never reconciled | §4 parity + conduct enforcement seams | T467–T469, T504, T505 |
| 4. Nested detours resolve one LIFO level | §5 nested returns | T464 |
| 5a. `currentPhaseId` overrides priority without ownership check | Rule 5 affinity with ownership check | T509 |
| 5b. Empty high-priority phase silently skipped | Rule 6 planning claim | T510 |
| 6. Duplicate capability creation | §4 parity (same provisioning path); within one planner root, idempotent today | T468/T469 (cross-harness), T504 |
| Same-task races (MCP, HTTP) | §3 typed winner/refusal, one persisted owner | T496 (typed conflict), T502 (transactional authority) |
| Failed/incomplete replies | §3 shaped failures, never a crash | T496 |
| Workspace inference from cwd | §1 resolution rule 5, explicit identity | T489/T490 |
| Missing HOME / descriptor missing or incompatible | §1 resolution rules 2–5, typed errors, no silent substitutes | T489, P130/T495 recovery path |
| Per-project server isolation | §1 project scoping under one service | T489/T490 |

## 9. Acceptance evidence and unverified boundaries

Acceptance checks for this contract:

1. **Same shapes everywhere.** Core/MCP/Pi/server/UI consume the same functions and shapes: today the selector, bounded builders and ref resolution already live once in `@agent-plan/core` and are called by `plan-mcp` and `pi-adapter`; `plan-server` renders through the same core builders. Verified by source inspection at `d574dd6`, not by a cross-surface runtime test.
2. **Dependency readiness distinct from ordering.** Two separate mechanisms in `task-selection.ts` (mandatory in `checkExplicitTaskStart`, advisory claims in `recommendNextWork`), with no shared gating of explicit starts on priority.
3. **No global exclusive phase lock; warning-only guard intact.** Phase continuity relies on per-task ownership, deviation stacks and (target) the execution lease; the no-task guard remains warn-only per Accepted Decision `7995854e`.

Unverified boundaries (explicit, not assumed away):

- No live multi-agent session evidence: ownership conflicts, heartbeat leases and takeover flows are contract targets with partial implementation (only `activeOwnerSession` and pause snapshots exist).
- The SQLite service, descriptor binding and execution records do not exist yet; §1/§5 target columns are forward-looking owner assignments, verified only at T489/T502/T490/T491 closeout.
- Model-side comprehension and token costs stay unobservable at core/MCP/server layers (T461 measurement boundary); this contract governs delivery, not understanding.
