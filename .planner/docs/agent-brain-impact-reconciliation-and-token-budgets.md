# Agent Brain — impact reconciliation and bounded context cost

Registered implementation owner: **P128(F025)/T496**, alias M3, UUID e1111601-64ad-49d5-9805-df48e9dd4b70. It follows T489 and precedes T490, T470 and T481. BR28/BR29 are linked to all 15 phases and AD19 is owned once by F025. All 334 checklist items across the 36-task feature remain unchecked.

User-approved addition, 21 October 2026. This applies to every F025 workflow, not just shared storage. It is planned behavior, not a claim that existing adapters enforce it today. Canonical planner entities remain authoritative.

## Required behavior

Every mutation assesses the affected task -> phase -> feature -> project hierarchy and real dependency relationships. Update required facts through their owner and preserve unaffected prose, approved decisions and unrelated data. A new task checks the consistency of parent scope. A move checks both old and new parents. An edge change checks incoming/outgoing readiness and context; it cannot invent other edges or silently cascade task status. Current source availability and work-order dependencies remain different inputs.

Structural invariants and derived rollups are computed by the shared domain transaction. Semantic prose needs a factual patch or an explicit reviewed-unchanged assessment bound to the exact source/parent versions. Merely touching a description timestamp is not review. Concurrent edits invalidate stale assessments. A leaf write may persist while a semantic obligation remains, but its response must report reconciliation_required and retain a durable resumable obligation; do not claim the operation or parent closeout is reconciled while required work is hidden. Normal reads stay non-mutating.

The current description-freshness module and shared skill already cover child-to-phase/feature freshness guidance; they are the starting point. They do not establish project-level or dependency-impact semantic review. Extend them and canonical planner rules, not AGENTS.md or an alternative planning system. M3 owns core impact/postconditions; G3 owns source/context freshness using those primitives; B1 owns selection, C2 delivery/reuse and D2 portable skill distribution. Preserve warning-only no-task behavior and truthful adapter coverage.

## Concrete flow and compact response

1. The client submits a granular change with expected revision and an idempotency key.
2. The domain compares changed fields and uses maintained parent/reverse-dependency/link indexes to identify affected entities; it does not ask the agent to reread the whole project.
3. Structural relations and derived facts are validated/recomputed. Missing targets, wrong parents and cycles return typed diagnostics.
4. The mutation returns changed IDs/revisions, relevant before/after facts, affected parent/dependency refs and a result per obligation: updated, reviewed_unchanged, or reconciliation_required. These are conceptual result states, not already shipped tool fields.
5. Necessary semantic updates are proposed/applied through the actual canonical owners with version checks; unchanged meaning receives a version-bound assessment. Pending work survives disconnect/restart and appears at the next relevant lifecycle point.
6. The aggregate mutation/closeout is reported reconciled only after required obligations are resolved or a named explicit blocker remains. Do not call a successful leaf save full success for the entire hierarchy.

For example, creating a new parser task changes its phase task coverage; the phase's summary changes only if the outcome/scope changed. Its feature or project text changes only if that broader meaning became obsolete. Dependency readiness is recomputed for actual affected consumers. The agent receives the new task facts and the small affected set, not every full feature/phase/task description.

## Token and runtime cost contract

Use compact deltas by default and full content only for explicit drill-down or missing effective context. Reuse unchanged context only if it is still available to the model; persistent hashes/read timestamps alone do not prove this after compaction or a harness switch. Required rules, requirements and decisions cannot be silently removed to meet a budget. Large mandatory context or high-fan-out impact uses explicit bounded continuation and visible incomplete/pending state.

Keep indexes and context caches derived, versioned and invalidated on relevant changes. Unrelated plan growth must not increase the agent payload for one local change. Coalesce relevant events and avoid unconditional full graph rebuild, whole-plan model reload, repeated identical read calls or full ancestor prose rewriting. True high fan-out may require proportional backend work, but client payload and continuation remain bounded; do not pretend all impact is constant-time.

