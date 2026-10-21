# Agent Brain — shared planner, executions and target integration

## Current registered scope — 21 October 2026

F025 now contains **15 phases / 36 planned tasks / 29 outcome requirements / 19 single-owner decisions** (18 feature and one project), **49 acyclic task dependency edges** and **334 unchecked checklist items**. This is planning registration only; no product implementation, real migration, commit, PR or release has started. Earlier registration/editor/amendment counts and verification reports below are historical snapshots.

The complete new contracts and source evidence are in `.planner/docs/agent-brain-shared-planner-and-execution.md` and `.planner/docs/agent-brain-impact-reconciliation-and-token-budgets.md`. Canonical refs/UUIDs are mapped in `.planner/docs/agent-brain-registration.json`; the new mutation/read-back record is `.planner/docs/agent-brain-shared-planner-registration.json`. Supporting JSON/documents are not another operational planner and must not be re-imported to create duplicates.

| Phase | Tasks | Responsibility |
| --- | --- | --- |
| P128(F025) | T489, T496, T490 | Separate plan/source/runtime identity; enforce affected-context reconciliation; coordinate one shared authority. |
| P129(F025) | T491–T493 | Attributable executions, separate target integrations and current workspace/target availability in API/UI. |
| P130(F025) | T494–T495 | Lossless old-copy reconciliation/activation, durable history and independent backup/export/restore. |

The dependency order is A baseline -> T489 -> T496 -> T490 -> execution/integration/availability and migration/recovery -> B reliability -> existing code/provider/graph/editor work -> I cross-surface/installed closeout. T496 also explicitly precedes T470 and T481. J's project-title fix remains independent. B1 owns selection, E2 changesets, H graph, K analysis/runtime and L Monaco; new work reuses their contracts.

A finished task in feat/due is not delivered by merging feat/one. Keep global work progress, source availability and historical integration separate, with configurable targets and exact-revision evidence. Do not infer code paths from planRoot. git-common-dir covers one clone's worktrees; custom files require independent backup and explicit transfer/rebinding to another clone.

Every mutation checks affected parents through project and real dependency consumers. Reconcile actual changed facts or record a version-bound reviewed-unchanged/pending obligation; do not rewrite all prose or merely touch timestamps. Use maintained impact indexes and compact deltas, effective-context-aware reuse and bounded continuation. All F025 workflows must meet measured payload/token/tool budgets without omitting mandatory rules, requirements or decisions. The existing warning-only no-task policy and release governance remain unchanged.

Project description has been reconciled to include the approved evolution; the existing plugin goal, Guidelines, technology settings and Accepted Decisions are preserved. All implementation statuses remain planned. Full task descriptions/checklists are in the canonical planner; read only the needed detail, rather than injecting these whole supporting handoffs into every operation.


Approved expansion of F025, 21 October 2026. This is a planning handoff. Canonical feature/phase/task/Requirement/Accepted Decision records remain the operational authority; this document and the import model are supporting material. No product implementation, real data migration, Git tracking change, dependency install, commit, push, PR or release is performed by this registration.

## Problem and the counterexample that must remain covered

dev-a works in feat/one and dev-b in feat/due. Both use the same project planner. dev-a merges its code into a configured target while dev-b has verified its own task but has not integrated its code. The global planner correctly knows about both executions. The target view must contain only the demonstrated result of dev-a and show dev-b as verified in feat/due / awaiting integration. A code-dependent successor cannot be told to use dev-b's function in a checkout where it is absent. This is the reason a single global done flag and one shared tracked .planner directory are insufficient.

main is an example target, not a hardcoded default. Agent Plan's current daily integration targets are user-selected develop/next, and main remains release-only through the existing authorized PR workflow. Nothing here changes release governance or permits automatic Git operations.

## What exists today and what this changes

At the inspected checkout, MCP, Pi and CLI resolve .planner from their working directory (MCP also supports AGENT_PLAN_ROOT). PlanStore already discovers git-common-dir for the allocation registry; that does not centralize canonical plans, runtime or task ownership. PlanStore.localRoot combines locks, sessions, resumes, focus/read state and related artifacts under the plan root. GET /project derives projectRoot from dirname(store.root). Existing runtime-boundaries.md describes versioned mergeable .planner state and per-worktree .local runtime. Those are the implemented baseline, not proof of the new architecture.

The planned design intentionally evolves that storage policy through explicit contracts and migration tasks. Keep JSON/open formats and harness-agnostic domain logic. Do not edit AGENTS.md incidentally; required runtime/setup/API documentation is owned by implementation closeout.

## Storage and identity contract

Resolve three independent roots and identities: planRoot for canonical project knowledge; workspaceRoot for the actual source checkout; runtimeRoot for scoped operational data. All supported clients resolve the same project binding. The intended local default is <git-common-dir>/agent-plan/<projectId>/ with canonical plan, shared coordination, workspace runtime and history areas. Exact subdirectory names and transport are choices in M1/M2, not already shipped API names.

Canonical requirements, decisions, task definitions, phase handoffs and execution/integration records are project-wide. Claims and coordinator ownership also need shared arbitration. Focus, return obligations, read/context receipts, source indexes, analysis caches and draft overlays require their actual caller/workspace/revision namespace; copying everything into a common .local is unsafe. A global project return overview can summarize obligations without making a foreign caller's obligation actionable.

Use stable project, repository-instance, workspace and execution identities. Worktree path and branch name are mutable locators. A moved worktree may update its path; a deleted one becomes unavailable but retains its history. Distinguish nested repositories/submodules and foreign overrides explicitly. A supervisor changing the viewed target does not relocate an agent's active execution or redirect its file writes.

git-common-dir covers worktrees of one local clone. Custom files there are neither cloned nor pushed by normal Git operations. Standalone/non-Git folders need an explicit shared root and remain usable before any stack is chosen. Independent clones/machines require deliberate backup/import/rebinding or a separately designed shared-service/synchronization boundary. Do not silently promise distributed consistency or mandatory cloud infrastructure.

## One authority and many clients

M2 owns compatible authority discovery, atomic startup ownership, operation-scoped mutation coordination and reconnect/failure behavior for MCP, Pi, CLI, server and Web UI. Reuse existing atomic claims, typed conflicts, live-owner recovery checks and transaction conventions. Add expected revisions and idempotency/provenance so retry or stale clients cannot duplicate/overwrite accepted knowledge. Code work can run in parallel; shared metadata mutations serialize only where necessary.

An advisory PID record alone cannot prove exclusive ownership. A stale lock must have bounded diagnosis/recovery and must not authorize killing another embedded host. If a bound authority is unavailable or incompatible, return an explicit diagnostic and recovery path; do not create a fresh cwd/.planner behind the user's back. Reads do not prove model context survived compaction.

M2's coordination/service identity is reused by K2; K2 remains owner of provider lifecycle, capabilities, cancellation and document overlays. A central planner does not require a second LSP and does not merge separate worktree analysis runtimes. Compatible consumers of the same workspace/provider/version/effective configuration share one analysis owner; distinct workspaces/configurations remain isolated. Dashboard activation remains explicit.

## Execution and integration model

An Execution describes one attempt at one logical task: stable execution/task identity, agent/session, repository/workspace identity, current path/branch locators, starting revision, resulting commit(s) or recoverable dirty snapshot, state and exact-source verification. A task can have many attempts and span commits. Actual fields/names and legacy mapping are defined in N1; examples such as running, paused, verified, failed and abandoned are distinct from integration state.

The existing E2 task keeps ownership of automatic large-task baseline/checkpoint/closeout changesets and uncertain attribution. N1 supplies its durable attempt identity and evidence owner, avoiding a second competing change ledger. Do not attribute all dirty files to the current agent. Preserve foreign/pre-existing edits and explicitly record unobserved attribution. Phase handoffs remain phase-scoped and link the exact execution/workspace/checkpoint.

Resume the same execution only after workspace/lineage validation; a different attempt receives a new identity. Evidence identifies command/suite, outcome, environment, source/configuration fingerprints and limitations. Verification at source A remains historical after source B changes; it cannot certify B. Uncommitted results require a recoverable snapshot if later historical inspection is promised. Never fabricate missing provenance for old records or force planning/research/non-code work into code commits and PRs.

An Integration relates a produced execution/result to a configured target with optional PR identity and observed source/target/result revisions. An execution can reach several targets at different times. Keep historical observations and current availability assessments separate. PR merged is a historical fact; after revert or replacement, current source may no longer contain the result. Unknown/review-required is honest when bounded evidence cannot establish semantic equivalence.