A2 establishes comparable per-flow budgets and baseline fixtures before implementation makes performance claims. C2 implements effective-context reuse; I1 checks all flows and I2 verifies installed behavior. Measure response bytes/chars and tool calls, and model-token counts only with a declared tokenizer/method; label proxies honestly. No arbitrary percentage saving or untested numeric ceiling is approved in this registration.

Cover local update, no-op/cached operation, new task, move/reparent, edge add/remove, priority/source-target change, concurrent stale review, interrupted reconciliation, compaction/harness switch, graph retrieval, editor selection/save and broad dependency fan-out. Compare the same local change while unrelated plan size grows. Record separate backend work/payload/model-context costs so a small reply does not conceal an expensive full-plan scan.

## No duplicate work or automatic policy changes

One new task M3 owns the cross-cutting implementation. Existing A2/B1/C2/D2/D3/G3/I1/I2/M2/N3 are extended with concrete acceptance steps. Do not create a task per touched parent, stale edge, benchmark sample or checklist item. Approved decisions are never silently rewritten by a summary generator; unresolved meaning remains a visible obligation. This adds no new general source-write denial policy, mandatory cloud service, release action or real-project migration.

## Implementation task

Outcome: Every planner mutation keeps affected hierarchy and dependency context consistent through one explicit postcondition protocol, with measured bounded agent-context cost.

Existing state: packages/plan-core/src/description-freshness.ts:94 computes timestamp-based phase/feature prose freshness; it does not cover project prose, dependency-impact semantics or an enforced mutation/reconciliation lifecycle. packages/plan-core/planner-skill.md:131 already tells agents to reconcile parents, but the user reports it is not reliably followed. PlanStore.runBatch at packages/plan-core/src/plan-store.ts:1077 and write coordination are existing extension points; do not recreate a parallel planner.

Implementation responsibility:
- Extend the existing description-freshness, transaction and rule/skill contracts; classify each create/update/move/status/priority/dependency/requirement/decision change by actual semantic impact, not generic updatedAt.
- Compute a bounded affected set from maintained parent/reverse-dependency/link indexes: owning phase/feature/project, old and new parents on moves, incoming/outgoing dependencies and affected readiness/context projections. Do not scan or reload unrelated project content on every write.
- Recompute structural relations and derived rollups within the coordinated mutation; reject dangling references, parent mismatches and dependency cycles with typed diagnostics, without inventing dependencies or cascading task-status changes.
- Assess parent prose and linked/dependent descriptions against changed facts. Apply a minimal factual update through the canonical owner only where necessary; preserve decisions, rationale, user prose and unrelated content. Otherwise record a version-bound no-change-needed assessment, not a cosmetic rewrite.
- Return a compact change-impact receipt containing changed IDs/revisions, relevant before/after facts, affected parents/dependencies and reconciliation outcomes. If semantic review needs an agent/user, persist a durable bounded obligation and return reconciliation_required; do not claim the full operation is reconciled merely because the leaf write persisted.
- Provide expected-revision/idempotent reconcile operations and paginated impact continuation. Concurrent changes invalidate stale assessments, interrupted clients resume obligations, and phase/feature closeout verifies required reconciliation or an explicit recorded unresolved blocker.
- Expose the same domain postconditions through supported MCP/Pi/CLI/server/UI surfaces and D2 portable skills; normal reads are non-mutating, no-task behavior remains warning-only, and a missing agent hook cannot be advertised as enforced interception.
- Measure A2-defined per-flow payload/token and tool-call budgets using fixed fixtures. Reuse already delivered unchanged mandatory context, return affected deltas by default and request full content only on cache/context loss or explicit drill-down; large impact uses bounded continuation without hiding required context.