Ordinary ancestry is useful but insufficient for squash/rebase/cherry-pick. Use actual provider-neutral Git/hosting observations or explicit user attestation with provenance, and expose uncertainty. No general semantic-equivalence oracle is assumed. Record later target movement, force-push, changed results and invalidated verification without rewriting old facts. Independent records never trigger automatic commits, merges or pushes.

## Scheduling, context, graph and UI behavior

Work-order dependencies and code-artifact requirements are distinct. A planning predecessor can be complete without any merge; a code consumer must establish that required code exists in the selected checkout or target. The selected branch may already contain the result even when it has not reached another target. B1 keeps ownership of ready-work selection and explanation; N3 supplies availability evidence. Preserve active owned work, actionable caller-scoped returns, then global feature -> phase -> task priority inside the ready set.

N3 adds global operational and explicit workspace/target views, execution/integration history and distinct work-versus-delivery projections in existing API/UI surfaces. Parent logical statuses remain derived and require a documented compatibility mapping; no silent replacement of old done with shipped-to-every-target. The target view cannot count all globally verified work as delivered. Titles keep the project-first rule registered in J1.

Use the same resolved workspace/revision in context retrieval, code anchors, graph projection, source APIs, Monaco tabs/diff/saves and preferred-editor navigation. H retains graph/inspector ownership; K/L retain source, provider and Monaco ownership. Changing view/context invalidates affected cached evidence and cannot silently write another worktree or query a historical file through a live provider from the wrong revision. Show absent/unknown/partial source and preserve durable intent even if code is unavailable in the selected view.

## Migration, persistence and recovery

O1 inventories every old planner copy before activation and makes immutable backups with branch/worktree/revision provenance. Reconcile at stable entity/field identity using common bases where available. Compatible additions may combine; incompatible concurrent decisions, statuses, handoffs or dependency edits must be shown with all content retained. Newest mtime, whole-file ours/theirs and guessed timelines are not conflict resolution policies. Old done flags cannot manufacture execution/integration proof.

Migration is dry-run first, validated, interruption-safe and recoverable. Activate one binding atomically, preserve rollback and reject incompatible clients. Old copies become explicit migration snapshots/read-only sources, not fallback authorities. Shared coordination cannot import stale PIDs/locks as live ownership. Changing tracked .planner policy, descriptors or gitignore requires the appropriate explicit implementation-time authorization; this planning update performs none of it. Test on mkdtemp fixtures, never another real project.

O2 provides inspectable operation history/provenance, crash-safe checkpoints, independent backups and versioned complete export/import/restore. JSON may remain the durable format; no mandatory DB or wholesale event-sourcing framework is chosen. Include canonical entities and required recoverable source-snapshot blobs; exclude transient locks/PIDs, credentials and stale read attestations from portable restoration. Verify checksums/completeness and identity/rebinding policy. Restore cannot silently overwrite a different live project.

Deleting a worktree preserves canonical history. Deleting the whole clone/common Git directory can still lose local planner data, so independent backup location, status, retention and recovery are product requirements. A deliberate portable export accompanies a code PR only as an explicit artifact; it is never proof all globally planned code is included. Normal planner writes persist without requiring an agent to commit code.

## Priority, dependencies and bounded scope

Keep original A baseline first. M establishes identities/authority; N establishes execution/integration/availability; O establishes migration and recovery. B1 then consumes N3 and O2, and the existing reliability -> code links -> dynamic providers -> graph -> supervisor/editor work continues. J title fixes remain independent; phase ties use existing numeric ordering. K2 explicitly reuses M2. I1 waits for N3/O2 in addition to all existing graph/editor prerequisites; I2 remains installed-artifact and operating-guide closeout. No alternate planner, implementation start or task-per-step proliferation is introduced.

The new task dependency edges, exact assigned refs and counts are recorded in the canonical registration map. Requirements are declarative outcomes, Accepted Decisions have one feature owner, and implementation steps belong in task checklists. Original decisions (including global priority, portable skills, dynamic language capabilities, Monaco, long references and the AgentTest boundary) remain applicable. AgentTest is still an optional future producer of revision-bound test evidence, not a second testing product added here.

## Required scenario matrix

| Case | Required observable result |
| --- | --- |
| Two worktrees / multiple hosts | One authority and atomic claims; correct independent source roots, focus, returns and caches. |
| dev-a merged / dev-b verified | Global view retains both; target availability includes only the demonstrated integrated code. |
| Task resumed or retried | Correct same-attempt lineage or new execution; phase handoff and evidence stay attributable. |
| Dirty or foreign edits | Recoverable snapshots and honest uncertain attribution; no invented commits/PRs/tests. |
| Squash/rebase/cherry-pick | Do not mistake changed SHA identity for proven absence; expose bounded evidence and uncertainty. |
| Revert/target replacement | Historical integration remains; current availability and verification invalidate appropriately. |
| Non-code predecessor | No fabricated merge requirement; global priority and real artifact readiness remain separate. |
| Worktree moved/deleted | Stable history survives, locator updates or explicit unavailable/recovery outcome. |
| Divergent old planners | All approved knowledge retained; exact incompatible edits block activation until resolved. |
| Crash / unavailable authority | Consistent recoverable state or explicit error; never a silent empty parallel planner. |
| Standalone/empty project | Explicit binding without language guessing; later stack/provider setup remains dynamic. |
| Backup to new clone | Complete deliberate restore/rebinding with source evidence and no live foreign ownership. |

The existing T002/T010/T020 intent-history case, six workflow failures, language fallbacks, references beyond x999/x9999, project-title fixes and Monaco/provider/editor scenarios remain required. I1 validates full cross-surface behavior; I2 validates fresh packed artifacts. During implementation use only focused affected checks, with the canonical bounded final gate at phase/release closeout as required by AGENTS. No product test is claimed by this planning registration.

## M — Shared planner authority and workspace isolation

Give every local worktree one planner authority and an explicit independent code/runtime binding.

Current state: MCP, Pi and CLI default to cwd/.planner. PlanStore already discovers git-common-dir for allocation only; serve.ts derives code root with dirname(store.root). PlanStore.localRoot also houses focus, resumes and session data.

Goals:
- Separate canonical plan identity from workspace/source and caller runtime identity.
- Reuse one coordinated local authority across all supported harnesses.

Responsibilities:
- M1: Separate planner storage, code workspace and runtime identities. One harness-agnostic resolved binding identifies the canonical plan independently of the selected code checkout and caller runtime.
- M2: Route all clients through one coordinated local planner authority. Supported MCP, Pi, CLI, server and Web UI consumers use the same local planner authority while keeping code and caller state correctly scoped.

Boundaries:
- No product migration or automatic Git action during planning registration.
- No mandatory cloud service, database or language-specific setup.

Risks:
- Blindly centralizing .local would mix focus, returns and source caches.
- A branch/path locator can change and must not become durable identity.

Acceptance:
- Two local worktrees resolve one project planner and distinct code/runtime contexts; standalone initialization remains usable.
- Moving a worktree or renaming a branch preserves stable identity and history; missing/deleted paths give explicit unavailability.
- Nested repositories/submodules and foreign overrides cannot silently mix source provenance; no language/provider installation is required for planning.
- Concurrent supported host processes observe the same task/decision changes and cannot both successfully claim one task.
- Separate worktrees retain independent focus, resumes and source caches; crash/restart does not transfer a live foreign claim or discard pending returns.
- Stale revisions, repeated requests, incompatible clients and unavailable authority return explicit non-success without duplicate writes or parallel planners.

Read before editing:
- packages/plan-core/src/plan-store.ts:488 — gitCommonDirFor / shared allocation registry
- packages/plan-core/src/plan-store.ts:1413 — localRoot / session and resume paths
- packages/plan-mcp/src/index.ts:118 — planRoot / AGENT_PLAN_ROOT
- packages/pi-adapter/src/index.ts:275 — planRootForCwd / resolvePlanRoot / ensureStore
- packages/agent-plan/src/index.ts:124 — plannerRoot
- packages/plan-server/src/serve.ts:258 — GET /project derives projectRoot from dirname(store.root)
- packages/plan-core/src/write-coordination.ts:95 — writer lock path and transaction coordination

Dependencies: A. Requirements: BR22, BR23, BR03, BR04, BR10, BR16, BR20. Full approved handoff: .planner/docs/agent-brain-shared-planner-and-execution.md.

Preserve canonical UUIDs/shortIds and variable-width references, single-owner Accepted Decisions, phase-scoped handoffs, derived parent status, atomic task/session ownership, explicit recovery, global feature -> phase -> task priority and the accepted warning-only no-task guard. Read current sources, existing precedents and applicable Project Guidelines before coding. Use checklist steps rather than creating tasks per step. No automatic commit, push, merge, release or dashboard activation is authorized. This is planned work; no central store or execution/integration model has been implemented by this registration.

Source positions above are dated navigation evidence from 21 October 2026, not permanent anchors; revalidate against the current checkout.

### M1 — Separate planner storage, code workspace and runtime identities

Outcome: One harness-agnostic resolved binding identifies the canonical plan independently of the selected code checkout and caller runtime.

Existing state: MCP, Pi and CLI default to cwd/.planner. PlanStore already discovers git-common-dir for allocation only; serve.ts derives code root with dirname(store.root). PlanStore.localRoot also houses focus, resumes and session data.

Implementation responsibility:
- Define projectId, repository-instance identity, stable workspaceId, current path and source revision/dirty identity; paths and branch names are mutable locators, not durable execution identities.
- Define explicit planRoot, workspaceRoot and runtimeRoot and a shared resolver. For local worktrees discover the same git-common-dir/projectId authority; support explicit standalone/non-Git roots and empty folders without guessing a language.
- Define a descriptor/binding format, precedence for explicit overrides, compatibility/version diagnostics and repository containment. Do not infer workspaceRoot from the planner directory or follow a binding to an unrelated repository silently.
- Inventory every PlanStore/root consumer and classify shared canonical knowledge, shared coordination, workspace-scoped caches and caller-scoped focus/read/return state; define move/delete/re-register and clone boundaries.

Acceptance and evidence:
- Two local worktrees resolve one project planner and distinct code/runtime contexts; standalone initialization remains usable.
- Moving a worktree or renaming a branch preserves stable identity and history; missing/deleted paths give explicit unavailability.
- Nested repositories/submodules and foreign overrides cannot silently mix source provenance; no language/provider installation is required for planning.

Read before editing:
- packages/plan-core/src/plan-store.ts:488 — gitCommonDirFor / shared allocation registry
- packages/plan-core/src/plan-store.ts:1413 — localRoot / session and resume paths
- packages/plan-mcp/src/index.ts:118 — planRoot / AGENT_PLAN_ROOT
- packages/pi-adapter/src/index.ts:275 — planRootForCwd / resolvePlanRoot / ensureStore
- packages/agent-plan/src/index.ts:124 — plannerRoot
- packages/plan-server/src/serve.ts:258 — GET /project derives projectRoot from dirname(store.root)
- packages/plan-core/docs/runtime-boundaries.md:1 — current versioned plan and worktree-local runtime policy

Detailed discussion contract:
- The intended local default is <git-common-dir>/agent-plan/<projectId>/ with canonical plan, coordination, workspace runtime and history areas. Exact filenames and transport are implementation choices; the independent identities and one authority are binding decisions.
- git-common-dir is shared by worktrees of one local clone. An independent clone or another machine does not inherit these custom files through git push/clone. An explicit service/synchronization boundary may support those later; do not promise it implicitly.
- The public descriptor must be safely inspectable without leaking unnecessary local paths into portable exports. Do not edit AGENTS.md as an incidental architecture task.

Execution dependencies: A2. Requirement aliases: BR22, BR23, BR10, BR16. Full approved handoff: .planner/docs/agent-brain-shared-planner-and-execution.md.

Source positions are dated navigation evidence inspected on 21 October 2026 at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231, never durable identity. Revalidate current sources; hashes are in the handoff.

Preserve canonical UUIDs/shortIds and variable-width references, single-owner Accepted Decisions, phase-scoped handoffs, derived parent status, atomic task/session ownership, explicit recovery, global feature -> phase -> task priority and the accepted warning-only no-task guard. Read current sources, existing precedents and applicable Project Guidelines before coding. Use checklist steps rather than creating tasks per step. No automatic commit, push, merge, release or dashboard activation is authorized. This is planned work; no central store or execution/integration model has been implemented by this registration.

Checklist:
- [ ] Inspect existing implementation and record applicable precedents and Guidelines.
- [ ] Define projectId, repository-instance identity, stable workspaceId, current path and source revision/dirty identity; paths and branch names are mutable locators, not durable execution identities.
- [ ] Define explicit planRoot, workspaceRoot and runtimeRoot and a shared resolver. For local worktrees discover the same git-common-dir/projectId authority; support explicit standalone/non-Git roots and empty folders without guessing a language.
- [ ] Define a descriptor/binding format, precedence for explicit overrides, compatibility/version diagnostics and repository containment. Do not infer workspaceRoot from the planner directory or follow a binding to an unrelated repository silently.
- [ ] Inventory every PlanStore/root consumer and classify shared canonical knowledge, shared coordination, workspace-scoped caches and caller-scoped focus/read/return state; define move/delete/re-register and clone boundaries.
- [ ] Verify on isolated mkdtemp fixtures: Two local worktrees resolve one project planner and distinct code/runtime contexts; standalone initialization remains usable.
- [ ] Verify on isolated mkdtemp fixtures: Moving a worktree or renaming a branch preserves stable identity and history; missing/deleted paths give explicit unavailability.
- [ ] Verify on isolated mkdtemp fixtures: Nested repositories/submodules and foreign overrides cannot silently mix source provenance; no language/provider installation is required for planning.

### M2 — Route all clients through one coordinated local planner authority

Outcome: Supported MCP, Pi, CLI, server and Web UI consumers use the same local planner authority while keeping code and caller state correctly scoped.

Existing state: Each host can construct its own PlanStore and per-root writer lock. Existing claims/recovery protect a task only when callers reach the same physical state; server-record discovery is advisory rather than atomic startup exclusion.

Implementation responsibility:
- Implement the resolved binding from M1 and the shared authority/service lifecycle, including atomic startup ownership, compatible discovery, reconnect and typed dead/incompatible/unavailable outcomes.
- Reuse existing transactions and atomic claims; serialize conflicting operations with expected entity revisions, idempotency keys and actor/execution provenance. Independent code work remains parallel; a slow/dead client cannot leave an indefinite write lock.
- Keep global task claims and coordinator ownership shared, but namespace focus, return chains, read/context evidence, source indexes and analysis caches by their explicit workspace/session/revision keys.
- Update all host entry points and source-root consumers, including GET /project; normal planner operations must not fall back to silently creating a fresh cwd/.planner when the bound authority is unavailable.
- Expose stable domain/service APIs and events for later source and provider brokers. K2 still owns language-server lifecycle and document overlays; sharing planner authority must not launch the dashboard or duplicate the provider broker.

Acceptance and evidence:
- Concurrent supported host processes observe the same task/decision changes and cannot both successfully claim one task.
- Separate worktrees retain independent focus, resumes and source caches; crash/restart does not transfer a live foreign claim or discard pending returns.
- Stale revisions, repeated requests, incompatible clients and unavailable authority return explicit non-success without duplicate writes or parallel planners.

Read before editing:
- packages/plan-core/src/write-coordination.ts:95 — writer lock path and transaction coordination
- packages/plan-core/src/plan-store.ts:3493 — registerSession / claimTask / recoverSessionForTask
- packages/plan-core/src/plan-store.ts:1413 — localRoot / session and resume paths
- packages/plan-server/src/server-record.ts:1 — advisory server discovery record
- packages/plan-mcp/src/index.ts:118 — planRoot / AGENT_PLAN_ROOT
- packages/pi-adapter/src/index.ts:275 — planRootForCwd / resolvePlanRoot / ensureStore
- packages/agent-plan/src/index.ts:124 — plannerRoot
- packages/plan-server/src/serve.ts:258 — GET /project derives projectRoot from dirname(store.root)

Detailed discussion contract:
- Use a single coordination boundary for planner mutations, with short operation-scoped locks and a recoverable owner. JSON may remain the durable format; this decision does not mandate a database, event-sourcing framework or cloud service.
- A public read must not claim that an arbitrary stored attestation proves the model retained context. Shared storage does not make caller context interchangeable.
- A .planner symlink or AGENT_PLAN_ROOT override alone cannot meet this task: source-root inference, runtime scoping, startup races, incompatible clients and failures must be handled.

Execution dependencies: M1. Requirement aliases: BR22, BR23, BR03, BR04, BR20. Full approved handoff: .planner/docs/agent-brain-shared-planner-and-execution.md.

Source positions are dated navigation evidence inspected on 21 October 2026 at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231, never durable identity. Revalidate current sources; hashes are in the handoff.

Preserve canonical UUIDs/shortIds and variable-width references, single-owner Accepted Decisions, phase-scoped handoffs, derived parent status, atomic task/session ownership, explicit recovery, global feature -> phase -> task priority and the accepted warning-only no-task guard. Read current sources, existing precedents and applicable Project Guidelines before coding. Use checklist steps rather than creating tasks per step. No automatic commit, push, merge, release or dashboard activation is authorized. This is planned work; no central store or execution/integration model has been implemented by this registration.