Acceptance and evidence:
- Creating/updating/moving a task or changing an edge leaves all affected structural parents/dependencies consistent, with a factual prose update or explicit revision-bound reviewed-unchanged/pending result.
- Task -> phase -> feature -> project scope changes reconcile only affected meaning; a new task cannot silently leave contradictory parent descriptions. Edge removal, cross-phase links, deletion/move and concurrent edits are covered.
- A local mutation has bounded incremental response/tool overhead independent of unrelated plan growth; high-fan-out changes paginate explicitly and cached no-op operations do not reload full ancestors/graph.
- Required rules/requirements/decisions remain available after compaction or workspace change; token economy never relies on a stored timestamp as proof of effective model context or silently drops mandatory content.

Detailed contract: structural updates and semantic review are distinct. A write may be persisted while reconciliation remains required; the response must say so and preserve the obligation. Do not blindly rewrite every ancestor, auto-change Accepted Decisions, infer new work dependencies from graph/code links or block unrelated tasks for a local edit. Assess old/new parents and both directions of actual dependency effects. A reviewed-unchanged receipt must name the source/parent revisions and cannot be satisfied by merely touching a timestamp. The no-task guard remains warning-only; this is a planner consistency postcondition, not a newly authorized source-write denial policy.

Ownership: this task owns mutation-impact and reconciliation contracts. G3 reuses them for source/context freshness; B1 consumes updated readiness; C2 owns context delivery/reuse; D2 owns portable skill distribution; I1/I2 own complete and fresh-installed closeout. Exact field/tool names and numeric per-flow budgets are selected from measured A2 baselines, not fabricated promises. All F025 improvements, including shared planner, graph and editor, must meet the common bounded-cost contract.

Read before editing: packages/plan-core/src/description-freshness.ts:94; packages/plan-core/src/plan-store.ts:1036; packages/plan-core/src/write-coordination.ts:95; packages/plan-core/src/planner-rules.ts:20; packages/plan-core/planner-skill.md:131; packages/plan-core/src/api-v1.ts:343. These are dated navigation entry points inspected on 21 October 2026, never durable code identities; revalidate current sources and hashes in the handoff.

Dependencies: P128(F025)/T489. Requirement aliases: BR28, BR29, BR02, BR04, BR06, BR14, BR16. Full approved contract: .planner/docs/agent-brain-impact-reconciliation-and-token-budgets.md. Preserve canonical IDs, derived statuses, phase handoffs, single-owner decisions, source/runtime isolation, global priority and existing project Guidelines. Use this checklist rather than new tasks per implementation step. Planning only; no product implementation or Git action is authorized here.

- [ ] Inspect existing freshness/transaction/rule precedents and record applicable Guidelines.
- [ ] Extend the existing description-freshness, transaction and rule/skill contracts; classify each create/update/move/status/priority/dependency/requirement/decision change by actual semantic impact, not generic updatedAt.
- [ ] Compute a bounded affected set from maintained parent/reverse-dependency/link indexes: owning phase/feature/project, old and new parents on moves, incoming/outgoing dependencies and affected readiness/context projections. Do not scan or reload unrelated project content on every write.
- [ ] Recompute structural relations and derived rollups within the coordinated mutation; reject dangling references, parent mismatches and dependency cycles with typed diagnostics, without inventing dependencies or cascading task-status changes.
- [ ] Assess parent prose and linked/dependent descriptions against changed facts. Apply a minimal factual update through the canonical owner only where necessary; preserve decisions, rationale, user prose and unrelated content. Otherwise record a version-bound no-change-needed assessment, not a cosmetic rewrite.
- [ ] Return a compact change-impact receipt containing changed IDs/revisions, relevant before/after facts, affected parents/dependencies and reconciliation outcomes. If semantic review needs an agent/user, persist a durable bounded obligation and return reconciliation_required; do not claim the full operation is reconciled merely because the leaf write persisted.
- [ ] Provide expected-revision/idempotent reconcile operations and paginated impact continuation. Concurrent changes invalidate stale assessments, interrupted clients resume obligations, and phase/feature closeout verifies required reconciliation or an explicit recorded unresolved blocker.
- [ ] Expose the same domain postconditions through supported MCP/Pi/CLI/server/UI surfaces and D2 portable skills; normal reads are non-mutating, no-task behavior remains warning-only, and a missing agent hook cannot be advertised as enforced interception.
- [ ] Measure A2-defined per-flow payload/token and tool-call budgets using fixed fixtures. Reuse already delivered unchanged mandatory context, return affected deltas by default and request full content only on cache/context loss or explicit drill-down; large impact uses bounded continuation without hiding required context.
- [ ] Verify on isolated fixtures: Creating/updating/moving a task or changing an edge leaves all affected structural parents/dependencies consistent, with a factual prose update or explicit revision-bound reviewed-unchanged/pending result.
- [ ] Verify on isolated fixtures: Task -> phase -> feature -> project scope changes reconcile only affected meaning; a new task cannot silently leave contradictory parent descriptions. Edge removal, cross-phase links, deletion/move and concurrent edits are covered.
- [ ] Verify on isolated fixtures: A local mutation has bounded incremental response/tool overhead independent of unrelated plan growth; high-fan-out changes paginate explicitly and cached no-op operations do not reload full ancestors/graph.
- [ ] Verify on isolated fixtures: Required rules/requirements/decisions remain available after compaction or workspace change; token economy never relies on a stored timestamp as proof of effective model context or silently drops mandatory content.