Checklist:
- [ ] Inspect existing implementation and record applicable precedents and Guidelines.
- [ ] Implement the resolved binding from M1 and the shared authority/service lifecycle, including atomic startup ownership, compatible discovery, reconnect and typed dead/incompatible/unavailable outcomes.
- [ ] Reuse existing transactions and atomic claims; serialize conflicting operations with expected entity revisions, idempotency keys and actor/execution provenance. Independent code work remains parallel; a slow/dead client cannot leave an indefinite write lock.
- [ ] Keep global task claims and coordinator ownership shared, but namespace focus, return chains, read/context evidence, source indexes and analysis caches by their explicit workspace/session/revision keys.
- [ ] Update all host entry points and source-root consumers, including GET /project; normal planner operations must not fall back to silently creating a fresh cwd/.planner when the bound authority is unavailable.
- [ ] Expose stable domain/service APIs and events for later source and provider brokers. K2 still owns language-server lifecycle and document overlays; sharing planner authority must not launch the dashboard or duplicate the provider broker.
- [ ] Verify on isolated mkdtemp fixtures: Concurrent supported host processes observe the same task/decision changes and cannot both successfully claim one task.
- [ ] Verify on isolated mkdtemp fixtures: Separate worktrees retain independent focus, resumes and source caches; crash/restart does not transfer a live foreign claim or discard pending returns.
- [ ] Verify on isolated mkdtemp fixtures: Stale revisions, repeated requests, incompatible clients and unavailable authority return explicit non-success without duplicate writes or parallel planners.

## N — Task executions and revision-aware target integration

Keep produced work, current source availability and delivery to each configured target independently traceable.

Current state: TaskSchema stores a single lifecycle, owner and pause history; E2 already owns automatic baseline/checkpoint/closeout changesets. There is no separate durable attempt model identifying where verified work was produced.

Goals:
- Persist one task with attributable attempts and revision-bound evidence.
- Expose separate integration history and current availability through agent context and UI.

Responsibilities:
- N1: Persist attributable task executions and revision-bound verification. One logical task can retain multiple identifiable executions without confusing work produced in different worktrees or losing handoff and test evidence.
- N2: Track target integrations and revalidate current code availability. Each produced result has independent per-target integration history and an evidence-based assessment of current artifact availability.
- N3: Expose work progress and target availability in planner context and UI. Agents and supervisors can distinguish what work was performed from what source and evidence are available in their selected workspace or target.

Boundaries:
- Do not infer semantic behavior from a merged flag or force all tasks through a PR.
- Do not replace B scheduling, E changesets, H graph or K/L editor/provider ownership.

Risks:
- A verified feature branch can be absent from the target.
- Revert/squash/rebase can invalidate simplistic SHA/merged checks.

Acceptance:
- Two attempts remain separately attributable and one task keeps one canonical identity; worktree deletion/branch rename cannot erase old evidence.
- An uncommitted verified result has a recoverable snapshot and is not reported as delivered to a target branch.
- Resume and phase handoff identify the correct execution; a test result for revision A cannot certify changed revision B.
- dev-a merges feat/one while dev-b has verified feat/due: the shared planner reports both executions, but the target contains only the demonstrated result of dev-a.
- Squash/rebase/cherry-pick cases are not falsely absent solely because original SHAs differ; uncertainty is exposed.
- A later revert invalidates current availability while preserving the historical merge; develop/next/main targets are configurable and release-only main governance is unchanged.
- Global and target views show dev-b verified in feat/due and awaiting integration without claiming its code is in the viewed target.
- A code-dependent task in another checkout is blocked or uncertain with an actionable reason, while a planning-only dependency is not blocked by a fictitious missing merge.
- Switching workspace/target or observing a revert updates evidence and delivery projections consistently across agent context and UI, without changing canonical task IDs or losing historical progress.

Read before editing:
- packages/plan-core/src/schema.ts:252 — TaskSchema / dependsOn / pauseSnapshot / activeOwnerSession
- packages/plan-core/src/plan-store.ts:3493 — registerSession / claimTask / recoverSessionForTask
- packages/plan-core/src/task-selection.ts:283 — recommendNextTask
- packages/plan-core/src/api-v1.ts:343 — buildApiV1Model
- packages/plan-web-ui/src/routes/task-detail/route.tsx:108 — task detail route
- packages/plan-core/src/handoff-context.ts:1 — phase-scoped handoff context

Dependencies: M. Requirements: BR24, BR25, BR02, BR03, BR04, BR08, BR12, BR14, BR15, BR17. Full approved handoff: .planner/docs/agent-brain-shared-planner-and-execution.md.

Preserve canonical UUIDs/shortIds and variable-width references, single-owner Accepted Decisions, phase-scoped handoffs, derived parent status, atomic task/session ownership, explicit recovery, global feature -> phase -> task priority and the accepted warning-only no-task guard. Read current sources, existing precedents and applicable Project Guidelines before coding. Use checklist steps rather than creating tasks per step. No automatic commit, push, merge, release or dashboard activation is authorized. This is planned work; no central store or execution/integration model has been implemented by this registration.

Source positions above are dated navigation evidence from 21 October 2026, not permanent anchors; revalidate against the current checkout.

### N1 — Persist attributable task executions and revision-bound verification

Outcome: One logical task can retain multiple identifiable executions without confusing work produced in different worktrees or losing handoff and test evidence.

Existing state: TaskSchema stores a single lifecycle, owner and pause history; E2 already owns automatic baseline/checkpoint/closeout changesets. There is no separate durable attempt model identifying where verified work was produced.

Implementation responsibility:
- Add an Execution model and granular store/API operations linking taskId, executionId, agent/session, stable workspace/repository identity, branch locator, starting revision and attributable resulting commits or recoverable dirty snapshots.
- Define explicit running/paused/verified/failed/abandoned semantics and transition/recovery rules. Resume the same attempt only after identity/lineage validation; a genuinely new attempt creates another execution instead of replacing history.
- Bind test/conformity evidence to the exact execution and source/configuration fingerprint, recording command/suite, result, environment and coverage limitations; later edits invalidate current verification without deleting historical evidence.
- Attach existing phase handoffs, caller ownership and E2 changeset checkpoints to the exact execution/workspace. Preserve foreign/pre-existing dirty changes and mark unobserved attribution rather than manufacturing it.
- Define compatibility projections for legacy tasks and first-class non-code/planning work. Retain unknown historical provenance; do not fabricate branch, commit, PR or test evidence to populate new fields.

Acceptance and evidence:
- Two attempts remain separately attributable and one task keeps one canonical identity; worktree deletion/branch rename cannot erase old evidence.
- An uncommitted verified result has a recoverable snapshot and is not reported as delivered to a target branch.
- Resume and phase handoff identify the correct execution; a test result for revision A cannot certify changed revision B.

Read before editing:
- packages/plan-core/src/schema.ts:252 — TaskSchema / dependsOn / pauseSnapshot / activeOwnerSession
- packages/plan-core/src/plan-store.ts:3493 — registerSession / claimTask / recoverSessionForTask
- packages/plan-core/src/handoff-context.ts:1 — phase-scoped handoff context
- packages/plan-core/src/session-focus.ts:1 — caller-scoped focus and returns
- packages/plan-core/docs/runtime-boundaries.md:1 — current versioned plan and worktree-local runtime policy

Detailed discussion contract:
- Execution is not integration. A finished verified attempt can coexist with no code in develop/next/main. No automatic Git action follows an execution transition.
- E2 remains responsible for deriving and attributing large-task changesets; this task supplies the execution identity, lifecycle and evidence owner that E2 reuses.
- Do not silently redefine the old task done flag to mean every possible target is delivered. Define and test the legacy mapping and uncertainty before changing public compatibility projections.

Execution dependencies: M2. Requirement aliases: BR24, BR23, BR08, BR17, BR03. Full approved handoff: .planner/docs/agent-brain-shared-planner-and-execution.md.

Source positions are dated navigation evidence inspected on 21 October 2026 at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231, never durable identity. Revalidate current sources; hashes are in the handoff.

Preserve canonical UUIDs/shortIds and variable-width references, single-owner Accepted Decisions, phase-scoped handoffs, derived parent status, atomic task/session ownership, explicit recovery, global feature -> phase -> task priority and the accepted warning-only no-task guard. Read current sources, existing precedents and applicable Project Guidelines before coding. Use checklist steps rather than creating tasks per step. No automatic commit, push, merge, release or dashboard activation is authorized. This is planned work; no central store or execution/integration model has been implemented by this registration.

Checklist:
- [ ] Inspect existing implementation and record applicable precedents and Guidelines.
- [ ] Add an Execution model and granular store/API operations linking taskId, executionId, agent/session, stable workspace/repository identity, branch locator, starting revision and attributable resulting commits or recoverable dirty snapshots.
- [ ] Define explicit running/paused/verified/failed/abandoned semantics and transition/recovery rules. Resume the same attempt only after identity/lineage validation; a genuinely new attempt creates another execution instead of replacing history.
- [ ] Bind test/conformity evidence to the exact execution and source/configuration fingerprint, recording command/suite, result, environment and coverage limitations; later edits invalidate current verification without deleting historical evidence.
- [ ] Attach existing phase handoffs, caller ownership and E2 changeset checkpoints to the exact execution/workspace. Preserve foreign/pre-existing dirty changes and mark unobserved attribution rather than manufacturing it.
- [ ] Define compatibility projections for legacy tasks and first-class non-code/planning work. Retain unknown historical provenance; do not fabricate branch, commit, PR or test evidence to populate new fields.
- [ ] Verify on isolated mkdtemp fixtures: Two attempts remain separately attributable and one task keeps one canonical identity; worktree deletion/branch rename cannot erase old evidence.
- [ ] Verify on isolated mkdtemp fixtures: An uncommitted verified result has a recoverable snapshot and is not reported as delivered to a target branch.
- [ ] Verify on isolated mkdtemp fixtures: Resume and phase handoff identify the correct execution; a test result for revision A cannot certify changed revision B.

### N2 — Track target integrations and revalidate current code availability

Outcome: Each produced result has independent per-target integration history and an evidence-based assessment of current artifact availability.

Existing state: Task completion and dependsOn contain no target-branch or source-result integration evidence. A worktree path, original SHA or historical merged PR alone cannot establish that a result is present in a current checkout.

Implementation responsibility:
- Add Integration records referencing an execution/result, configured repository target, optional PR identity, source revision(s), observed target/result revision and verification/provenance. Allow several targets and record immutable historical observations.
- Define target observations for pending review/integration, observed integration, current present/absent/unknown/review-required availability and invalidated verification. Keep historical merge facts separate from current capability claims.
- Support ordinary merges plus squash/rebase/cherry-pick using provider-neutral observations or explicit user attestation with provenance; original-commit ancestry is one signal, never the only proof. Uncertain equivalence remains unknown.
- Recheck on target movement, revert, replacement, force-push or execution changes; cache by repository/target/source fingerprints and preserve the old evidence trail when current confidence changes.
- Define artifact-presence requirements separately from work-order dependencies; a selected checkout can satisfy an artifact through its own source/ancestry even before integration into another target. Non-code tasks need no invented PR.

Acceptance and evidence:
- dev-a merges feat/one while dev-b has verified feat/due: the shared planner reports both executions, but the target contains only the demonstrated result of dev-a.
- Squash/rebase/cherry-pick cases are not falsely absent solely because original SHAs differ; uncertainty is exposed.
- A later revert invalidates current availability while preserving the historical merge; develop/next/main targets are configurable and release-only main governance is unchanged.

Read before editing:
- packages/plan-core/src/schema.ts:252 — TaskSchema / dependsOn / pauseSnapshot / activeOwnerSession
- packages/plan-core/src/plan-store.ts:488 — gitCommonDirFor / shared allocation registry
- packages/plan-core/src/api-v1.ts:343 — buildApiV1Model
- packages/plan-core/docs/runtime-boundaries.md:1 — current versioned plan and worktree-local runtime policy

Detailed discussion contract:
- Do not hardcode main as the integration target. This repository integrates daily work into the user-selected develop or next branch, with release PRs into main; this registration does not change that workflow.
- Historical integrated and currently available are independent facts. No graph edge, task status, merged PR flag or source hash alone proves that arbitrary semantic behavior survived a later edit.
- Use explicit bounded supported Git/hosting observations. No mandatory GitHub account, cloud backend, automatic commit/push/merge or guaranteed semantic equivalence detector is authorized.

Execution dependencies: N1. Requirement aliases: BR24, BR25, BR14, BR17. Full approved handoff: .planner/docs/agent-brain-shared-planner-and-execution.md.

Source positions are dated navigation evidence inspected on 21 October 2026 at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231, never durable identity. Revalidate current sources; hashes are in the handoff.

Preserve canonical UUIDs/shortIds and variable-width references, single-owner Accepted Decisions, phase-scoped handoffs, derived parent status, atomic task/session ownership, explicit recovery, global feature -> phase -> task priority and the accepted warning-only no-task guard. Read current sources, existing precedents and applicable Project Guidelines before coding. Use checklist steps rather than creating tasks per step. No automatic commit, push, merge, release or dashboard activation is authorized. This is planned work; no central store or execution/integration model has been implemented by this registration.

Checklist:
- [ ] Inspect existing implementation and record applicable precedents and Guidelines.
- [ ] Add Integration records referencing an execution/result, configured repository target, optional PR identity, source revision(s), observed target/result revision and verification/provenance. Allow several targets and record immutable historical observations.
- [ ] Define target observations for pending review/integration, observed integration, current present/absent/unknown/review-required availability and invalidated verification. Keep historical merge facts separate from current capability claims.
- [ ] Support ordinary merges plus squash/rebase/cherry-pick using provider-neutral observations or explicit user attestation with provenance; original-commit ancestry is one signal, never the only proof. Uncertain equivalence remains unknown.
- [ ] Recheck on target movement, revert, replacement, force-push or execution changes; cache by repository/target/source fingerprints and preserve the old evidence trail when current confidence changes.
- [ ] Define artifact-presence requirements separately from work-order dependencies; a selected checkout can satisfy an artifact through its own source/ancestry even before integration into another target. Non-code tasks need no invented PR.
- [ ] Verify on isolated mkdtemp fixtures: dev-a merges feat/one while dev-b has verified feat/due: the shared planner reports both executions, but the target contains only the demonstrated result of dev-a.
- [ ] Verify on isolated mkdtemp fixtures: Squash/rebase/cherry-pick cases are not falsely absent solely because original SHAs differ; uncertainty is exposed.
- [ ] Verify on isolated mkdtemp fixtures: A later revert invalidates current availability while preserving the historical merge; develop/next/main targets are configurable and release-only main governance is unchanged.

### N3 — Expose work progress and target availability in planner context and UI

Outcome: Agents and supervisors can distinguish what work was performed from what source and evidence are available in their selected workspace or target.

Existing state: Existing selection/context/API/UI surfaces expose logical task status without an execution or target revision dimension. B1 owns selector implementation; H owns graph/inspector and L owns Monaco bindings.

Implementation responsibility:
- Define one availability evaluator and projection contract taking explicit project/workspace/target revision and required artifact inputs, returning evidence, freshness and typed exclusion/unknown reasons for B1 and context consumers.
- Define compatibility projections for logical task/phase/feature progress and separate target delivery counters; do not count all global verified work as code shipped to the viewed branch.
- Expose execution/integration history, global operational view and explicit workspace/target selector through API/events and existing detail/dashboard surfaces. Use clear work/integration labels and visible revision provenance.
- Feed B1 with artifact readiness only when the downstream task actually needs that code; keep logical order, active ownership, ready pending returns and global feature -> phase -> task priority distinct. This task supplies availability, B1 remains the selector owner.
- Extend context/graph/editor contracts with the same chosen source identity; historical/draft/current views remain distinct. Delegate graph navigation to H and Monaco/source/provider work to K/L rather than implementing parallel tools.

Acceptance and evidence:
- Global and target views show dev-b verified in feat/due and awaiting integration without claiming its code is in the viewed target.
- A code-dependent task in another checkout is blocked or uncertain with an actionable reason, while a planning-only dependency is not blocked by a fictitious missing merge.
- Switching workspace/target or observing a revert updates evidence and delivery projections consistently across agent context and UI, without changing canonical task IDs or losing historical progress.

Read before editing:
- packages/plan-core/src/task-selection.ts:283 — recommendNextTask
- packages/plan-core/src/task-context.ts:175 — buildPhaseContextBlock
- packages/plan-core/src/api-v1.ts:343 — buildApiV1Model
- packages/plan-web-ui/src/app/router.tsx:51 — project and entity routes
- packages/plan-web-ui/src/routes/task-detail/route.tsx:108 — task detail route
- packages/plan-server/src/entity-events.ts:1 — domain event publication

Detailed discussion contract:
- The UI selector does not change an agent execution workspace by implication. A source-writing request carries an explicit resolved workspace binding; changing the supervisor view alone cannot redirect an active agent.
- Work-complete and integration-available are separate projections. Preserve existing derived parent status until its documented compatibility mapping is deliberately implemented and verified.
- Target selection and code-availability evidence do not create duplicate tasks or impose code delivery on research, planning or documentation-only outcomes.