## Outcomes and decision

BR28 — Consistent affected hierarchy and dependency context after every change

Agents and supervisors can trust that creating, updating or moving planner work and changing relationships checks affected task/phase/feature/project context and dependency readiness. Necessary factual updates are reconciled through their canonical owners; reviewed-unchanged and pending semantic review are explicit and revision-bound, preserving approved history and unrelated content.

BR29 — Bounded context cost across all Agent Brain workflows

Routine mutation, resume, context, graph and editor workflows deliver only relevant incremental information with bounded payload/tool overhead and explicit continuation for large impact. Correctness and mandatory rules/requirements/decisions survive compaction or source/workspace changes; measured budgets and real context availability govern reuse rather than unverified token-saving claims.

AD19 — Every mutation reconciles affected context through bounded deltas

Task/phase/feature/project mutations and relationship changes must assess and reconcile affected ancestors and dependencies. Update only genuinely changed facts; record version-bound reviewed-unchanged or durable pending obligations. Apply a measured incremental-context budget to every F025 workflow.

The user requires parent/dependency consistency without excessive token consumption. Existing instructions and timestamps alone do not ensure semantic consistency or efficient context.

M3 owns the shared impact/postcondition protocol; C2/D2/G3/B1 consume it and I1/I2 verify it. Use maintained impact indexes, expected revisions, compact receipts, effective-context-aware reuse and paginated continuation. Do not blindly rewrite ancestors, auto-revise decisions, invent edges or drop mandatory context. No new source-write denial policy or arbitrary fixed token-saving percentage is approved.

## Inspected source fingerprints

File:line positions below are dated navigation only; revalidate current source.

- packages/plan-core/src/description-freshness.ts:94 — buildHierarchicalDescriptionFreshness; SHA-256 30f9cbd69e161380cb861c846e676a038ffd462f07e46db05f2567e2a7a477f4
- packages/plan-core/src/plan-store.ts:1036 — batchInProgress / runBatch; SHA-256 ff7fd84a652c248fa0f883000be02e0d841a9485bcf7a73f2e9c974ce8f6a13c
- packages/plan-core/planner-skill.md:131 — Hierarchical description freshness; SHA-256 7ab07d0b0cc661e64f8cb5d930b79b607ccf371b5bc12ee17a4d0f8d4215139f
- packages/plan-core/src/planner-rules.ts:20 — canonical planner rules; SHA-256 14f082f0dba87c1b657ecbc6084fcddab2430ee6acd09c6e803fe928cd64dcae