Execution dependencies: N2. Requirement aliases: BR25, BR24, BR02, BR04, BR12, BR15. Full approved handoff: .planner/docs/agent-brain-shared-planner-and-execution.md.

Source positions are dated navigation evidence inspected on 21 October 2026 at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231, never durable identity. Revalidate current sources; hashes are in the handoff.

Preserve canonical UUIDs/shortIds and variable-width references, single-owner Accepted Decisions, phase-scoped handoffs, derived parent status, atomic task/session ownership, explicit recovery, global feature -> phase -> task priority and the accepted warning-only no-task guard. Read current sources, existing precedents and applicable Project Guidelines before coding. Use checklist steps rather than creating tasks per step. No automatic commit, push, merge, release or dashboard activation is authorized. This is planned work; no central store or execution/integration model has been implemented by this registration.

Checklist:
- [ ] Inspect existing implementation and record applicable precedents and Guidelines.
- [ ] Define one availability evaluator and projection contract taking explicit project/workspace/target revision and required artifact inputs, returning evidence, freshness and typed exclusion/unknown reasons for B1 and context consumers.
- [ ] Define compatibility projections for logical task/phase/feature progress and separate target delivery counters; do not count all global verified work as code shipped to the viewed branch.
- [ ] Expose execution/integration history, global operational view and explicit workspace/target selector through API/events and existing detail/dashboard surfaces. Use clear work/integration labels and visible revision provenance.
- [ ] Feed B1 with artifact readiness only when the downstream task actually needs that code; keep logical order, active ownership, ready pending returns and global feature -> phase -> task priority distinct. This task supplies availability, B1 remains the selector owner.
- [ ] Extend context/graph/editor contracts with the same chosen source identity; historical/draft/current views remain distinct. Delegate graph navigation to H and Monaco/source/provider work to K/L rather than implementing parallel tools.
- [ ] Verify on isolated mkdtemp fixtures: Global and target views show dev-b verified in feat/due and awaiting integration without claiming its code is in the viewed target.
- [ ] Verify on isolated mkdtemp fixtures: A code-dependent task in another checkout is blocked or uncertain with an actionable reason, while a planning-only dependency is not blocked by a fictitious missing merge.
- [ ] Verify on isolated mkdtemp fixtures: Switching workspace/target or observing a revert updates evidence and delivery projections consistently across agent context and UI, without changing canonical task IDs or losing historical progress.

## O — Lossless shared-planner migration and durable recovery

Adopt one authority from divergent old copies and preserve it independently of code commits.

Current state: Existing tracked .planner entities can diverge between branches/worktrees and collide in Git merges. Current runtime-boundaries.md describes that older shared-and-mergeable layout.

Goals:
- Reconcile old planner knowledge with explicit conflicts and atomic recoverable activation.
- Provide history, independent backup and portable verified export/restore.

Responsibilities:
- O1: Migrate divergent worktree planners through a lossless reviewed binding. A project can adopt one shared authority without losing any worktree knowledge or leaving silent competing planners.
- O2: Add recoverable planner history, backup and portable export/restore. The shared planner retains and can restore operational knowledge independently of whether agents commit code.

Boundaries:
- No mtime-wins, silent new planner fallback or automatic removal of tracked .planner.
- No unrequested distributed synchronization or release workflow change.

Risks:
- Custom common-Git-directory files do not travel with clone/push.
- Partial migration or loss of an unbacked local clone can destroy operational knowledge.

Acceptance:
- Divergent two-worktree fixtures retain every decision/handoff and either reconcile provably compatible edits or report exact unresolved conflicts before activation.
- Interruptions at inventory, write, binding and recovery boundaries preserve backups and one recoverable authority; incompatible clients never write a second plan.
- The migration never runs on another real project or changes repository tracking/AGENTS without the specific user authorization required at implementation time.
- After concurrent writes and process crashes, recovery yields a validated consistent plan or explicit recoverable failure, never a silent empty replacement.
- A complete export restores task/decision/handoff/execution/integration identities and recoverable evidence, without requiring access to the original worktree path.
- A new clone can deliberately import/rebind a backup; ordinary git clone/push is not advertised as copying the shared planner.

Read before editing:
- packages/plan-core/docs/runtime-boundaries.md:1 — current versioned plan and worktree-local runtime policy
- packages/plan-core/src/plan-store.ts:488 — gitCommonDirFor / shared allocation registry
- packages/plan-core/src/export-service.ts:1 — export service
- packages/plan-core/src/write-coordination.ts:95 — writer lock path and transaction coordination
- packages/plan-core/src/plan-store.ts:1413 — localRoot / session and resume paths

Dependencies: M, N. Requirements: BR22, BR23, BR24, BR26, BR27, BR16, BR17. Full approved handoff: .planner/docs/agent-brain-shared-planner-and-execution.md.

Preserve canonical UUIDs/shortIds and variable-width references, single-owner Accepted Decisions, phase-scoped handoffs, derived parent status, atomic task/session ownership, explicit recovery, global feature -> phase -> task priority and the accepted warning-only no-task guard. Read current sources, existing precedents and applicable Project Guidelines before coding. Use checklist steps rather than creating tasks per step. No automatic commit, push, merge, release or dashboard activation is authorized. This is planned work; no central store or execution/integration model has been implemented by this registration.

Source positions above are dated navigation evidence from 21 October 2026, not permanent anchors; revalidate against the current checkout.

### O1 — Migrate divergent worktree planners through a lossless reviewed binding

Outcome: A project can adopt one shared authority without losing any worktree knowledge or leaving silent competing planners.

Existing state: Existing tracked .planner entities can diverge between branches/worktrees and collide in Git merges. Current runtime-boundaries.md describes that older shared-and-mergeable layout.

Implementation responsibility:
- Inventory old plan copies and capture immutable full backups with source worktree/branch/revision provenance before proposing a binding. Use stable IDs and common baseline/history to identify additions, equivalent edits and incompatible concurrent changes.
- Produce a dry-run reconciliation report covering requirements, decisions/supersession, dependencies, task progress, handoffs, evidence and runtime/ownership state; never choose latest mtime or whole-file ours/theirs as conflict policy.
- Preserve all conflicting content for explicit resolution; do not turn textual old done states into fabricated execution/integration proof. Move genuinely portable knowledge and isolate caller runtime, inspecting live ownership rather than importing stale locks.
- Activate the shared binding atomically only after validation, with interruption-safe journal/checkpoint and rollback. All supported clients must agree on schema and authority; old copies become explicit snapshots/read-only migration sources, not silent fallback authorities.
- Provide opt-in descriptor/tracking guidance so future code PRs do not transport live project-wide planner state. Retain legacy compatibility diagnostics, standalone setup and documented recovery from partial activation.

Acceptance and evidence:
- Divergent two-worktree fixtures retain every decision/handoff and either reconcile provably compatible edits or report exact unresolved conflicts before activation.
- Interruptions at inventory, write, binding and recovery boundaries preserve backups and one recoverable authority; incompatible clients never write a second plan.
- The migration never runs on another real project or changes repository tracking/AGENTS without the specific user authorization required at implementation time.

Read before editing:
- packages/plan-core/docs/runtime-boundaries.md:1 — current versioned plan and worktree-local runtime policy
- packages/plan-core/src/plan-store.ts:488 — gitCommonDirFor / shared allocation registry
- packages/plan-core/src/plan-store.ts:1413 — localRoot / session and resume paths
- packages/plan-core/src/write-coordination.ts:95 — writer lock path and transaction coordination
- packages/plan-core/src/export-service.ts:1 — export service

Detailed discussion contract:
- This registration is not the migration. Do not delete .planner, change gitignore/tracking, move files into .git or migrate the user project while implementing isolated contract tests.
- A code PR represents the code delta of its branch; project-wide operational history stays in the shared authority. A deliberate portable snapshot/export is a separate artifact, never proof that all associated code is in that PR.
- If old copies lack a common base or reliable execution provenance, preserve ambiguity and require an explicit reconciliation decision rather than inventing a chronology.

Execution dependencies: N2. Requirement aliases: BR26, BR22, BR23, BR24, BR16. Full approved handoff: .planner/docs/agent-brain-shared-planner-and-execution.md.

Source positions are dated navigation evidence inspected on 21 October 2026 at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231, never durable identity. Revalidate current sources; hashes are in the handoff.

Preserve canonical UUIDs/shortIds and variable-width references, single-owner Accepted Decisions, phase-scoped handoffs, derived parent status, atomic task/session ownership, explicit recovery, global feature -> phase -> task priority and the accepted warning-only no-task guard. Read current sources, existing precedents and applicable Project Guidelines before coding. Use checklist steps rather than creating tasks per step. No automatic commit, push, merge, release or dashboard activation is authorized. This is planned work; no central store or execution/integration model has been implemented by this registration.

Checklist:
- [ ] Inspect existing implementation and record applicable precedents and Guidelines.
- [ ] Inventory old plan copies and capture immutable full backups with source worktree/branch/revision provenance before proposing a binding. Use stable IDs and common baseline/history to identify additions, equivalent edits and incompatible concurrent changes.
- [ ] Produce a dry-run reconciliation report covering requirements, decisions/supersession, dependencies, task progress, handoffs, evidence and runtime/ownership state; never choose latest mtime or whole-file ours/theirs as conflict policy.
- [ ] Preserve all conflicting content for explicit resolution; do not turn textual old done states into fabricated execution/integration proof. Move genuinely portable knowledge and isolate caller runtime, inspecting live ownership rather than importing stale locks.
- [ ] Activate the shared binding atomically only after validation, with interruption-safe journal/checkpoint and rollback. All supported clients must agree on schema and authority; old copies become explicit snapshots/read-only migration sources, not silent fallback authorities.
- [ ] Provide opt-in descriptor/tracking guidance so future code PRs do not transport live project-wide planner state. Retain legacy compatibility diagnostics, standalone setup and documented recovery from partial activation.
- [ ] Verify on isolated mkdtemp fixtures: Divergent two-worktree fixtures retain every decision/handoff and either reconcile provably compatible edits or report exact unresolved conflicts before activation.
- [ ] Verify on isolated mkdtemp fixtures: Interruptions at inventory, write, binding and recovery boundaries preserve backups and one recoverable authority; incompatible clients never write a second plan.
- [ ] Verify on isolated mkdtemp fixtures: The migration never runs on another real project or changes repository tracking/AGENTS without the specific user authorization required at implementation time.

### O2 — Add recoverable planner history, backup and portable export/restore

Outcome: The shared planner retains and can restore operational knowledge independently of whether agents commit code.

Existing state: Tracked planner files currently benefit from user Git commits; custom files under git-common-dir are not pushed or cloned automatically. Existing export-service is an extension point, not proof of complete durable recovery.

Implementation responsibility:
- Define durable operation history/provenance, crash-safe writes/checkpoints and bounded snapshot/backup retention using existing JSON/store conventions; avoid a mandatory new database or full event-sourcing platform.
- Back up canonical entities, decisions, executions, integrations and required recoverable source-snapshot evidence. Classify transient locks/PIDs/read attestations/caches as non-portable; do not export live credentials or adopt foreign ownership.
- Extend portable export/import/restore with format/schema versions, checksums, referenced-blob completeness and explicit identity/rebinding policy for another clone or storage location; restore must not silently overwrite a different live project.
- Make missing/corrupt/incompatible stores diagnosable with recovery paths; verify crash injection, journal replay or checkpoint rollback and backup restoration into isolated mkdtemp fixtures.
- Document normal writes without commits, backup location/status, retention and recovery guarantees/limits. Integrate actual restored-state verification into I1/I2 and preserve no-release/no-auto-commit behavior.

Acceptance and evidence:
- After concurrent writes and process crashes, recovery yields a validated consistent plan or explicit recoverable failure, never a silent empty replacement.
- A complete export restores task/decision/handoff/execution/integration identities and recoverable evidence, without requiring access to the original worktree path.
- A new clone can deliberately import/rebind a backup; ordinary git clone/push is not advertised as copying the shared planner.

Read before editing:
- packages/plan-core/src/export-service.ts:1 — export service
- packages/plan-core/src/write-coordination.ts:95 — writer lock path and transaction coordination
- packages/plan-core/src/plan-store.ts:488 — gitCommonDirFor / shared allocation registry
- packages/plan-core/docs/runtime-boundaries.md:1 — current versioned plan and worktree-local runtime policy

Detailed discussion contract:
- The approved requirement is durable inspectable history plus recoverable backup/export. Exact journal/snapshot implementation and retention defaults remain bounded implementation choices with measured behavior.
- Deleting a worktree does not delete canonical project history. Removing the whole clone/common Git directory can destroy local planner data, so independent backup is part of the product workflow.
- Do not claim distributed multi-machine consistency; the first implementation covers local shared worktrees with a portable boundary for later explicit sync/service support.

Execution dependencies: O1. Requirement aliases: BR27, BR26, BR22, BR16, BR17. Full approved handoff: .planner/docs/agent-brain-shared-planner-and-execution.md.

Source positions are dated navigation evidence inspected on 21 October 2026 at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231, never durable identity. Revalidate current sources; hashes are in the handoff.

Preserve canonical UUIDs/shortIds and variable-width references, single-owner Accepted Decisions, phase-scoped handoffs, derived parent status, atomic task/session ownership, explicit recovery, global feature -> phase -> task priority and the accepted warning-only no-task guard. Read current sources, existing precedents and applicable Project Guidelines before coding. Use checklist steps rather than creating tasks per step. No automatic commit, push, merge, release or dashboard activation is authorized. This is planned work; no central store or execution/integration model has been implemented by this registration.

Checklist:
- [ ] Inspect existing implementation and record applicable precedents and Guidelines.
- [ ] Define durable operation history/provenance, crash-safe writes/checkpoints and bounded snapshot/backup retention using existing JSON/store conventions; avoid a mandatory new database or full event-sourcing platform.
- [ ] Back up canonical entities, decisions, executions, integrations and required recoverable source-snapshot evidence. Classify transient locks/PIDs/read attestations/caches as non-portable; do not export live credentials or adopt foreign ownership.
- [ ] Extend portable export/import/restore with format/schema versions, checksums, referenced-blob completeness and explicit identity/rebinding policy for another clone or storage location; restore must not silently overwrite a different live project.
- [ ] Make missing/corrupt/incompatible stores diagnosable with recovery paths; verify crash injection, journal replay or checkpoint rollback and backup restoration into isolated mkdtemp fixtures.
- [ ] Document normal writes without commits, backup location/status, retention and recovery guarantees/limits. Integrate actual restored-state verification into I1/I2 and preserve no-release/no-auto-commit behavior.
- [ ] Verify on isolated mkdtemp fixtures: After concurrent writes and process crashes, recovery yields a validated consistent plan or explicit recoverable failure, never a silent empty replacement.
- [ ] Verify on isolated mkdtemp fixtures: A complete export restores task/decision/handoff/execution/integration identities and recoverable evidence, without requiring access to the original worktree path.
- [ ] Verify on isolated mkdtemp fixtures: A new clone can deliberately import/rebind a backup; ordinary git clone/push is not advertised as copying the shared planner.

## Requirement coverage

- **BR22 — One authoritative project planner across local worktrees**: All supported agents and supervisor clients see the same canonical project knowledge and task ownership across local worktrees, without merging live planner state through unrelated code PRs. A selected code workspace remains explicit, and independent clones/machines require a deliberate shared-service or portable transfer boundary. Linked phases: M, N, O, I.

- **BR23 — Independent workspace and caller context within a shared project**: A project shares canonical knowledge and coordination while preserving distinct code roots, workspace identities, caller focus/returns and revision-scoped context. Moving or removing a worktree does not corrupt another workspace or erase historical provenance. Linked phases: M, N, O, B, C, E, F, G, K, L, I.

- **BR24 — Attributable task executions separate from delivery**: Each logical task retains identifiable execution attempts, source baselines/results or recoverable dirty snapshots, phase-handoff links and exact-revision verification evidence. Completion of work in one branch does not assert integration into another target; legacy and non-code work preserve honest provenance and uncertainty. Linked phases: N, O, B, C, E, G, H, I.

- **BR25 — Revision-aware target availability and delivery views**: Agents and supervisors can distinguish global work progress from result availability in an explicitly selected checkout or configured target. Independent integration history supports multiple targets and current observations; revert/rebase/squash and uncertain equivalence cannot silently misstate readiness or delivery. Linked phases: N, B, C, E, G, H, K, L, I.

- **BR26 — Lossless adoption of a shared planner from existing copies**: A project can preview, reconcile and activate a single shared planner from divergent worktree copies without losing approved knowledge, IDs, decisions, handoffs or attributable history. Incompatible edits remain explicit and recoverable; interruption or an incompatible client cannot create a silent parallel authority. Linked phases: O, I.

- **BR27 — Planner history and recovery independent of code commits**: Project planning knowledge and execution/integration history remain durable without an agent committing code. Users can inspect change history, maintain independent backups and deliberately export/restore a complete portable project record including required recoverable evidence, without transferring stale live ownership or assuming Git clone/push copies it. Linked phases: O, I.

## Accepted Decisions

### AD14 — One shared planner authority outside code branch copies

Local worktrees of one project use one canonical planner authority discovered through project identity and git-common-dir, with explicit standalone roots for non-Git projects. Live global planner state is not transported by ordinary code PRs.

Rationale: Sharing branch copies or merging all live progress through dev-a code can report dev-b work as delivered without its code. Independent local copies also lose coordination and conflict.

Implementation: Use M1/M2 and O1/O2. The intended default is <git-common-dir>/agent-plan/<projectId>/; exact layout/transport is an implementation choice. Keep open JSON formats and an explicit cross-clone/service boundary; no implicit cloud or distributed consistency.

### AD15 — Planner, code workspace and caller runtime have separate identities

planRoot, workspaceRoot and runtimeRoot are resolved independently. Canonical knowledge and task claims are shared, while focus, returns, context attestations, source/provider caches and overlays are scoped by their actual caller/workspace/revision owners.

Rationale: Current code derives source/runtime paths from planner location. Blind centralization would mix worktrees or make agents read the central directory as source.

Implementation: M1/M2 own binding and coordination. Preserve stable workspace identity through path/branch changes, atomic claims and explicit recovery. K2 reuses this boundary but continues to own the single compatible language-server runtime; UI view changes cannot redirect active executions.

### AD16 — A logical task has executions and independent target integrations

Keep one logical task with attributable execution attempts and exact-revision evidence; represent integration of produced results into each configured target separately. A verified execution does not mean code is present in the target.

Rationale: An agent can finish in a worktree while another agent merges unrelated code. A path/branch flag or single done state cannot represent that safely.

Implementation: N1/N2/N3 own the model/projections, E2 owns changeset capture. Preserve phase-scoped handoffs, dirty snapshot evidence and unknown legacy provenance. Non-code tasks do not require fabricated commits/PRs. Targets are configurable; develop/next/main release governance is unchanged.

### AD17 — Current code availability differs from work progress and historical merges

Expose global operational progress separately from workspace/target availability and delivery. Revalidate source-dependent evidence at the selected revision; use artifact availability only for tasks that need that code, preserving global priority within ready work.

Rationale: A historical PR merge may be followed by a revert or changed implementation, and squash/rebase can change SHA identity without removing the result.

Implementation: N2 supplies bounded integration observations; N3 supplies availability and separate UI/API counters; B1 remains selector owner. Distinguish present/absent/unknown/review-required and invalidate stale evidence rather than promising general semantic equivalence.

### AD18 — Shared-planner adoption requires lossless migration and independent recovery

Inventory and back up every old planner copy, reconcile with provenance and explicit conflicts, then activate one recoverable binding. Maintain durable history/checkpoints, independent backup and portable export/restore because central files are not cloned/pushed automatically.

Rationale: Moving out of branch copies removes implicit Git distribution and exposes data loss if a clone is deleted or migration discards divergent knowledge.

Implementation: O1/O2 own migration and durability; I1/I2 own full cross-surface and installed closeout. No mtime-wins, silent fallback, invented provenance or automatic Git/tracking change. This approval registers the work only; it does not execute the migration.

## Source catalog

Navigation positions were inspected at commit c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231 on 21 October 2026. Hashes bind this inspection; they are not permanent code identities. Revalidate before implementation.

| Source | Inspected symbol / entry point | SHA-256 |
| --- | --- | --- |
| packages/plan-core/src/plan-store.ts:488 | gitCommonDirFor / shared allocation registry | ff7fd84a652c248fa0f883000be02e0d841a9485bcf7a73f2e9c974ce8f6a13c |
| packages/plan-core/src/plan-store.ts:1413 | localRoot / session and resume paths | ff7fd84a652c248fa0f883000be02e0d841a9485bcf7a73f2e9c974ce8f6a13c |
| packages/plan-core/src/plan-store.ts:3493 | registerSession / claimTask / recoverSessionForTask | ff7fd84a652c248fa0f883000be02e0d841a9485bcf7a73f2e9c974ce8f6a13c |
| packages/plan-core/src/write-coordination.ts:95 | writer lock path and transaction coordination | 4e3f4933708e472e8ee5bc6ab0569ba4886c853deae0bb338b676287f4aee776 |
| packages/plan-core/src/schema.ts:252 | TaskSchema / dependsOn / pauseSnapshot / activeOwnerSession | 5974d2b4ef5c27531c16c4679cbfb13fac1a4f4a67919917d7b0f1bc420aade2 |
| packages/plan-mcp/src/index.ts:118 | planRoot / AGENT_PLAN_ROOT | 9758764c28657590fa9dfbd8aea40b6009ca04f9031487c8161524483a7c6179 |
| packages/pi-adapter/src/index.ts:275 | planRootForCwd / resolvePlanRoot / ensureStore | 167ac3fd6b7f4294e47f7c5c9815a585b35abcb7d78ce60f3d712abc03dd0da0 |
| packages/agent-plan/src/index.ts:124 | plannerRoot | 5c296749b47409ffa0ee0d60e213228457ed31d7619f9bf6c2642e4b16261a6f |
| packages/plan-server/src/serve.ts:258 | GET /project derives projectRoot from dirname(store.root) | 683ad4cb8d6205323af8b0ddd5ec7e12e8e5f44425f4624101f9c5c87234d8be |
| packages/plan-server/src/server-record.ts:1 | advisory server discovery record | 462f5450ed3b7c4c0a256cc41178908020dcbfe5a0d38d82034e282a504a660d |
| packages/plan-core/docs/runtime-boundaries.md:1 | current versioned plan and worktree-local runtime policy | cd4157af1cd51b5157c8cd70defc6dbdca6d84b71688298d05fa1c3aec6aaf1a |
| packages/plan-core/src/task-selection.ts:283 | recommendNextTask | a8d2ba9f84aaf75b419898b37f462f81990ccc46ef1ca505ba590e26968e3c79 |
| packages/plan-core/src/session-focus.ts:1 | caller-scoped focus and returns | efeeaf1c0bd6268bd5b57ae67ce5e436cab4ea66c39034227c012f71709dc0f4 |
| packages/plan-core/src/handoff-context.ts:1 | phase-scoped handoff context | ed1f411831e3258b202395a8daf892e1de63e7d508da7584dd4d984112a64ea9 |
| packages/plan-core/src/task-context.ts:175 | buildPhaseContextBlock | 4eac899e1fcd10573644ab05508cd2029b2a5362524eed06c5df9f426b7bb3a6 |
| packages/plan-core/src/api-v1.ts:343 | buildApiV1Model | d26d55905771d106fda58a6d637dbb1a333bc3d22d11c97bb0f13e278f316c9e |
| packages/plan-core/src/export-service.ts:1 | export service | c9085a8742a9dd7d12c32249aec4d76a06db851133e6775ede84a824cf735c54 |
| packages/plan-web-ui/src/routes/task-detail/route.tsx:108 | task detail route | 623bdf0a6fe8a74851d59e3b6c5a9c5139962d89aa7c1fa240faa1af61ef47b1 |
| packages/plan-web-ui/src/app/router.tsx:51 | project and entity routes | 5e558ddd71a6b871955137e6bdb3c956b8c1ce81123e526b3942872c1492b3ef |
| packages/plan-server/src/entity-events.ts:1 | domain event publication | 4701eceee5efc585779697e1baa52d4711be44689c42dd1291b3509cb3ae68ff |

## Allocated canonical references

| Alias | Canonical ref | UUID |
| --- | --- | --- |
| M1 | P128(F025)/T489 | 7f8c3c08-e0a0-4136-9a58-ae2e8945b5d4 |
| M2 | P128(F025)/T490 | 93f5f6da-cb75-4c4b-a055-7c2cedb3a56f |
| N1 | P129(F025)/T491 | 281720b5-1617-42bd-809d-42b76c8bba4b |
| N2 | P129(F025)/T492 | f9af06a6-3897-4184-9eea-b7b02e16d052 |
| N3 | P129(F025)/T493 | c83cce3f-0d98-4e5c-ab60-192824cf91f6 |
| O1 | P130(F025)/T494 | 2c05c24d-6993-4a3e-8d8b-9aa31a568ed2 |
| O2 | P130(F025)/T495 | 2e04d951-d7c2-4bd6-92e7-9dfbdf3f4062 |
| M3 | P128(F025)/T496 | e1111601-64ad-49d5-9805-df48e9dd4b70 |

M3/T496 is the additional mutation-impact foundation and is fully specified in the focused token/reconciliation handoff. Current M2 priority is 3; its prerequisites are T489 and T496. The earlier M phase responsibility list above describes the two original storage tasks and is extended by this foundational task.
