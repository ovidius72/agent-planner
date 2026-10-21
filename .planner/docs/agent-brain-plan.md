# Agent Brain — reliable agent workflow and code-aware project memory

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

Prepared 20 October 2026. Repository: `/Users/antonio/projects/agent-plan`. Branch: `feat/agent-brain`, based on refreshed `origin/main` at `c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231`.

**Original registration state (20 October):** registered as **F025** in the canonical planner on 20 October 2026: 9 phases, 22 planned tasks, 21 validated task dependencies, 17 outcome requirements and 10 single-owner Accepted Decisions (one project decision and nine feature decisions). All 171 implementation checklist items remain unchecked. The earlier write-permission blocker is historical and was resolved before registration. This document is supporting design; canonical planner entities and decisions remain the operational authority. No Agent Brain implementation has started.

Evolve Agent Plan in the same repository into a reliable, code-aware project memory and operating workflow. First address the six reported failures: orientation among phase handoffs, repeated resume context cost, ignored rules/conventions, lost return to interrupted work, inconsistent next-work priority and unnecessary task growth. Then add structured code links, task changesets, scoped decision history, capability-based multilingual setup, a queryable graph, relevant context retrieval and supervisor UI. Existing planning memory, requirements, Accepted Decisions, phase handoffs, read gates and atomic ownership already exist and must be extended rather than recreated.

Baseline: origin/main c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231 on branch feat/agent-brain. Relevant completed work includes F016/F018/F020/F021/F023/F024; their historical descriptions are not proof of current behavior. Core points: packages/plan-core/src/task-selection.ts (recommendNextTask), recap.ts (buildRecap), task-context.ts (buildPhaseContextBlock), project-context.ts, read-tracking.ts, schema.ts and plan-store.ts (claimTask/Accepted Decision CRUD). Adapter surfaces: packages/plan-mcp/src/index.ts, packages/pi-adapter/src/index.ts, packages/plan-server/src/serve.ts; public projection in packages/plan-core/src/api-v1.ts and packages/plan-server/src/entity-events.ts; existing Web UI under packages/plan-web-ui/src/. Source catalog in .planner/docs/agent-brain-plan.md binds navigation lines, symbols and file hashes to the baseline; revalidate before editing.

Preserve canonical entity IDs and ownership, phase-scoped handoffs, derived parent statuses, existing human-supervisor semantics, no automatic dashboard activation and shared/local runtime boundaries. The project no-task guard decision remains warning-only; a new write-denial policy is not implicitly approved. File:line is never permanent identity. Analysis targets each user's project through an open set of compatible providers discovered/configured from extensible metadata; named languages are non-exclusive fixtures, not a planner-core whitelist. TypeScript is not a universal analyzer. Empty folders and undecided stacks are valid.

All work is planned, not implemented. The earlier 11-case TypeScript anchor proof was isolated and does not establish production or cross-language support. Standalone AgentTest, new product branding/package renames, autonomous publishing and a mandatory graph database/embedding service are outside scope. Canonical requirements, decisions, phase/task descriptions and checklists define execution; the supporting document explains contracts, sources, scenario matrix and remaining technical choices.

## Current scope after the Monaco expansion

F025 now has **12 phases, 28 planned tasks, 33 dependency edges, 21 outcome requirements and 13 Accepted Decisions** (one project-owned and twelve feature-owned). All **229** implementation checklist items are unchecked. The Monaco/source/shared-analysis/title contracts are detailed in [the complete expansion handover](agent-brain-editor-and-project-identity.md). The original registration and earlier amendment reports below are historical snapshots; this current scope and canonical planner read-back supersede their old entity counts. No implementation has started.

## Planning amendment — 21 October 2026

The canonical F025 amendment keeps the same 9 phases, 22 tasks, 17 requirements, 10 decisions and 21 task dependencies. Language names in historical source documents are examples. P121/T473 owns stack-driven setup and tool preparation; T474 owns extensible provider discovery/configuration and shared adapters; T475 verifies dynamic extension and mixed-language coverage. No runtime setup or product implementation is performed by this amendment.

The open language set comes from versioned provider manifests/catalog entries and explicit compatible-provider configuration. Each entry declares language/version selectors, protocol/interface, supported operations, prerequisites, preparation and probes. Match these against the declared or detected stack, reuse compatible local tools or prepare the selected tools under existing policy, validate effective workspace/build configuration and real results, then expose verified capabilities per source area. Configure a new language on an existing adapter through metadata; a new protocol can need an adapter. No protocol promises a complete discoverable installation catalog. Missing analysis retains planning/text retrieval and explicit limits.

Feature, phase and task numbers have a minimum display width of three digits, not a three-digit capacity. Current naming.ts uses padStart(3) and refs.ts accepts one or more digits. The concrete exception found during this planning review is on-hold.ts REF_IN_TEXT, which limits recognition to 1–4 digits. P117/T464 owns that parked-return correction; P124/T481 owns allocation/resolution, ordering/search, dependencies, exports, API/MCP/Pi and UI compatibility at 999→1000 and 9999→10000 and larger valid values. Preserve UUIDs, shortIds, existing sequence values and history. Use isolated counter-boundary fixtures and an explicit safe-integer policy rather than renumbering or merely increasing the padding width. MT-xxx macro-task limits belong to a separate model and are outside this requested F/P/T change.

The 20 October registration verification remains historical evidence of the original registration. Current amendment verification is recorded separately; neither report establishes implemented product behavior.

## Execution order and ownership

Canonical priorities and validated task edges determine execution, not increasing phase numbers. The original A–I and new J–L labels are supporting aliases only. Equal phase priorities use the established number/createdAt tie-break, preserving the existing global feature → phase → task policy.

| Order | Phase | Canonical reference | Priority |
|---|---|---|---|
| 1 | A: Baseline and acceptance contracts | P116(F025) | 1 |
| 2 | J: Project identity and browser page titles | P125(F025) | 1 |
| 3 | B: Deterministic priorities and reliable returns | P117(F025) | 2 |
| 4 | C: Useful orientation and efficient context restoration | P118(F025) | 3 |
| 5 | D: Application of existing standards and planning discipline | P119(F025) | 4 |
| 6 | E: Code links, task changesets and decision history | P120(F025) | 5 |
| 7 | F: Project setup and multilingual code intelligence | P121(F025) | 6 |
| 8 | G: Unified graph, contextual retrieval and freshness | P122(F025) | 7 |
| 9 | K: Code workspace access and shared analysis service | P126(F025) | 7 |
| 10 | H: Supervisor UI and graph exploration | P123(F025) | 8 |
| 11 | L: Integrated Monaco workspace and external-editor navigation | P127(F025) | 8 |
| 12 | I: Compatibility, installed validation and operating documentation | P124(F025) | 9 |

J is independent title reliability work. K reuses F providers; L reuses K, J and H. I remains final closeout and additionally waits for L2/L3. Do not start implementation merely because planning has been registered.

## Canonical registration references

The A–L and their task keys in this design are local aliases. Use the allocated references below for planner operations. The [registration evidence map](agent-brain-registration.json) also resolves requirement and decision aliases to canonical IDs and owners; it is not another operational planner.

| Design phase | Canonical phase | Canonical tasks |
|---|---|---|
| A | P116(F025) | A1 → P116(F025)/T461; A2 → P116(F025)/T462 |
| J | P125(F025) | J1 → P125(F025)/T483 |
| B | P117(F025) | B1 → P117(F025)/T463; B2 → P117(F025)/T464 |
| C | P118(F025) | C1 → P118(F025)/T465; C2 → P118(F025)/T466 |
| D | P119(F025) | D1 → P119(F025)/T467; D2 → P119(F025)/T468; D3 → P119(F025)/T469 |
| E | P120(F025) | E1 → P120(F025)/T470; E2 → P120(F025)/T471; E3 → P120(F025)/T472 |
| F | P121(F025) | F1 → P121(F025)/T473; F2 → P121(F025)/T474; F3 → P121(F025)/T475 |
| G | P122(F025) | G1 → P122(F025)/T476; G2 → P122(F025)/T477; G3 → P122(F025)/T478 |
| K | P126(F025) | K1 → P126(F025)/T484; K2 → P126(F025)/T485 |
| H | P123(F025) | H1 → P123(F025)/T479; H2 → P123(F025)/T480 |
| L | P127(F025) | L1 → P127(F025)/T486; L2 → P127(F025)/T487; L3 → P127(F025)/T488 |
| I | P124(F025) | I1 → P124(F025)/T481; I2 → P124(F025)/T482 |

The first ready task is **P116(F025)/T461 — Reproduce the reliability failures on isolated fixtures**. Registration queried the recommendation without starting it. Source-analysis, provider, migration, UI and installed-artifact verification described below remain planned implementation work. The historical 11-case prototype result was inspected as transferred evidence and was not rerun.

## Product requirements

These aliases resolve to canonical IDs in the registration map. Requirements remain product outcomes; implementation process remains in Guidelines.

### BR01: Actionable orientation after a long pause

A returning user or agent can understand multiple phase handoffs, current/partial work, blockers and a justified next step without remembering old references.

Linked phases: A, B, C, H, I.

### BR02: One explainable global next-work order

All surfaces return the same ready work from the same snapshot and caller identity: active work and pending returns precede globally ready feature → phase → task priority; dependencies, blocks and ownership remain availability constraints.

Linked phases: A, B, I.

### BR03: Durable return to interrupted work

Temporary detours preserve their source and nested return chain across task/phase completion, restart and explicit stopped-session recovery; unready returns remain visible.

Linked phases: A, B, C, I.

### BR04: Complete context restoration with bounded delivery

Required project and work context remains recoverable across sessions, compaction and source changes, with explicit incomplete delivery and measurable avoidance of duplicate transmission.

Linked phases: A, C, D, G, I.

### BR05: Inspectable application of project conventions

The product exposes source-backed evidence of applicable rules, relevant implementation precedents, planned reuse and conformity review, distinguishing delivered information from unverified understanding.

Linked phases: A, D, G, H, I.

### BR06: Proportionate work planning and capability ownership

Users and agents can discover existing ownership before adding work, retain implementation steps in the current task and distinguish a justified independent outcome from duplication.

Linked phases: A, D, I.

### BR07: Reliable current and historical code references

Planner knowledge can link to user-project modules/files/regions/symbols with recoverable baseline, snapshot-bound current resolution, explicit ambiguity and separate meaning-review state.

Linked phases: E, F, G, H, I, K, L.

### BR08: Traceability for large developments and unrelated tasks

A task spanning many files has an attributable changeset and module-level outcome; later work can discover prior modifications through shared code targets without explicit task-to-task links.

Linked phases: E, G, H, I, K.

### BR09: Durable scoped rationale and decision history

Applicable architectural decisions and prior parameter/behavior rationale remain discoverable across task and phase boundaries, with explicit revision/supersession and no fabricated missing intent.

Linked phases: E, G, H, I, L.

### BR10: Onboarding before code or language selection

A project can begin in an empty folder, retain an undecided stack, record the agreed stack and activate analysis after the required scaffold/configuration becomes available.

Linked phases: F, H, I.

### BR11: Dynamic language support with explicit capability coverage

For any declared or detected project language, Agent Brain can discover compatible registered analysis providers, reuse or prepare and configure them, and expose their verified capabilities per source area. The language set is extensible through provider metadata/configuration and compatible adapters, without a language whitelist in planner core. Unavailable or incomplete analysis preserves planning and text retrieval with explicit limits.

Linked phases: E, F, G, H, I, K, L.

### BR12: Queryable planner and code relationships

Requirements, work, decisions, code and verification evidence can be traversed and explained in either direction with canonical identities, provenance and compatible API/event delivery.

Linked phases: E, G, H, I, L.

### BR13: Global orientation and impact-scoped deep context

An incoming agent can orient itself globally and retrieve current code, applicable decisions, analogous implementations, callers/interfaces/dependencies and tests for the work and its relevant impact boundaries.

Linked phases: C, D, F, G, I, L.

### BR14: Visible freshness and explicit review obligations

Changes to relevant sources/configuration/dependencies invalidate affected evidence and expose baseline/diff/current context; unknown, not retrieved, stale and absent information remain distinct.

Linked phases: C, E, F, G, H, I, K, L.

### BR15: Coherent human supervision

The UI explains work selection and return obligations, analysis readiness, context evidence and code/decision relationships while preserving hierarchy, live updates and authorized human controls.

Linked phases: B, C, D, H, I, J, L.

### BR16: Compatible behavior across supported agent surfaces

Core, MCP, Pi, server and supported harness integrations share domain semantics and preserve old plans, stable IDs, ownership and canonical/local runtime boundaries. Feature, phase and task references grow beyond three and four digits without truncation or renumbering: allocation, resolution, ordering, dependencies, parked-work recognition, API/MCP/Pi, export and Web UI retain the same canonical identity.

Linked phases: A, B, C, D, E, F, G, H, I, J, K, L.

### BR17: Revision-bound verification evidence

Relevant tests/checks and their observed results can be associated with work and code revisions, exposing partial verification and keeping future AgentTest integration separate from this feature.

Linked phases: D, E, G, H, I.

### BR18: Persistent project identity in browser navigation

Initialized project pages remain distinguishable by the project name in browser titles and visible navigation. The overview identifies the project; task detail uses ProjectName - TaskID [Short task title], with the same project-first convention for feature and phase details, including navigation and live renames.

Linked phases: J, L, I.

### BR19: Editable source workspace connected to project knowledge

The Web UI provides a project file explorer, Monaco editing, syntax coloring, diff and revision-aware saves. Source selection and resolved links expose applicable planner context while preserving drafts, external edits and current versus historical evidence.

Linked phases: K, L, I.

### BR20: One compatible analysis runtime for agents and the Web UI

Supported agent surfaces and the editor share a compatible analysis runtime for the same project/worktree, provider/version and effective configuration, with explicit source versions, capability limits and independent consumer lifecycles. Opening the editor does not by itself duplicate language-server processes.

Linked phases: F, K, L, I.

### BR21: Open resolved source in a preferred external editor

A user can open a resolved project source location in a configured external editor with correct file and supported line/column, machine-local preferences, explicit target-machine semantics and clear handling of unsaved or unavailable files.

Linked phases: L, I.

## Accepted decisions and preserved constraints

Create AD01 once on the project. Create AD02–AD10 once on this feature. Do not copy these decisions into every phase/task. Preserve and reference the existing project decision `7995854e-4109-48aa-b08b-a54bff4d8432` rather than replacing or duplicating its warning-only policy.

### AD01: Ready work follows global feature → phase → task priority

Owner: project.

Decision: When no owned active work or actionable pending return takes precedence, choose ready available work globally by feature priority, then phase priority, then task priority. Current-phase continuity does not override higher global priority. Dependency, block and ownership constraints remain in force.

Rationale: Explicit user answer on 20 October 2026: Priorità globale feature → fase → task.

Implementation notes: Implement once in the shared core; recap, recommendations, completion, MCP/Pi/server and UI consume the same result. Respect priority zero, deterministic ties and explicit user choices.

### AD02: Evolve Agent Plan and stabilize existing workflows first

Owner: feature.

Decision: Agent Brain is an evolution in this repository. Reuse existing planner memory, requirements, decisions, tasks, checkpoints, phase handoffs and ownership. Resolve the six reported reliability problems before the code graph extensions.

Rationale: The user corrected the initial gap analysis: most planning/memory structures already exist; the priority is their reliable application.

Implementation notes: Use branch feat/agent-brain from refreshed origin/main as requested. Do not create a parallel planner, forked product authority or automatic task per inventory bullet.

### AD03: Code intelligence targets the user project and is language independent

Owner: feature.

Decision: The analyzed code belongs to the project using Agent Plan. Persisted links and domain contracts are language independent. Resolve the declared or detected languages against extensible provider metadata and actual compatible tool capabilities, rather than a fixed language whitelist in planner core. TypeScript is the implementation host, not a universal source analyzer.

Rationale: The user explicitly clarified on 21 October 2026 that the previously named languages are examples, not the complete supported language set.

Implementation notes: Use versioned provider manifests/catalog entries and user-configured compatible providers. Probe language/version/platform, workspace/build prerequisites and supplied operations before activation. A new language supported by an existing adapter is enabled through provider metadata/configuration, without editing planner core. A genuinely new protocol may need an adapter. Validate multiple unrelated language families and a dynamically added language fixture; Rust, C/C++, Java and JS/TS are non-exclusive examples. Keep coverage per provider, operation, configuration and source area; unsupported cases retain text/planning capabilities.

### AD04: Code links distinguish historical evidence, current location and meaning review

Owner: feature.

Decision: A file:line reference is a navigation position, not permanent identity. Preserve recoverable snapshot baselines and provenance, resolve current locations separately, and keep architectural/factual review distinct from location resolution.

Rationale: The user identified stale references and explanations after code changes as dangerous.

Implementation notes: Handle dirty state and worktree/configuration identity. External rename/move/copies yield verified candidates or ambiguity; no silent semantic relinking or approved-decision rewrite.

### AD05: Trace large work through changesets and scoped rationale

Owner: feature.

Decision: Track an entire task changeset automatically and record significant decisions at the appropriate module/interface/function scope. Do not require manual documentation of every modified function. Prior tasks become discoverable through shared code targets even without task-to-task references.

Rationale: The user emphasized that tasks often implement large pieces of code and unrelated tasks later modify the same function.

Implementation notes: Capture baseline/checkpoints/closeout and preserve initial dirty state. Attribute only observed task/session changes; ambiguous overlap remains explicit. Canonical decisions keep one durable owner and versioned history.

### AD06: Provide global orientation and relevant deep context

Owner: feature.

Decision: Offer a source-backed global map immediately and retrieve detailed context for the current work and its relevant impact boundaries. Do not claim that the model has instantly read or understood the entire codebase.

Rationale: The user asked whether a new agent receives full codebase context or only the area of work.

Implementation notes: Retrieve applicable rules, prior rationale, correct precedents, usages/interfaces/dependencies and tests. Expose unavailable, not retrieved, stale and absent information and explicit continuation under budgets.

### AD07: Begin setup from discussion and declared stack, not assumed source detection

Owner: feature.

Decision: An empty folder with an undecided language is a valid project state. Record stack decisions during discussion and activate only needed analysis capabilities when their prerequisites are available. Later source detection validates declared choices.

Rationale: The user corrected the assumption that discussion always starts in an existing repository.

Implementation notes: Use an extensible versioned provider catalog and explicit configured-provider entries, not a closed language enum. Resolve matching providers, reuse compatible local tools or produce a concrete preparation/configuration plan under existing installation policy, then validate real results. Protocols do not provide universal server/indexer discovery or installation. SCIP ingestion, live LSP and syntax parsing are complementary options, not three mandatory universal installations. Keep managed tools outside user application dependencies and preserve stack-undecided projects.

### AD08: Extend existing standards workflow with evidence rather than repeated instructions

Owner: feature.

Decision: Read and apply existing project rules and appropriate implementation precedents before writing code; preserve evidence and review final conformity. Extend the existing canonical skill/protocol instead of presenting these obligations as new functionality.

Rationale: Explicit user report: agents already receive these instructions but ignore established code conventions.

Implementation notes: Preserve project decision 7995854e-4109-48aa-b08b-a54bff4d8432 on the warning-only no-task guard. New write-denial policy is not implicitly approved. Observed reads and a checked checklist do not prove semantic conformity; document actual harness coverage and qualitative review.

### AD09: Keep skills portable and canonical knowledge authoritative

Owner: feature.

Decision: Use the existing core/shared skill distribution for all supported harnesses. Adapt useful external skill/rule/hook patterns without making Claude-specific configuration or a derived graph the authority over the planner.

Rationale: The user requested generalized Agent Plan skills inspired by Everything Claude Code, usable by all agents.

Implementation notes: Domain policies stay in core. Preserve canonical versus local runtime boundaries; graph/index packets are derived. Existing single-owner decisions and phase-scoped handoffs remain authoritative.

### AD10: Keep standalone AgentTest outside this feature

Owner: feature.

Decision: Use and link existing tests and revision-bound verification evidence for Agent Brain. A separate autonomous test generation/execution product called AgentTest is not a prerequisite or an implicitly included development stream.

Rationale: AgentTest was an earlier concept, not an identified existing repository; the agreed scope prioritized the six failures and code graph.

Implementation notes: Leave an explicit extension seam for test evidence and future integrations, and document missing coverage. Do not add a separate planner or AI testing platform under this feature.

## Working rules to append without replacing existing Guidelines


## Agent Brain implementation workflow

Before modifying code for this feature, read the applicable project instructions, canonical Guidelines and Accepted Decisions, the exact feature/phase/task, and relevant existing implementations, interfaces and tests. Record a concise source-backed analysis on the existing task: precedents and their relevance, conventions, reuse, architectural ownership, intended integration and verification. Explicit rules and approved decisions take precedence over incompatible legacy examples. If no relevant precedent exists, state that fact and resolve material missing conventions through the existing discussion process.

Apply the existing lifecycle and ownership rules; preserve phase-scoped handoffs, canonical IDs and dependency edges. Use checklists for implementation details instead of creating more tasks. Before completing work, compare the actual diff with the selected precedents and applicable rules and record concrete verification and conformity evidence, including what remains unverified. A read receipt, ticked checklist or passing build alone is not architectural proof.

Reuse valid available context and refresh affected evidence after context loss, source changes or an expansion into another area. Follow existing authorization; do not add a permission prompt for every routine already authorized step. Preserve the accepted warning-only no-task guard. Never modify AGENTS.md, publish, release, push or open a PR without the authorization those actions require.

Keep source code and technical product text in English and preserve the existing React/component/test conventions. Follow the bounded verification and tracked web-ui-dist rules in AGENTS.md. Supporting Agent Brain design is under .planner/docs/agent-brain-plan.md; canonical planner entities and decisions remain the operational authority.


## Detailed phases and tasks

### A. Baseline and acceptance contracts

Reproduce the six reported failures and distinguish regressions from already shipped behavior.

Goals:
- Produce an evidence-backed baseline for the six user problems and their shared domain contracts.
- Identify existing implementations to extend, including completed F016/F018/F020/F021/F023/F024.

Out of scope:
- Do not rebuild persistent memory, decisions, phase handoffs or task ownership.
- Do not implement the code graph before the reliability block is accepted.

Risks:
- Historical descriptions and the earlier audit can be stale after origin/main updates.
- A passing handler test does not establish installed runtime behavior.

Open choices:
- Which reported scenarios reproduce on this baseline, and which need a narrower regression fixture?

#### A1. Reproduce the reliability failures on isolated fixtures

Outcome: A reproducible, bounded baseline identifying the failing layer for each of the six reported problems without changing real project plans.

Existing state: Existing lifecycle, ownership, return stacks, read attestations and parked-task resumption are already shipped; F024 specifically addressed parked-state startability. Earlier observations were static and must be rechecked.

Implementation responsibility:
- Read the current implementations and relevant completed feature records before proposing changes.
- Create temporary fixture plans for multiple handoffs, long pauses, nested returns, global priorities, context loss and duplicate work creation.
- Exercise core plus real MCP/Pi/server paths where supported; record loaded versions, fixtures and content fingerprints.
- Classify each result as reproduced failure, already resolved behavior, incomplete evidence or uncovered harness path.

Acceptance and evidence:
- All six reports have a reproducible scenario or an explicit evidence gap.
- Fixtures never write to another real project or its planner.
- Existing atomic claims and explicit recovery remain covered.

Read before editing:
- packages/plan-core/src/task-selection.ts:283 — export function recommendNextTask
- packages/plan-core/src/recap.ts:46 — export async function buildRecap
- packages/plan-core/src/on-hold.ts:1 — (module)
- packages/plan-core/src/session-focus.ts:1 — (module)
- packages/plan-core/src/read-tracking.ts:28 — type ReadState
- packages/plan-mcp/src/index.ts:2263 — server.registerTool("planner-task-start"
- packages/pi-adapter/src/index.ts:1385 — async function scanCodebase
- packages/plan-server/src/serve.ts:1 — (module)
These module/symbol references and line positions were inspected at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231; revalidate against the current checkout. New module names/provider/storage details remain implementation choices to resolve in the owning task, not claims of existing code.

Preserve: canonical IDs, decision ownership, phase-scoped handoffs, atomic task/session ownership, derived parent statuses and the accepted warning-only no-task guard. Follow the existing project Guidelines and record relevant source precedents and conformity evidence on this task. Do not create new tasks for the checklist steps.

Plan dependencies: none. Product requirement coverage: BR01, BR02, BR03, BR04, BR05, BR06, BR16. Supporting design: .planner/docs/agent-brain-plan.md.

Checklist:
- [ ] Read the current implementations and relevant completed feature records before proposing changes.
- [ ] Create temporary fixture plans for multiple handoffs, long pauses, nested returns, global priorities, context loss and duplicate work creation.
- [ ] Exercise core plus real MCP/Pi/server paths where supported; record loaded versions, fixtures and content fingerprints.
- [ ] Classify each result as reproduced failure, already resolved behavior, incomplete evidence or uncovered harness path.
- [ ] Verify: All six reports have a reproducible scenario or an explicit evidence gap.
- [ ] Verify: Fixtures never write to another real project or its planner.
- [ ] Verify: Existing atomic claims and explicit recovery remain covered.

#### A2. Define one shared next-work and context contract

Outcome: Shared domain inputs, outputs and acceptance cases for scheduling, return precedence, context validity and explicit uncertainty.

Existing state: Selection, recap, lifecycle messages and skill instructions still have separate logic and conflicting read-order guidance. A historical session timestamp is not proof that model context survived compaction.

Implementation responsibility:
- Specify active owned work, actionable pending returns, then globally ready feature → phase → task precedence.
- Define readiness against dependency, parked-state, ownership and explicit-user-selection rules.
- Specify context delivery versus attestation versus conformity evidence; preserve typed non-success results.
- Define shared result shapes used by MCP, Pi, server and UI and map every baseline scenario to an owner.

Acceptance and evidence:
- There is one explainable precedence rule with zero-priority and tie cases.
- No current-phase preference silently overrides a higher global priority.
- The contract does not change the existing warning-only no-task guard.

Read before editing:
- packages/plan-core/src/task-selection.ts:283 — export function recommendNextTask
- packages/plan-core/src/task-context.ts:175 — export function buildPhaseContextBlock
- packages/plan-core/src/project-context.ts:357 — export function buildProjectContextLoadReply
- packages/plan-core/src/read-tracking.ts:28 — type ReadState
- packages/plan-core/src/guard-decision.ts:312 — export function noTaskWarning
- packages/plan-core/src/api-v1.ts:343 — export function buildApiV1Model
These module/symbol references and line positions were inspected at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231; revalidate against the current checkout. New module names/provider/storage details remain implementation choices to resolve in the owning task, not claims of existing code.

Preserve: canonical IDs, decision ownership, phase-scoped handoffs, atomic task/session ownership, derived parent statuses and the accepted warning-only no-task guard. Follow the existing project Guidelines and record relevant source precedents and conformity evidence on this task. Do not create new tasks for the checklist steps.

Plan dependencies: A1. Product requirement coverage: BR01, BR02, BR03, BR04, BR05, BR06, BR16. Supporting design: .planner/docs/agent-brain-plan.md.

Checklist:
- [ ] Specify active owned work, actionable pending returns, then globally ready feature → phase → task precedence.
- [ ] Define readiness against dependency, parked-state, ownership and explicit-user-selection rules.
- [ ] Specify context delivery versus attestation versus conformity evidence; preserve typed non-success results.
- [ ] Define shared result shapes used by MCP, Pi, server and UI and map every baseline scenario to an owner.
- [ ] Verify: There is one explainable precedence rule with zero-priority and tie cases.
- [ ] Verify: No current-phase preference silently overrides a higher global priority.
- [ ] Verify: The contract does not change the existing warning-only no-task guard.

### B. Deterministic priorities and reliable returns

Make next-work recommendations and interrupted-work resumption agree across all surfaces.

Goals:
- Apply the agreed global hierarchy and preserve nested returns through task and phase completion.
- Preserve atomic session ownership and intentional parked/block/defer distinctions.

Out of scope:
- No automatic start of blocked work.
- No implicit recovery of a live or unverified caller.

Risks:
- Phase rollups can accidentally bypass pending returns.
- A parked status and a resumable checkpoint are different signals.

#### B1. Unify ready-work selection and recommendation explanations

Outcome: A shared core evaluation returning the candidate and reasons for selecting or excluding work, consumed consistently by agents and the existing UI.

Existing state: Priority fields and recommendation helpers exist; recap, focus and adapters can still diverge or prefer current-phase continuity.

Implementation responsibility:
- Implement the agreed hierarchy after active work and pending returns.
- Handle dependencies, ownership, priority zero, ties, derived parent statuses and explicit user choices.
- Replace independent selection in recap, completion and adapter/UI focus paths with the shared result.
- Add focused parity tests against the same snapshot and caller identity.

Acceptance and evidence:
- Core/MCP/Pi/server/UI agree on candidate or explain why none is available.
- A ready task in a higher-priority feature wins over current-phase continuity.
- Foreign ownership never produces successful start or an actionable personal return.

Read before editing:
- packages/plan-core/src/task-selection.ts:283 — export function recommendNextTask
- packages/plan-core/src/recap.ts:46 — export async function buildRecap
- packages/plan-core/src/session-focus.ts:1 — (module)
- packages/plan-mcp/src/index.ts:2263 — server.registerTool("planner-task-start"
- packages/pi-adapter/src/index.ts:1385 — async function scanCodebase
- packages/plan-server/src/serve.ts:1 — (module)
- packages/plan-web-ui/src/components/dashboard/work-tree.tsx:1 — (module)
These module/symbol references and line positions were inspected at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231; revalidate against the current checkout. New module names/provider/storage details remain implementation choices to resolve in the owning task, not claims of existing code.

Preserve: canonical IDs, decision ownership, phase-scoped handoffs, atomic task/session ownership, derived parent statuses and the accepted warning-only no-task guard. Follow the existing project Guidelines and record relevant source precedents and conformity evidence on this task. Do not create new tasks for the checklist steps.

Plan dependencies: A2. Product requirement coverage: BR01, BR02, BR03, BR15, BR16. Supporting design: .planner/docs/agent-brain-plan.md.

Checklist:
- [ ] Implement the agreed hierarchy after active work and pending returns.
- [ ] Handle dependencies, ownership, priority zero, ties, derived parent statuses and explicit user choices.
- [ ] Replace independent selection in recap, completion and adapter/UI focus paths with the shared result.
- [ ] Add focused parity tests against the same snapshot and caller identity.
- [ ] Verify: Core/MCP/Pi/server/UI agree on candidate or explain why none is available.
- [ ] Verify: A ready task in a higher-priority feature wins over current-phase continuity.
- [ ] Verify: Foreign ownership never produces successful start or an actionable personal return.

#### B2. Preserve and resume nested interrupted work across phase closure

Outcome: A durable, caller-scoped return chain that remains visible and actionable after temporary work and phase completion, interruption and recovery.

Existing state: Pause snapshots, pause history, work deviations and per-session focus already exist. The reported issue concerns reliable return and selection, not introducing another parked-work system.

Implementation responsibility:
- Exercise A → B → C and unwind C → B → A, including completion of the temporary phase.
- Reconcile parked-state eligibility with F024 and remove fixed digit limits from reference recognition in parked-work reasons; reuse the common variable-width reference grammar without partial-number matches.
- Keep blocked, waiting, deferred and deliberate cancellation distinct; retain pending return when it cannot run.
- Verify persisted focus and recovery after process restart, while preserving other sessions.
- Expose reason and return chain in existing task/focus UI and shared recommendations.

Acceptance and evidence:
- No return target is silently lost when a phase completes.
- Unready work remains parked with an explicit reason; references at and beyond 999/1000 and 9999/10000 resolve to the complete correct identity in reasons and return handling.
- Recovery transfers only explicitly recoverable stopped callers and retains complete checkpoints.

Read before editing:
- packages/plan-core/src/task-selection.ts:283 — export function recommendNextTask
- packages/plan-core/src/on-hold.ts:1 — (module)
- packages/plan-core/src/session-focus.ts:1 — (module)
- packages/plan-core/src/plan-store.ts:3502 — async claimTask
- packages/plan-mcp/src/index.ts:2263 — server.registerTool("planner-task-start"
- packages/pi-adapter/src/index.ts:1385 — async function scanCodebase
- packages/plan-server/src/serve.ts:1 — (module)
- packages/plan-web-ui/src/routes/task-detail/route.tsx:1 — (module)
These module/symbol references and line positions were inspected at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231; revalidate against the current checkout. New module names/provider/storage details remain implementation choices to resolve in the owning task, not claims of existing code.

Preserve: canonical IDs, decision ownership, phase-scoped handoffs, atomic task/session ownership, derived parent statuses and the accepted warning-only no-task guard. Follow the existing project Guidelines and record relevant source precedents and conformity evidence on this task. Do not create new tasks for the checklist steps.

Plan dependencies: B1. Product requirement coverage: BR01, BR02, BR03, BR15, BR16. Supporting design: .planner/docs/agent-brain-plan.md.

Checklist:
- [ ] Exercise A → B → C and unwind C → B → A, including completion of the temporary phase.
- [ ] Reconcile parked-state eligibility with F024 and remove fixed digit limits from reference recognition in parked-work reasons; reuse the common variable-width reference grammar without partial-number matches.
- [ ] Keep blocked, waiting, deferred and deliberate cancellation distinct; retain pending return when it cannot run.
- [ ] Verify persisted focus and recovery after process restart, while preserving other sessions.
- [ ] Expose reason and return chain in existing task/focus UI and shared recommendations.
- [ ] Verify: No return target is silently lost when a phase completes.
- [ ] Verify: Unready work remains parked with an explicit reason; references at and beyond 999/1000 and 9999/10000 resolve to the complete correct identity in reasons and return handling.
- [ ] Verify: Recovery transfers only explicitly recoverable stopped callers and retains complete checkpoints.

### C. Useful orientation and efficient context restoration

Explain where to resume and deliver complete required context without avoidable repetition.

Goals:
- Make multiple handoffs understandable after a long absence.
- Restore necessary context across sessions, compaction, task switches and source changes.

Out of scope:
- Do not load every handoff body for a recap.
- Do not promise complete codebase understanding or a token reduction percentage.

Risks:
- Transport truncation can be mistaken for a full read.
- A retained session ID can survive loss of the model context.

#### C1. Replace handoff choice lists with an actionable resume overview

Outcome: A bounded overview of purpose, current/partial state, remaining work, blockers, return obligations and a recommendation justified by the shared selector.

Existing state: Recap already lists phase handoffs and phase work, but references and first lines often do not explain what a returning user should resume.

Implementation responsibility:
- Use phase-scoped handoff metadata and canonical current task state to build a compact orientation.
- Show feature/phase names and intent, not only identifiers and dates.
- Distinguish operational resume-ready handoffs from stale or terminal history.
- Use the same explanation in MCP/Pi recap and the existing supervisor UI; preserve explicit dashboard activation.

Acceptance and evidence:
- A returning user can understand several alternatives without remembering old task numbers.
- Dates and prose do not independently create priority or actionable resume claims.
- The proposed next work matches B1/B2.

Read before editing:
- packages/plan-core/src/recap.ts:46 — export async function buildRecap
- packages/plan-core/src/handoff-context.ts:1 — (module)
- packages/plan-core/src/task-selection.ts:283 — export function recommendNextTask
- packages/plan-mcp/src/index.ts:2263 — server.registerTool("planner-task-start"
- packages/pi-adapter/src/index.ts:1385 — async function scanCodebase
- packages/plan-web-ui/src/components/dashboard/work-tree-rows.tsx:1 — (module)
These module/symbol references and line positions were inspected at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231; revalidate against the current checkout. New module names/provider/storage details remain implementation choices to resolve in the owning task, not claims of existing code.

Preserve: canonical IDs, decision ownership, phase-scoped handoffs, atomic task/session ownership, derived parent statuses and the accepted warning-only no-task guard. Follow the existing project Guidelines and record relevant source precedents and conformity evidence on this task. Do not create new tasks for the checklist steps.

Plan dependencies: B2. Product requirement coverage: BR01, BR03, BR04, BR13, BR14, BR15, BR16. Supporting design: .planner/docs/agent-brain-plan.md.

Checklist:
- [ ] Use phase-scoped handoff metadata and canonical current task state to build a compact orientation.
- [ ] Show feature/phase names and intent, not only identifiers and dates.
- [ ] Distinguish operational resume-ready handoffs from stale or terminal history.
- [ ] Use the same explanation in MCP/Pi recap and the existing supervisor UI; preserve explicit dashboard activation.
- [ ] Verify: A returning user can understand several alternatives without remembering old task numbers.
- [ ] Verify: Dates and prose do not independently create priority or actionable resume claims.
- [ ] Verify: The proposed next work matches B1/B2.

#### C2. Coordinate complete context delivery and freshness-aware reuse

Outcome: A coordinated context protocol that restores mandatory rules, requirements and decisions, reuses genuinely available unchanged content, and reports incomplete delivery.

Existing state: Project context delivery, full-read attestations and phase/task context already exist, with overlapping payloads and contradictory instructions across surfaces.

Implementation responsibility:
- Measure actual bytes/characters and tokens separately on equivalent resume scenarios.
- Reconcile skill, core rules, tool descriptions and injected prompts around one read-before-work protocol.
- Refresh context after supported compaction/reset events; provide an explicit restoration path for harnesses without those events.
- Invalidate only affected reads when source revisions change and distinguish delivery from understanding.
- Preserve bounded transport, explicit continuation and typed incomplete/non-success results.

Acceptance and evidence:
- No required rule, requirement or decision is silently omitted to meet a budget.
- Persistent attestations alone never prove retained model context.
- Equivalent scenarios demonstrate avoided duplication without an unverified performance promise.

Read before editing:
- packages/plan-core/src/project-context.ts:357 — export function buildProjectContextLoadReply
- packages/plan-core/src/task-context.ts:175 — export function buildPhaseContextBlock
- packages/plan-core/src/read-tracking.ts:28 — type ReadState
- packages/plan-core/src/planner-rules.ts:20 — const PROJECT_GUIDELINES_RULE
- packages/plan-core/planner-skill.md:42 — ## Lifecycle-first context protocol
- packages/plan-mcp/src/index.ts:2263 — server.registerTool("planner-task-start"
- packages/pi-adapter/src/index.ts:1385 — async function scanCodebase
- scripts/sync-plugins.cjs:1 — (module)
These module/symbol references and line positions were inspected at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231; revalidate against the current checkout. New module names/provider/storage details remain implementation choices to resolve in the owning task, not claims of existing code.

Preserve: canonical IDs, decision ownership, phase-scoped handoffs, atomic task/session ownership, derived parent statuses and the accepted warning-only no-task guard. Follow the existing project Guidelines and record relevant source precedents and conformity evidence on this task. Do not create new tasks for the checklist steps.

Plan dependencies: C1. Product requirement coverage: BR01, BR03, BR04, BR13, BR14, BR15, BR16. Supporting design: .planner/docs/agent-brain-plan.md.

Checklist:
- [ ] Measure actual bytes/characters and tokens separately on equivalent resume scenarios.
- [ ] Reconcile skill, core rules, tool descriptions and injected prompts around one read-before-work protocol.
- [ ] Refresh context after supported compaction/reset events; provide an explicit restoration path for harnesses without those events.
- [ ] Invalidate only affected reads when source revisions change and distinguish delivery from understanding.
- [ ] Preserve bounded transport, explicit continuation and typed incomplete/non-success results.
- [ ] Verify: No required rule, requirement or decision is silently omitted to meet a budget.
- [ ] Verify: Persistent attestations alone never prove retained model context.
- [ ] Verify: Equivalent scenarios demonstrate avoided duplication without an unverified performance promise.

### D. Application of existing standards and planning discipline

Make existing instructions actionable and reviewable before and after implementation.

Goals:
- Require relevant source analysis and conformity evidence without duplicating existing guidelines.
- Distribute a consistent protocol across supported agents and limit unnecessary task creation.

Out of scope:
- No implicit change to the warning-only no-task guard.
- No blind import of Claude-specific rules or arbitrary numerical definitions of slim.

Risks:
- A checked box or a file path does not prove content delivery or conformity.
- Legacy code may conflict with current approved instructions.

Open choices:
- Select the supported analysis-evidence operations and their coverage; a new write-denial policy remains an explicit decision, not an assumed requirement.

#### D1. Add evidence-backed source analysis and conformity review to existing workflow

Outcome: An auditable pre-implementation analysis and post-implementation conformity report on the existing task, usable without semantic providers.

Existing state: The skill and guidelines already require context and coding standards. Read tracking covers planner entities rather than analogous source implementations; completion checks checklist/evidence rather than architectural conformity.

Implementation responsibility:
- Select and deliver applicable rules, approved decisions, module responsibilities and genuinely analogous implementations/tests.
- Record source revisions, pertinence, inferred versus explicit conventions, intended reuse, integration and verification on the current task.
- Detect missing/stale evidence on supported paths; document interception limits and preserve the accepted warning-only guard.
- Refresh relevant evidence on area/source/context changes; do not demand an unchanged full rescan.
- Compare final diff with selected precedents and rules; automate checkable constraints and record qualitative review separately.

Acceptance and evidence:
- A new agent produces a component consistent with the correct architectural precedents.
- A functionally passing implementation with duplicated infrastructure or wrong responsibility fails the conformity review.
- Legacy conflicts and greenfield projects are explicit; no fabricated standards or false proof of understanding.
- No extra permission prompt is introduced for already authorized routine work.

Read before editing:
- packages/plan-core/src/read-tracking.ts:28 — type ReadState
- packages/plan-core/planner-skill.md:42 — ## Lifecycle-first context protocol
- packages/plan-core/src/planner-rules.ts:20 — const PROJECT_GUIDELINES_RULE
- packages/plan-core/src/guard-decision.ts:312 — export function noTaskWarning
- packages/plan-core/src/task-completion-gate.ts:58 — export function evaluateTaskCompletionGate
- packages/plan-core/src/task-context.ts:175 — export function buildPhaseContextBlock
- packages/plan-mcp/src/index.ts:2263 — server.registerTool("planner-task-start"
- packages/pi-adapter/src/index.ts:1385 — async function scanCodebase
These module/symbol references and line positions were inspected at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231; revalidate against the current checkout. New module names/provider/storage details remain implementation choices to resolve in the owning task, not claims of existing code.

Preserve: canonical IDs, decision ownership, phase-scoped handoffs, atomic task/session ownership, derived parent statuses and the accepted warning-only no-task guard. Follow the existing project Guidelines and record relevant source precedents and conformity evidence on this task. Do not create new tasks for the checklist steps.

Plan dependencies: C2. Product requirement coverage: BR04, BR05, BR06, BR13, BR15, BR16, BR17. Supporting design: .planner/docs/agent-brain-plan.md.

Checklist:
- [ ] Select and deliver applicable rules, approved decisions, module responsibilities and genuinely analogous implementations/tests.
- [ ] Record source revisions, pertinence, inferred versus explicit conventions, intended reuse, integration and verification on the current task.
- [ ] Detect missing/stale evidence on supported paths; document interception limits and preserve the accepted warning-only guard.
- [ ] Refresh relevant evidence on area/source/context changes; do not demand an unchanged full rescan.
- [ ] Compare final diff with selected precedents and rules; automate checkable constraints and record qualitative review separately.
- [ ] Verify: A new agent produces a component consistent with the correct architectural precedents.
- [ ] Verify: A functionally passing implementation with duplicated infrastructure or wrong responsibility fails the conformity review.
- [ ] Verify: Legacy conflicts and greenfield projects are explicit; no fabricated standards or false proof of understanding.
- [ ] Verify: No extra permission prompt is introduced for already authorized routine work.

#### D2. Synchronize the operating protocol across harnesses and context-loss events

Outcome: One portable operational protocol with explicit adapter capabilities, renewed context and consistent instruction delivery.

Existing state: The canonical core skill is already distributed to shared and harness-specific surfaces. Existing prompt/rule/tool wording disagrees and external Everything Claude Code material is primarily harness-specific.

Implementation responsibility:
- Extend the existing canonical skill and sync pipeline; keep domain policy in core.
- Adapt useful skill/rule/hook separation from the referenced external project while filtering conflicting recommendations.
- Integrate D1 evidence with supported MCP/Pi and Claude Code/Codex/OpenCode routes; distinguish guidance, observed reads and actual interception.
- Exercise new session, compaction, changed guidelines and harness switch without claiming unsupported hook coverage.

Acceptance and evidence:
- Generated skill copies and tool descriptions express one consistent workflow.
- Every supported harness has a documented tested coverage level and explicit fallback.
- Loss of model context leads to restoration rather than reuse of a historical timestamp alone.

Read before editing:
- packages/plan-core/planner-skill.md:42 — ## Lifecycle-first context protocol
- packages/plan-core/src/planner-rules.ts:20 — const PROJECT_GUIDELINES_RULE
- scripts/sync-plugins.cjs:1 — (module)
- packages/plan-mcp/src/index.ts:2263 — server.registerTool("planner-task-start"
- packages/pi-adapter/src/index.ts:1385 — async function scanCodebase
- packages/plan-core/src/project-context.ts:357 — export function buildProjectContextLoadReply
- packages/plan-core/src/guard-decision.ts:312 — export function noTaskWarning
These module/symbol references and line positions were inspected at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231; revalidate against the current checkout. New module names/provider/storage details remain implementation choices to resolve in the owning task, not claims of existing code.

Preserve: canonical IDs, decision ownership, phase-scoped handoffs, atomic task/session ownership, derived parent statuses and the accepted warning-only no-task guard. Follow the existing project Guidelines and record relevant source precedents and conformity evidence on this task. Do not create new tasks for the checklist steps.

Plan dependencies: D1. Product requirement coverage: BR04, BR05, BR06, BR13, BR15, BR16, BR17. Supporting design: .planner/docs/agent-brain-plan.md.

Checklist:
- [ ] Extend the existing canonical skill and sync pipeline; keep domain policy in core.
- [ ] Adapt useful skill/rule/hook separation from the referenced external project while filtering conflicting recommendations.
- [ ] Integrate D1 evidence with supported MCP/Pi and Claude Code/Codex/OpenCode routes; distinguish guidance, observed reads and actual interception.
- [ ] Exercise new session, compaction, changed guidelines and harness switch without claiming unsupported hook coverage.
- [ ] Verify: Generated skill copies and tool descriptions express one consistent workflow.
- [ ] Verify: Every supported harness has a documented tested coverage level and explicit fallback.
- [ ] Verify: Loss of model context leads to restoration rather than reuse of a historical timestamp alone.

#### D3. Prevent duplicate capability ownership and unnecessary task creation

Outcome: A creation workflow that surfaces existing open/completed ownership and keeps implementation steps within the current task.

Existing state: The skill and phase work map already advise checklist reuse and sibling review; new tasks can still be created without an evidence-backed comparison.

Implementation responsibility:
- Compare requested outcome against relevant canonical tasks, including completed capabilities and cross-phase candidates.
- Use similarity as a discovery hint, never an automatic proof or destructive deduplication.
- Require a distinct outcome and rationale for a new task; otherwise update current checklist/description or capture an out-of-scope idea.
- Keep initialization and legitimate large-feature planning possible; show useful ownership information in current UI.

Acceptance and evidence:
- Already owned work reuses its owner; an implementation detail becomes a checklist item.
- Independent outcomes can still create justified tasks.
- No arbitrary task-count cap, automatic merges/deletions or one-task-per-stale-link behavior.

Read before editing:
- packages/plan-core/src/task-context.ts:175 — export function buildPhaseContextBlock
- packages/plan-core/src/schema.ts:85 — export const AcceptedDecisionSchema
- packages/plan-mcp/src/index.ts:2263 — server.registerTool("planner-task-start"
- packages/pi-adapter/src/index.ts:1385 — async function scanCodebase
- packages/plan-web-ui/src/components/dashboard/work-tree-rows.tsx:1 — (module)
These module/symbol references and line positions were inspected at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231; revalidate against the current checkout. New module names/provider/storage details remain implementation choices to resolve in the owning task, not claims of existing code.

Preserve: canonical IDs, decision ownership, phase-scoped handoffs, atomic task/session ownership, derived parent statuses and the accepted warning-only no-task guard. Follow the existing project Guidelines and record relevant source precedents and conformity evidence on this task. Do not create new tasks for the checklist steps.

Plan dependencies: D2. Product requirement coverage: BR04, BR05, BR06, BR13, BR15, BR16, BR17. Supporting design: .planner/docs/agent-brain-plan.md.

Checklist:
- [ ] Compare requested outcome against relevant canonical tasks, including completed capabilities and cross-phase candidates.
- [ ] Use similarity as a discovery hint, never an automatic proof or destructive deduplication.
- [ ] Require a distinct outcome and rationale for a new task; otherwise update current checklist/description or capture an out-of-scope idea.
- [ ] Keep initialization and legitimate large-feature planning possible; show useful ownership information in current UI.
- [ ] Verify: Already owned work reuses its owner; an implementation detail becomes a checklist item.
- [ ] Verify: Independent outcomes can still create justified tasks.
- [ ] Verify: No arbitrary task-count cap, automatic merges/deletions or one-task-per-stale-link behavior.

### E. Code links, task changesets and decision history

Connect existing planner knowledge to code with current resolution and recoverable historical evidence.

Goals:
- Implement language-independent link, baseline, resolution and changeset contracts.
- Preserve scoped rationale across unrelated tasks and large implementations.

Out of scope:
- No file:line identity, automatic semantic-continuity claim or per-function manual journal.
- No rewriting approved decisions to match a drifting implementation.

Risks:
- Symbol names/provider IDs change during refactors.
- Dirty and concurrently edited work cannot always be attributed to one task.
- A hash is not recoverable historical source content.

Open choices:
- Finalize canonical persistence layout and migration version within existing runtime boundaries.

#### E1. Implement snapshot-bound code links and safe reference resolution

Outcome: Canonical links and recoverable historical anchors, separate from rebuildable per-checkout resolutions and review state.

Existing state: Current task descriptions contain prose code references; there is no typed link to a module/symbol with recoverable baseline and snapshot-bound current resolution. The earlier 11-case TypeScript experiment is not production implementation.

Implementation responsibility:
- Add validated links from existing entity/decision IDs to module, file, region or symbol anchors with provenance.
- Define snapshot identity including dirty content, relevant configuration and repository/worktree identity.
- Implement text/file fallback first and provider-independent resolution states: resolved, changed, candidate, ambiguous, absent, unknown/stale.
- Treat external rename/move as candidates requiring verified continuity; preserve uncertainty for parse/provider failures.
- Migrate legacy prose references only as unverified candidates; maintain compatibility and granular atomic mutation.

Acceptance and evidence:
- Line shifts preserve destinations; rename, copy, deletion and homonyms never silently retarget a decision.
- Current location and semantic/prose review status remain separate.
- Baseline source can actually be retrieved; stale or foreign-worktree indexes cannot assert current results.

Read before editing:
- packages/plan-core/src/schema.ts:85 — export const AcceptedDecisionSchema
- packages/plan-core/src/plan-store.ts:3399 — async createAcceptedDecision
- packages/plan-core/src/description-freshness.ts:1 — (module)
- packages/plan-core/docs/runtime-boundaries.md:1 — (module)
- packages/plan-mcp/src/index.ts:2263 — server.registerTool("planner-task-start"
- packages/pi-adapter/src/index.ts:1385 — async function scanCodebase
- packages/plan-server/src/serve.ts:1 — (module)
These module/symbol references and line positions were inspected at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231; revalidate against the current checkout. New module names/provider/storage details remain implementation choices to resolve in the owning task, not claims of existing code.

Preserve: canonical IDs, decision ownership, phase-scoped handoffs, atomic task/session ownership, derived parent statuses and the accepted warning-only no-task guard. Follow the existing project Guidelines and record relevant source precedents and conformity evidence on this task. Do not create new tasks for the checklist steps.

Plan dependencies: D3. Product requirement coverage: BR07, BR08, BR09, BR11, BR12, BR14, BR16, BR17. Supporting design: .planner/docs/agent-brain-plan.md.

Checklist:
- [ ] Add validated links from existing entity/decision IDs to module, file, region or symbol anchors with provenance.
- [ ] Define snapshot identity including dirty content, relevant configuration and repository/worktree identity.
- [ ] Implement text/file fallback first and provider-independent resolution states: resolved, changed, candidate, ambiguous, absent, unknown/stale.
- [ ] Treat external rename/move as candidates requiring verified continuity; preserve uncertainty for parse/provider failures.
- [ ] Migrate legacy prose references only as unverified candidates; maintain compatibility and granular atomic mutation.
- [ ] Verify: Line shifts preserve destinations; rename, copy, deletion and homonyms never silently retarget a decision.
- [ ] Verify: Current location and semantic/prose review status remain separate.
- [ ] Verify: Baseline source can actually be retrieved; stale or foreign-worktree indexes cannot assert current results.

#### E2. Capture large-task changesets and scoped code ownership

Outcome: Automatic task/session changeset capture at baseline, checkpoints and closeout, with module-level summaries and explicit uncertain attribution.

Existing state: Tasks can describe large developments across many files. File differences reveal modifications but not necessarily task attribution or rationale.

Implementation responsibility:
- Capture initial dirty state separately from changes introduced during the task.
- Associate observed before/after changes with the owning session/task and affected modules; derive symbol involvement when providers exist.
- Preserve checkpoints across interruption and collect significant rationale without requiring a note for every line/function.
- Handle overlapping sessions/shared worktrees explicitly; use isolation or observed writes where available and mark ambiguous attribution.
- Maintain task ↔ changed-code relations so later tasks can discover prior work without task-to-task links.

Acceptance and evidence:
- A large task with new and modified modules is traceable without manual per-symbol annotation.
- Pre-existing dirty or foreign changes are not automatically assigned to the current task.
- Missing observation or attribution is visible instead of replaced by a fabricated history.

Read before editing:
- packages/plan-core/src/schema.ts:85 — export const AcceptedDecisionSchema
- packages/plan-core/src/plan-store.ts:3399 — async createAcceptedDecision
- packages/plan-core/src/session-focus.ts:1 — (module)
- packages/plan-core/src/plan-store.ts:3502 — async claimTask
- packages/plan-core/docs/runtime-boundaries.md:1 — (module)
- packages/plan-mcp/src/index.ts:2263 — server.registerTool("planner-task-start"
- packages/pi-adapter/src/index.ts:1385 — async function scanCodebase
These module/symbol references and line positions were inspected at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231; revalidate against the current checkout. New module names/provider/storage details remain implementation choices to resolve in the owning task, not claims of existing code.

Preserve: canonical IDs, decision ownership, phase-scoped handoffs, atomic task/session ownership, derived parent statuses and the accepted warning-only no-task guard. Follow the existing project Guidelines and record relevant source precedents and conformity evidence on this task. Do not create new tasks for the checklist steps.

Plan dependencies: E1. Product requirement coverage: BR07, BR08, BR09, BR11, BR12, BR14, BR16, BR17. Supporting design: .planner/docs/agent-brain-plan.md.

Checklist:
- [ ] Capture initial dirty state separately from changes introduced during the task.
- [ ] Associate observed before/after changes with the owning session/task and affected modules; derive symbol involvement when providers exist.
- [ ] Preserve checkpoints across interruption and collect significant rationale without requiring a note for every line/function.
- [ ] Handle overlapping sessions/shared worktrees explicitly; use isolation or observed writes where available and mark ambiguous attribution.
- [ ] Maintain task ↔ changed-code relations so later tasks can discover prior work without task-to-task links.
- [ ] Verify: A large task with new and modified modules is traceable without manual per-symbol annotation.
- [ ] Verify: Pre-existing dirty or foreign changes are not automatically assigned to the current task.
- [ ] Verify: Missing observation or attribution is visible instead of replaced by a fabricated history.

#### E3. Version durable decisions and resolve their applicability to code

Outcome: Versioned canonical decision history and explicit code applicability, with origins and supersession distinct from the current implementation.

Existing state: Accepted Decisions have single-owner CRUD and project/feature/phase/task scope, but updates replace fields in place and there is no code-scope applicability/history lookup.

Implementation responsibility:
- Extend existing Accepted Decisions rather than introducing another decision authority; preserve old IDs and approved content.
- Record revisions, provenance, valid applicability and explicit replacement/exception relationships with granular atomic operations.
- Keep project coding standards in Guidelines; link function/module-specific architectural decisions to a durable existing owner.
- Implement the T002 → T010 → T020 scenario across unrelated phases: prior parameter rationale, current signature and active slim/functional constraints.
- Provide cautious legacy backfill from recorded tasks/handoffs/Git as candidates; never infer missing user intent as fact.

Acceptance and evidence:
- Task completion or phase closure does not hide applicable durable decisions.
- A newer task or changed body does not implicitly supersede a decision.
- Current and historical explanations are distinguishable and source changes invalidate prior review evidence.

Read before editing:
- packages/plan-core/src/schema.ts:85 — export const AcceptedDecisionSchema
- packages/plan-core/src/plan-store.ts:3399 — async createAcceptedDecision
- packages/plan-core/src/task-context.ts:175 — export function buildPhaseContextBlock
- packages/plan-core/src/project-context.ts:357 — export function buildProjectContextLoadReply
- packages/plan-core/src/description-freshness.ts:1 — (module)
- packages/plan-mcp/src/index.ts:2263 — server.registerTool("planner-task-start"
- packages/pi-adapter/src/index.ts:1385 — async function scanCodebase
These module/symbol references and line positions were inspected at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231; revalidate against the current checkout. New module names/provider/storage details remain implementation choices to resolve in the owning task, not claims of existing code.

Preserve: canonical IDs, decision ownership, phase-scoped handoffs, atomic task/session ownership, derived parent statuses and the accepted warning-only no-task guard. Follow the existing project Guidelines and record relevant source precedents and conformity evidence on this task. Do not create new tasks for the checklist steps.

Plan dependencies: E2. Product requirement coverage: BR07, BR08, BR09, BR11, BR12, BR14, BR16, BR17. Supporting design: .planner/docs/agent-brain-plan.md.

Checklist:
- [ ] Extend existing Accepted Decisions rather than introducing another decision authority; preserve old IDs and approved content.
- [ ] Record revisions, provenance, valid applicability and explicit replacement/exception relationships with granular atomic operations.
- [ ] Keep project coding standards in Guidelines; link function/module-specific architectural decisions to a durable existing owner.
- [ ] Implement the T002 → T010 → T020 scenario across unrelated phases: prior parameter rationale, current signature and active slim/functional constraints.
- [ ] Provide cautious legacy backfill from recorded tasks/handoffs/Git as candidates; never infer missing user intent as fact.
- [ ] Verify: Task completion or phase closure does not hide applicable durable decisions.
- [ ] Verify: A newer task or changed body does not implicitly supersede a decision.
- [ ] Verify: Current and historical explanations are distinguishable and source changes invalidate prior review evidence.

### F. Project setup and multilingual code intelligence

Start from an idea or existing repository and dynamically resolve, configure and validate compatible analysis providers for its actual languages.

Goals:
- Support empty folders and undecided stacks.
- Support an open, provider-driven language set through extensible metadata/configuration and shared adapters, with per-area/per-operation coverage made explicit.

Out of scope:
- No universal TypeScript compiler analysis.
- No mandatory installation of Tree-sitter, LSP servers and every SCIP indexer together.
- No closed list of project languages or automatic claim that every tool/provider is discoverable, installable or verified.

Risks:
- IDE-installed servers may not be accessible as compatible executables.
- Build flags, classpaths, Cargo features and generated sources change analysis coverage.

Open choices:
- Select extensible provider manifest/registry format, initial tested entries, versions/platform support and preparation/update policy after reproducible probes; fixture languages do not limit product eligibility.
- Validate SCIP ingestion versus native provider APIs; LSP and syntax parsing remain optional complementary capabilities.

#### F1. Implement capability-based setup for empty and existing projects

Outcome: A shared setup manager using declared stack decisions and detected actual configuration, with reusable managed tools and clear readiness states.

Existing state: The current init initializes the planner and setup connects a harness. Neither orchestrates multilingual code-analysis tools.

Implementation responsibility:
- Keep an empty project in stack-undecided or stack-declared state; allow planning without code.
- Read technologies/tools and accepted stack decisions, then compare manifests when they exist.
- Implement an extensible versioned provider catalog and configured-provider entries, match the declared/detected stack, and produce a concrete reuse/preparation/configuration plan with compatibility probes.
- Separate shared desired configuration, local executable paths/tool caches and per-checkout indexes; do not inject analyzer dependencies into the user application.
- Select only requested capabilities from compatible providers; preserve planner/text fallback and explain missing prerequisites, unsupported operations and usable results rather than binary presence.

Acceptance and evidence:
- Idea → stack discussion → scaffold/configuration → analysis activation works without guessing a language.
- One shared project configuration resolves compatible providers locally across agents/machines; adding a language to an existing adapter needs provider metadata/configuration rather than a planner-core code change.
- Unavailable analysis never blocks planning and is never reported as zero references.

Read before editing:
- packages/agent-plan/src/index.ts:1 — (module)
- packages/plan-core/src/schema.ts:85 — export const AcceptedDecisionSchema
- packages/pi-adapter/src/index.ts:1385 — async function scanCodebase
- packages/plan-core/docs/runtime-boundaries.md:1 — (module)
- packages/plan-mcp/src/index.ts:2263 — server.registerTool("planner-task-start"
- packages/plan-server/src/serve.ts:1 — (module)
These module/symbol references and line positions were inspected at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231; revalidate against the current checkout. New module names/provider/storage details remain implementation choices to resolve in the owning task, not claims of existing code.

Preserve: canonical IDs, decision ownership, phase-scoped handoffs, atomic task/session ownership, derived parent statuses and the accepted warning-only no-task guard. Follow the existing project Guidelines and record relevant source precedents and conformity evidence on this task. Do not create new tasks for the checklist steps.

Plan dependencies: E3. Product requirement coverage: BR07, BR10, BR11, BR13, BR14, BR16. Supporting design: .planner/docs/agent-brain-plan.md.

Checklist:
- [ ] Keep an empty project in stack-undecided or stack-declared state; allow planning without code.
- [ ] Read technologies/tools and accepted stack decisions, then compare manifests when they exist.
- [ ] Implement an extensible versioned provider catalog and configured-provider entries, match the declared/detected stack, and produce a concrete reuse/preparation/configuration plan with compatibility probes.
- [ ] Separate shared desired configuration, local executable paths/tool caches and per-checkout indexes; do not inject analyzer dependencies into the user application.
- [ ] Select only requested capabilities from compatible providers; preserve planner/text fallback and explain missing prerequisites, unsupported operations and usable results rather than binary presence.
- [ ] Verify: Idea → stack discussion → scaffold/configuration → analysis activation works without guessing a language.
- [ ] Verify: One shared project configuration resolves compatible providers locally across agents/machines; adding a language to an existing adapter needs provider metadata/configuration rather than a planner-core code change.
- [ ] Verify: Unavailable analysis never blocks planning and is never reported as zero references.

#### F2. Discover and configure analysis providers through shared adapters

Outcome: Usable language-independent provider adapters with discovery, configuration and normalized analysis driven by compatible provider metadata and actual capabilities.

Existing state: The previous TypeScript anchor proof is local historical evidence only. SCIP needs a language-aware indexer, LSP a compatible server, and syntax parsing a grammar; none provides universal language discovery or semantic coverage.

Implementation responsibility:
- Implement provider lifecycle, cancellation, diagnostics, capability negotiation and source/configuration fingerprints behind a shared adapter contract.
- Implement compatible SCIP ingestion, LSP queries and optional syntax integration as separate capabilities selected through provider manifests/configuration; do not hardcode a language whitelist in core.
- Normalize origin/version/root, snapshot, coordinate encoding, definitions, occurrences and available relationships without assuming universal stable symbol IDs.
- Resolve a newly configured compatible provider using its metadata and effective workspace/build configuration; verify useful source-backed results before activation.
- Report unsupported operations, incomplete/dynamic/generated/external coverage and configuration failures explicitly; a new protocol can require an adapter but a new language on an existing adapter does not require core changes.

Acceptance and evidence:
- Real tools from at least two unrelated language families pass the same applicable link/query contract; the selected fixture languages are examples, not a product whitelist.
- A compatible provider for an additional language can be registered/configured without modifying planner-core language dispatch; stale tool/configuration/source snapshots are rejected or explicitly refreshed.
- Only verified provider operations are advertised; syntax parsing is not semantic reference resolution, and no provider implies a complete runtime graph or silent refactor continuity.

Read before editing:
- packages/plan-core/src/schema.ts:85 — export const AcceptedDecisionSchema
- packages/plan-core/src/plan-store.ts:3399 — async createAcceptedDecision
- packages/plan-core/docs/runtime-boundaries.md:1 — (module)
- packages/plan-mcp/src/index.ts:2263 — server.registerTool("planner-task-start"
- packages/plan-server/src/serve.ts:1 — (module)
These module/symbol references and line positions were inspected at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231; revalidate against the current checkout. New module names/provider/storage details remain implementation choices to resolve in the owning task, not claims of existing code.

Preserve: canonical IDs, decision ownership, phase-scoped handoffs, atomic task/session ownership, derived parent statuses and the accepted warning-only no-task guard. Follow the existing project Guidelines and record relevant source precedents and conformity evidence on this task. Do not create new tasks for the checklist steps.

Plan dependencies: F1. Product requirement coverage: BR07, BR10, BR11, BR13, BR14, BR16. Supporting design: .planner/docs/agent-brain-plan.md.

Checklist:
- [ ] Implement provider lifecycle, cancellation, diagnostics, capability negotiation and source/configuration fingerprints behind a shared adapter contract.
- [ ] Implement compatible SCIP ingestion, LSP queries and optional syntax integration as separate capabilities selected through provider manifests/configuration; do not hardcode a language whitelist in core.
- [ ] Normalize origin/version/root, snapshot, coordinate encoding, definitions, occurrences and available relationships without assuming universal stable symbol IDs.
- [ ] Resolve a newly configured compatible provider using its metadata and effective workspace/build configuration; verify useful source-backed results before activation.
- [ ] Report unsupported operations, incomplete/dynamic/generated/external coverage and configuration failures explicitly; a new protocol can require an adapter but a new language on an existing adapter does not require core changes.
- [ ] Verify: Real tools from at least two unrelated language families pass the same applicable link/query contract; the selected fixture languages are examples, not a product whitelist.
- [ ] Verify: A compatible provider for an additional language can be registered/configured without modifying planner-core language dispatch; stale tool/configuration/source snapshots are rejected or explicitly refreshed.
- [ ] Verify: Only verified provider operations are advertised; syntax parsing is not semantic reference resolution, and no provider implies a complete runtime graph or silent refactor continuity.

#### F3. Verify dynamic provider coverage and mixed-language boundaries

Outcome: Reproducible provider extensibility and mixed-project coverage, including real configuration requirements, partial support and explicitly unresolved cross-language boundaries.

Existing state: Available operations depend on provider, version and actual project/build configuration. Combining separate language indexes does not establish cross-language runtime relationships.

Implementation responsibility:
- Build diverse real fixture projects chosen by available compatible tools and demonstrate a further language enabled through metadata/configuration rather than planner-core changes.
- Verify provider-specific workspace/build prerequisites, such as compile commands/includes/defines, classpath/JDK or target/features/macros, only where applicable; named languages are examples.
- Exercise absent tools, incompatible versions, missing configuration, unsupported operations and mixed supported/unsupported source areas.
- Keep FFI, JNI, generated-code and network relations declared or inferred with provenance rather than asserting that separate indexes prove those edges.
- Verify capability-specific fallback, configuration/tool changes, local reuse and useful diagnostics on the actual tested platforms; document the evidence instead of claiming all catalog entries have been tested.

Acceptance and evidence:
- Provider support claims identify exact tested tool/version/configuration and source-area coverage; a language outside the initial fixture set is enabled through the existing adapter contract.
- A partly supported repository remains usable with per-area and per-operation coverage; a syntax-only provider never advertises semantic usages.
- Missing providers or build prerequisites yield unknown/incomplete analysis and text/planning fallback, never a false absence of usage or automatic FFI/JNI/service edges.

Read before editing:
- packages/plan-core/src/schema.ts:85 — export const AcceptedDecisionSchema
- packages/plan-core/src/plan-store.ts:3399 — async createAcceptedDecision
- packages/plan-core/docs/runtime-boundaries.md:1 — (module)
- packages/plan-mcp/src/index.ts:2263 — server.registerTool("planner-task-start"
- packages/plan-server/src/serve.ts:1 — (module)
These module/symbol references and line positions were inspected at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231; revalidate against the current checkout. New module names/provider/storage details remain implementation choices to resolve in the owning task, not claims of existing code.

Preserve: canonical IDs, decision ownership, phase-scoped handoffs, atomic task/session ownership, derived parent statuses and the accepted warning-only no-task guard. Follow the existing project Guidelines and record relevant source precedents and conformity evidence on this task. Do not create new tasks for the checklist steps.

Plan dependencies: F2. Product requirement coverage: BR07, BR10, BR11, BR13, BR14, BR16. Supporting design: .planner/docs/agent-brain-plan.md.

Checklist:
- [ ] Build diverse real fixture projects chosen by available compatible tools and demonstrate a further language enabled through metadata/configuration rather than planner-core changes.
- [ ] Verify provider-specific workspace/build prerequisites, such as compile commands/includes/defines, classpath/JDK or target/features/macros, only where applicable; named languages are examples.
- [ ] Exercise absent tools, incompatible versions, missing configuration, unsupported operations and mixed supported/unsupported source areas.
- [ ] Keep FFI, JNI, generated-code and network relations declared or inferred with provenance rather than asserting that separate indexes prove those edges.
- [ ] Verify capability-specific fallback, configuration/tool changes, local reuse and useful diagnostics on the actual tested platforms; document the evidence instead of claiming all catalog entries have been tested.
- [ ] Verify: Provider support claims identify exact tested tool/version/configuration and source-area coverage; a language outside the initial fixture set is enabled through the existing adapter contract.
- [ ] Verify: A partly supported repository remains usable with per-area and per-operation coverage; a syntax-only provider never advertises semantic usages.
- [ ] Verify: Missing providers or build prerequisites yield unknown/incomplete analysis and text/planning fallback, never a false absence of usage or automatic FFI/JNI/service edges.

### G. Unified graph, contextual retrieval and freshness

Make planner and code relationships queryable without replacing canonical entities.

Goals:
- Join requirements, decisions, work history, modules, symbols, usage and verification evidence.
- Deliver a global orientation and task-relevant deep context with explicit coverage and freshness.

Out of scope:
- No promise of complete instant model knowledge.
- No graph database, embedding service or Graphify engine chosen merely by name.

Risks:
- Requirements are absent from the current API v1 projection and change-event model.
- Text similarity and graph proximity do not establish decision authority.

Open choices:
- Choose the graph projection/query storage after evaluating a small reproducible corpus and existing dependencies.

#### G1. Build a provenance-aware graph projection and query API

Outcome: A queryable derived graph over canonical planner entities and snapshot-bound code facts with consistent MCP/Pi/server access.

Existing state: Planner relationships already exist as structured data; code links, changesets and provider outputs will supply additional relationships. Current public projection does not include Requirements.

Implementation responsibility:
- Project existing IDs/edges instead of copying entities into another source of truth.
- Include Requirements and their actual phase-derived feature relationships; extend versioned API/events compatibly.
- Add code/decision/history relationships with declared, extracted and inferred provenance, coverage and snapshot identity.
- Provide bounded search, neighborhood, path/explain and reverse code-to-work/decision queries.
- Evaluate Graphify-style capabilities against an internal projection; record the actual engine choice and costs before adding dependencies.

Acceptance and evidence:
- A code target reaches relevant tasks and applicable decisions even without task-to-task dependencies.
- Queries expose source evidence and uncertainty.
- Existing API clients and hierarchical UI routes remain compatible.

Read before editing:
- packages/plan-core/src/api-v1.ts:343 — export function buildApiV1Model
- packages/plan-server/src/entity-events.ts:1 — (module)
- packages/plan-server/src/api-v1.ts:1 — (module)
- packages/plan-server/src/serve.ts:1 — (module)
- packages/plan-core/src/schema.ts:85 — export const AcceptedDecisionSchema
- packages/plan-core/src/plan-store.ts:3399 — async createAcceptedDecision
- packages/plan-mcp/src/index.ts:2263 — server.registerTool("planner-task-start"
- packages/pi-adapter/src/index.ts:1385 — async function scanCodebase
These module/symbol references and line positions were inspected at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231; revalidate against the current checkout. New module names/provider/storage details remain implementation choices to resolve in the owning task, not claims of existing code.

Preserve: canonical IDs, decision ownership, phase-scoped handoffs, atomic task/session ownership, derived parent statuses and the accepted warning-only no-task guard. Follow the existing project Guidelines and record relevant source precedents and conformity evidence on this task. Do not create new tasks for the checklist steps.

Plan dependencies: F3. Product requirement coverage: BR04, BR05, BR07, BR08, BR09, BR11, BR12, BR13, BR14, BR16, BR17. Supporting design: .planner/docs/agent-brain-plan.md.

Checklist:
- [ ] Project existing IDs/edges instead of copying entities into another source of truth.
- [ ] Include Requirements and their actual phase-derived feature relationships; extend versioned API/events compatibly.
- [ ] Add code/decision/history relationships with declared, extracted and inferred provenance, coverage and snapshot identity.
- [ ] Provide bounded search, neighborhood, path/explain and reverse code-to-work/decision queries.
- [ ] Evaluate Graphify-style capabilities against an internal projection; record the actual engine choice and costs before adding dependencies.
- [ ] Verify: A code target reaches relevant tasks and applicable decisions even without task-to-task dependencies.
- [ ] Verify: Queries expose source evidence and uncertainty.
- [ ] Verify: Existing API clients and hierarchical UI routes remain compatible.

#### G2. Deliver global orientation and impact-scoped implementation context

Outcome: A bounded context service that combines global project orientation with current implementation, constraints, rationale, usage and tests for the work being undertaken.

Existing state: The existing context follows the planning hierarchy. It does not automatically retrieve earlier unrelated tasks through their shared code target or relevant architectural precedents.

Implementation responsibility:
- Build a source-backed project/module responsibility overview with freshness and coverage.
- Resolve task intent to candidate code areas; disambiguate before making authoritative associations.
- Retrieve applicable scoped decisions, prior changesets, analogous implementations, callers/dependencies/interfaces and relevant tests.
- Expand along relevant impact boundaries and provide explicit continuation rather than loading the entire repository.
- Differentiate unavailable, not yet retrieved, stale and genuinely absent information.

Acceptance and evidence:
- T020 receives current code and T010/T002 rationale/constraints without rereading all old handoffs.
- Large development tasks receive module and integration context rather than only one function.
- Mandatory applicable rules are not silently truncated and retrieved sources remain inspectable.

Read before editing:
- packages/plan-core/src/task-context.ts:175 — export function buildPhaseContextBlock
- packages/plan-core/src/project-context.ts:357 — export function buildProjectContextLoadReply
- packages/plan-core/src/read-tracking.ts:28 — type ReadState
- packages/plan-core/src/api-v1.ts:343 — export function buildApiV1Model
- packages/plan-mcp/src/index.ts:2263 — server.registerTool("planner-task-start"
- packages/pi-adapter/src/index.ts:1385 — async function scanCodebase
- packages/plan-server/src/serve.ts:1 — (module)
These module/symbol references and line positions were inspected at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231; revalidate against the current checkout. New module names/provider/storage details remain implementation choices to resolve in the owning task, not claims of existing code.

Preserve: canonical IDs, decision ownership, phase-scoped handoffs, atomic task/session ownership, derived parent statuses and the accepted warning-only no-task guard. Follow the existing project Guidelines and record relevant source precedents and conformity evidence on this task. Do not create new tasks for the checklist steps.

Plan dependencies: G1. Product requirement coverage: BR04, BR05, BR07, BR08, BR09, BR11, BR12, BR13, BR14, BR16, BR17. Supporting design: .planner/docs/agent-brain-plan.md.

Checklist:
- [ ] Build a source-backed project/module responsibility overview with freshness and coverage.
- [ ] Resolve task intent to candidate code areas; disambiguate before making authoritative associations.
- [ ] Retrieve applicable scoped decisions, prior changesets, analogous implementations, callers/dependencies/interfaces and relevant tests.
- [ ] Expand along relevant impact boundaries and provide explicit continuation rather than loading the entire repository.
- [ ] Differentiate unavailable, not yet retrieved, stale and genuinely absent information.
- [ ] Verify: T020 receives current code and T010/T002 rationale/constraints without rereading all old handoffs.
- [ ] Verify: Large development tasks receive module and integration context rather than only one function.
- [ ] Verify: Mandatory applicable rules are not silently truncated and retrieved sources remain inspectable.

#### G3. Refresh impacted context and manage review evidence over time

Outcome: Incremental invalidation and explicit review records tied to the code/text versions they actually cover.

Existing state: Planner source watching exists, but code/provider/configuration changes require separate freshness handling. An unchanged function body does not prove unchanged dependent behavior or rationale.

Implementation responsibility:
- Invalidate affected resolutions, context packets and review evidence when linked sources, configuration or known dependencies change.
- Start with correctness-first on-demand validation; batch/cancel updates and add watchers only where useful.
- Present baseline, diff, current source, applicable decisions and affected verification evidence.
- Record factual-text review separately from approved decision changes; keep qualitative meaning checks explicit.
- Collect review obligations under the relevant existing work without automatically creating more tasks.

Acceptance and evidence:
- A changed dependency can invalidate a prior explanation even if the function body is unchanged.
- A review cannot approve a newer unseen snapshot or unrelated worktree.
- No automated rewrite makes an approved decision silently agree with drifting code.

Read before editing:
- packages/plan-core/src/description-freshness.ts:1 — (module)
- packages/plan-core/src/plan-store.ts:3399 — async createAcceptedDecision
- packages/plan-server/src/entity-events.ts:1 — (module)
- packages/plan-server/src/serve.ts:1 — (module)
- packages/plan-core/src/project-context.ts:357 — export function buildProjectContextLoadReply
- packages/plan-core/src/read-tracking.ts:28 — type ReadState
These module/symbol references and line positions were inspected at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231; revalidate against the current checkout. New module names/provider/storage details remain implementation choices to resolve in the owning task, not claims of existing code.

Preserve: canonical IDs, decision ownership, phase-scoped handoffs, atomic task/session ownership, derived parent statuses and the accepted warning-only no-task guard. Follow the existing project Guidelines and record relevant source precedents and conformity evidence on this task. Do not create new tasks for the checklist steps.

Plan dependencies: G2. Product requirement coverage: BR04, BR05, BR07, BR08, BR09, BR11, BR12, BR13, BR14, BR16, BR17. Supporting design: .planner/docs/agent-brain-plan.md.

Checklist:
- [ ] Invalidate affected resolutions, context packets and review evidence when linked sources, configuration or known dependencies change.
- [ ] Start with correctness-first on-demand validation; batch/cancel updates and add watchers only where useful.
- [ ] Present baseline, diff, current source, applicable decisions and affected verification evidence.
- [ ] Record factual-text review separately from approved decision changes; keep qualitative meaning checks explicit.
- [ ] Collect review obligations under the relevant existing work without automatically creating more tasks.
- [ ] Verify: A changed dependency can invalidate a prior explanation even if the function body is unchanged.
- [ ] Verify: A review cannot approve a newer unseen snapshot or unrelated worktree.
- [ ] Verify: No automated rewrite makes an approved decision silently agree with drifting code.

### H. Supervisor UI and graph exploration

Expose the same scheduling, context and traceability evidence that agents receive.

Goals:
- Make graph navigation, provenance, setup readiness and review obligations understandable.
- Preserve existing hierarchy, routing, human-supervisor semantics and live updates.

Out of scope:
- No mandatory graph-only navigation.
- No model-comprehension score or unsupported coverage claim.

Risks:
- A complex graph can hide actionable information behind visual clutter.
- The tracked server and Pi web-ui-dist consumers must be regenerated together for UI changes.

#### H1. Add graph navigation and reverse code-to-rationale inspection

Outcome: Accessible navigation between requirements, work, code usages and decisions, with source-backed explanations and preserved hierarchy.

Existing state: The current Web UI exposes hierarchical planner views. Earlier reliability tasks extend those views; this task owns the new graph/traceability surface.

Implementation responsibility:
- Reuse current UI components, routing and data patterns after reading relevant precedents.
- Add focused neighborhood/path views and filters before presenting a whole-project graph.
- Show current resolved location versus historical baseline and source provenance.
- Support keyboard/accessibility and meaningful empty/partial/stale states; preserve live synchronization.
- Regenerate both intentional web-ui-dist consumers with relevant UI validation.

Acceptance and evidence:
- A supervisor can navigate from a function or module to T002/T010/T020 and the applicable decision.
- Graph and hierarchy show the same canonical identities and current state.
- Partial semantic coverage is visibly distinguishable from no usage.

Read before editing:
- packages/plan-web-ui/src/components/dashboard/work-tree.tsx:1 — (module)
- packages/plan-web-ui/src/components/dashboard/work-tree-rows.tsx:1 — (module)
- packages/plan-web-ui/src/routes/task-detail/route.tsx:1 — (module)
- packages/plan-server/src/api-v1.ts:1 — (module)
- packages/plan-server/src/entity-events.ts:1 — (module)
These module/symbol references and line positions were inspected at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231; revalidate against the current checkout. New module names/provider/storage details remain implementation choices to resolve in the owning task, not claims of existing code.

Preserve: canonical IDs, decision ownership, phase-scoped handoffs, atomic task/session ownership, derived parent statuses and the accepted warning-only no-task guard. Follow the existing project Guidelines and record relevant source precedents and conformity evidence on this task. Do not create new tasks for the checklist steps.

Plan dependencies: G3. Product requirement coverage: BR01, BR05, BR07, BR08, BR09, BR10, BR11, BR12, BR14, BR15, BR16, BR17. Supporting design: .planner/docs/agent-brain-plan.md.

Checklist:
- [ ] Reuse current UI components, routing and data patterns after reading relevant precedents.
- [ ] Add focused neighborhood/path views and filters before presenting a whole-project graph.
- [ ] Show current resolved location versus historical baseline and source provenance.
- [ ] Support keyboard/accessibility and meaningful empty/partial/stale states; preserve live synchronization.
- [ ] Regenerate both intentional web-ui-dist consumers with relevant UI validation.
- [ ] Verify: A supervisor can navigate from a function or module to T002/T010/T020 and the applicable decision.
- [ ] Verify: Graph and hierarchy show the same canonical identities and current state.
- [ ] Verify: Partial semantic coverage is visibly distinguishable from no usage.

#### H2. Expose setup, context analysis and review state in supervisor workflows

Outcome: A coherent inspector for analysis readiness, pre-implementation evidence, changesets and explicit review/relink operations.

Existing state: Human supervision needs to inspect actual delivered sources, conventions, coverage and review state without treating a receipt as comprehension.

Implementation responsibility:
- Show undecided stack, no code, indexing, missing tool/configuration, ready and stale states with useful next actions.
- Display selected implementation precedents and source-backed convention/conformity evidence.
- Allow explicit candidate confirmation and scoped factual/decision review using expected snapshots.
- Keep agent-only governance distinct from authorized human controls; never give agents a supervisor bypass.
- Reuse existing UI primitives and regenerate both tracked UI bundles.

Acceptance and evidence:
- A supervisor can see why a task is ready to implement or what evidence is missing.
- Current-location confirmation is not presented as approval of architectural meaning.
- Existing settings, routes, content and human controls remain intact.

Read before editing:
- packages/plan-web-ui/src/components/dashboard/project-context.tsx:1 — (module)
- packages/plan-web-ui/src/routes/task-detail/route.tsx:1 — (module)
- packages/plan-server/src/serve.ts:1 — (module)
- packages/plan-server/src/entity-events.ts:1 — (module)
- packages/plan-core/src/read-tracking.ts:28 — type ReadState
- packages/plan-core/src/plan-store.ts:3399 — async createAcceptedDecision
These module/symbol references and line positions were inspected at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231; revalidate against the current checkout. New module names/provider/storage details remain implementation choices to resolve in the owning task, not claims of existing code.

Preserve: canonical IDs, decision ownership, phase-scoped handoffs, atomic task/session ownership, derived parent statuses and the accepted warning-only no-task guard. Follow the existing project Guidelines and record relevant source precedents and conformity evidence on this task. Do not create new tasks for the checklist steps.

Plan dependencies: H1. Product requirement coverage: BR01, BR05, BR07, BR08, BR09, BR10, BR11, BR12, BR14, BR15, BR16, BR17. Supporting design: .planner/docs/agent-brain-plan.md.

Checklist:
- [ ] Show undecided stack, no code, indexing, missing tool/configuration, ready and stale states with useful next actions.
- [ ] Display selected implementation precedents and source-backed convention/conformity evidence.
- [ ] Allow explicit candidate confirmation and scoped factual/decision review using expected snapshots.
- [ ] Keep agent-only governance distinct from authorized human controls; never give agents a supervisor bypass.
- [ ] Reuse existing UI primitives and regenerate both tracked UI bundles.
- [ ] Verify: A supervisor can see why a task is ready to implement or what evidence is missing.
- [ ] Verify: Current-location confirmation is not presented as approval of architectural meaning.
- [ ] Verify: Existing settings, routes, content and human controls remain intact.

### I. Compatibility, installed validation and operating documentation

Verify complete user workflows and leave a reproducible implementation handover.

Goals:
- Validate migrations, supported harnesses, polyglot analysis and the complete scenario matrix. Ensure variable-width feature/phase/task sequences across supported surfaces.
- Document real capabilities, limitations and the seam with a future AgentTest concept.

Out of scope:
- No autonomous release, publish, PR or standalone AgentTest product.
- No claim of production support from workspace tests alone.

Risks:
- Schema growth may break older plans or clients.
- Cached artifacts or a stale global MCP process can hide broken packaged behavior.

#### I1. Verify migrations, invariants and complete cross-surface scenarios

Outcome: Reproducible compatibility and workflow evidence over isolated old/new plans and actual supported surfaces.

Existing state: Existing schema/runtime boundaries and integration suites provide precedents, but new link/history/provider data needs backward compatibility and end-to-end coverage.

Implementation responsibility:
- Test lossless/idempotent migrations preserving IDs, decisions, handoffs, requirements, checkpoints, statuses and dependency edges.
- Verify the complete scenario matrix, including failed/partial tool responses, concurrent ownership and feature/phase/task sequence boundaries 999→1000, 9999→10000 and larger valid integers across supported surfaces; fix bounded-width assumptions found.
- Check required fields in v1/API events and schema evolution with existing clients.
- Verify text-only, supported-language and mixed-language paths plus context loss and stale snapshots.
- Record unresolved coverage explicitly instead of marking untested surfaces complete.

Acceptance and evidence:
- All required scenarios have concrete evidence or a named unresolved blocker.
- No migration fabricates semantic links or loses approved history.
- Normal reads do not silently rewrite canonical knowledge; allocation, full reference resolution, numeric ordering/search, dependencies, parked returns, API/MCP/Pi, export and Web UI preserve identities beyond three and four digits.

Read before editing:
- packages/plan-core/src/schema.ts:85 — export const AcceptedDecisionSchema
- packages/plan-core/src/plan-store.ts:3399 — async createAcceptedDecision
- packages/plan-core/docs/runtime-boundaries.md:1 — (module)
- packages/plan-core/src/api-v1.ts:343 — export function buildApiV1Model
- packages/plan-server/src/entity-events.ts:1 — (module)
- packages/plan-mcp/src/index.ts:2263 — server.registerTool("planner-task-start"
- packages/pi-adapter/src/index.ts:1385 — async function scanCodebase
- packages/plan-server/src/serve.ts:1 — (module)
These module/symbol references and line positions were inspected at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231; revalidate against the current checkout. New module names/provider/storage details remain implementation choices to resolve in the owning task, not claims of existing code.

Preserve: canonical IDs, decision ownership, phase-scoped handoffs, atomic task/session ownership, derived parent statuses and the accepted warning-only no-task guard. Follow the existing project Guidelines and record relevant source precedents and conformity evidence on this task. Do not create new tasks for the checklist steps.

Plan dependencies: H2. Product requirement coverage: BR01, BR02, BR03, BR04, BR05, BR06, BR07, BR08, BR09, BR10, BR11, BR12, BR13, BR14, BR15, BR16, BR17. Supporting design: .planner/docs/agent-brain-plan.md.

Checklist:
- [ ] Test lossless/idempotent migrations preserving IDs, decisions, handoffs, requirements, checkpoints, statuses and dependency edges.
- [ ] Verify the complete scenario matrix, including failed/partial tool responses, concurrent ownership and feature/phase/task sequence boundaries 999→1000, 9999→10000 and larger valid integers across supported surfaces; fix bounded-width assumptions found.
- [ ] Check required fields in v1/API events and schema evolution with existing clients.
- [ ] Verify text-only, supported-language and mixed-language paths plus context loss and stale snapshots.
- [ ] Record unresolved coverage explicitly instead of marking untested surfaces complete.
- [ ] Verify: All required scenarios have concrete evidence or a named unresolved blocker.
- [ ] Verify: No migration fabricates semantic links or loses approved history.
- [ ] Verify: Normal reads do not silently rewrite canonical knowledge; allocation, full reference resolution, numeric ordering/search, dependencies, parked returns, API/MCP/Pi, export and Web UI preserve identities beyond three and four digits.

#### I2. Validate installed artifacts and publish the operating guide

Outcome: A reviewable feature closeout with current architecture/setup/protocol documentation and verified installed behavior, without publishing a release.

Existing state: Repository verification rules already require bounded checks and freshly packed installation smoke. This feature adds setup and source-context workflows requiring documented support boundaries.

Implementation responsibility:
- Run only affected verification during development and the canonical final gate according to AGENTS.md; reuse results only for unchanged fingerprints.
- Install freshly packed artifacts in temporary locations and verify actual CLI/MCP/Pi/server/provider entry points.
- Document empty-folder onboarding, unsupported languages, context restoration, code links, decision review and supervisor UI.
- Describe test-evidence integration and future AgentTest extension boundaries without adding a second test product.
- Reconcile feature/phase/task descriptions and remaining limitations; leave release and commit actions to explicit authorization.

Acceptance and evidence:
- Final evidence identifies exact package/source fingerprints and tested supported environments.
- A new agent can follow the documented workflow using the planner, existing sources and explicit uncertainty.
- No release/publish claim is made without the corresponding authorized action and registry evidence.

Read before editing:
- package.json:35 — verify:final
- packages/agent-plan/src/index.ts:1 — (module)
- packages/plan-mcp/src/index.ts:2263 — server.registerTool("planner-task-start"
- packages/pi-adapter/src/index.ts:1385 — async function scanCodebase
- packages/plan-server/src/serve.ts:1 — (module)
- packages/plan-core/planner-skill.md:42 — ## Lifecycle-first context protocol
- scripts/sync-plugins.cjs:1 — (module)
- packages/plan-core/docs/runtime-boundaries.md:1 — (module)
These module/symbol references and line positions were inspected at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231; revalidate against the current checkout. New module names/provider/storage details remain implementation choices to resolve in the owning task, not claims of existing code.

Preserve: canonical IDs, decision ownership, phase-scoped handoffs, atomic task/session ownership, derived parent statuses and the accepted warning-only no-task guard. Follow the existing project Guidelines and record relevant source precedents and conformity evidence on this task. Do not create new tasks for the checklist steps.

Plan dependencies: I1. Product requirement coverage: BR01, BR02, BR03, BR04, BR05, BR06, BR07, BR08, BR09, BR10, BR11, BR12, BR13, BR14, BR15, BR16, BR17. Supporting design: .planner/docs/agent-brain-plan.md.

Checklist:
- [ ] Run only affected verification during development and the canonical final gate according to AGENTS.md; reuse results only for unchanged fingerprints.
- [ ] Install freshly packed artifacts in temporary locations and verify actual CLI/MCP/Pi/server/provider entry points.
- [ ] Document empty-folder onboarding, unsupported languages, context restoration, code links, decision review and supervisor UI.
- [ ] Describe test-evidence integration and future AgentTest extension boundaries without adding a second test product.
- [ ] Reconcile feature/phase/task descriptions and remaining limitations; leave release and commit actions to explicit authorization.
- [ ] Verify: Final evidence identifies exact package/source fingerprints and tested supported environments.
- [ ] Verify: A new agent can follow the documented workflow using the planner, existing sources and explicit uncertainty.
- [ ] Verify: No release/publish claim is made without the corresponding authorized action and registry evidence.

## New registered editor and identity phases

Read [the full expansion handover](agent-brain-editor-and-project-identity.md) for the complete mechanisms, source evidence and acceptance contracts. These outcomes extend existing provider/graph ownership and include editing/saving, shared runtime reuse and external editor opening.

### J. P125(F025) — Project identity and browser page titles

Keep the project recognizable in browser tabs and detail navigation.

Current state: packages/plan-web-ui/index.html:6 has a static Agent Plan title. RootRoute in packages/plan-web-ui/src/app/root.tsx:25 already derives a project title, while RootErrorBoundary:86 resets it. EntityDetailIdentity in packages/plan-web-ui/src/components/detail/entity-detail-identity.tsx:28 overwrites it with type/reference/title and later restores a captured prior title. The user reports an always-generic overview title and project-less detail titles; runtime reproduction is still required.

Goals:
- Keep the actual project name in overview and detail-page browser titles.
- Remove competing title effects while preserving visible page identity and live navigation.

Responsibilities:
- P125(F025)/T483: Preserve project identity in overview and detail page titles. Reliable project-aware browser titles on overview, list and detail routes, without losing project context during navigation or updates.

Boundaries:
- Do not rebuild code analysis or introduce editor dependencies for this fix.

Risks:
- Root and detail effects currently compete; a cleanup can restore an obsolete title.
- The reported installed behavior may differ from current source and must be reproduced.

Acceptance:
- Two initialized projects have distinguishable browser tabs on overview and detail routes.
- A task displays e.g. My Project - T1000 [Refactor parameter handling]; F/P detail follows the same project-first rule.
- Navigation, live renames, loading/errors with known project context and effect cleanup do not drop or restore stale project identity.

Use .planner/docs/agent-brain-editor-and-project-identity.md and exact child task contracts. Existing source references are named above; revalidate before editing.

Preserve canonical planner IDs/decision ownership, phase-scoped handoffs, existing settings, atomic session ownership, warning-only no-task behavior and shared versus worktree-local runtime boundaries. Read existing source precedents and applicable Guidelines before coding. File:line entries above are navigation evidence inspected on 21 October 2026, never durable identity; source hashes are recorded in the supporting document. Verify current code before implementation. Use task checklists rather than creating tasks per step. This registration does not start implementation, install dependencies, commit or publish.

Registered scope: P125(F025)/T483. All tasks remain planned; implementation has not started.

#### P125(F025)/T483 — Preserve project identity in overview and detail page titles

Outcome: Reliable project-aware browser titles on overview, list and detail routes, without losing project context during navigation or updates.

Existing state: packages/plan-web-ui/index.html:6 has a static Agent Plan title. RootRoute in packages/plan-web-ui/src/app/root.tsx:25 already derives a project title, while RootErrorBoundary:86 resets it. EntityDetailIdentity in packages/plan-web-ui/src/components/detail/entity-detail-identity.tsx:28 overwrites it with type/reference/title and later restores a captured prior title. The user reports an always-generic overview title and project-less detail titles; runtime reproduction is still required.

Implementation responsibility:
- Reproduce overview and direct detail navigation using current runtime/artifact fingerprints; distinguish missing metadata from competing effects and stale bundles.
- Implement one route-aware title owner using canonical project.name and resolved entity identity; remove competing child assignment/cleanup behavior.
- Use ProjectName on the overview and ProjectName - TaskID [Short task title] on task detail; use the same project-first convention for feature and phase detail and contextual list/document/source pages.
- Interpret the bracketed description as the short entity title, not the full task description; support references longer than three/four digits without truncating their identity.
- Handle deep links, reload, back/forward, detail-to-detail navigation, modals, live project/entity renames and errors/loading without restoring the previous project's title. Retain the last known correct project name where available; a pre-project bootstrap fallback must not persist after resolution.
- Preserve the existing visible AppShell project identity, accessible entity headings and settings; add focused title regressions and regenerate both tracked web-ui-dist consumers with the UI change.

Acceptance and evidence:
- Two initialized projects have distinguishable browser tabs on overview and detail routes.
- A task displays e.g. My Project - T1000 [Refactor parameter handling]; F/P detail follows the same project-first rule.
- Navigation, live renames, loading/errors with known project context and effect cleanup do not drop or restore stale project identity.

Read before editing:
- packages/plan-web-ui/index.html:6
- packages/plan-web-ui/src/app/root.tsx:25
- packages/plan-web-ui/src/components/detail/entity-detail-identity.tsx:28
- packages/plan-web-ui/src/components/layout/app-shell.tsx:118
- packages/plan-web-ui/src/app/router.tsx:51

Detailed discussion contract:
- The generic overview report is not proof that RootRoute lacks project-name code; reproduce the actual source and installed artifact path before fixing.
- Project context belongs in the browser title even when a detail heading describes a task. Keep short page identity separate from the full textual description.
- This early independent reliability fix can follow baseline A at the same phase priority; it does not wait for the code graph or Monaco.

Execution dependencies: none. Requirement aliases: BR18, BR15, BR16. Full design: .planner/docs/agent-brain-editor-and-project-identity.md.

Preserve canonical planner IDs/decision ownership, phase-scoped handoffs, existing settings, atomic session ownership, warning-only no-task behavior and shared versus worktree-local runtime boundaries. Read existing source precedents and applicable Guidelines before coding. File:line entries above are navigation evidence inspected on 21 October 2026, never durable identity; source hashes are recorded in the supporting document. Verify current code before implementation. Use task checklists rather than creating tasks per step. This registration does not start implementation, install dependencies, commit or publish.

Checklist:
- [ ] Reproduce overview and direct detail navigation using current runtime/artifact fingerprints; distinguish missing metadata from competing effects and stale bundles.
- [ ] Implement one route-aware title owner using canonical project.name and resolved entity identity; remove competing child assignment/cleanup behavior.
- [ ] Use ProjectName on the overview and ProjectName - TaskID [Short task title] on task detail; use the same project-first convention for feature and phase detail and contextual list/document/source pages.
- [ ] Interpret the bracketed description as the short entity title, not the full task description; support references longer than three/four digits without truncating their identity.
- [ ] Handle deep links, reload, back/forward, detail-to-detail navigation, modals, live project/entity renames and errors/loading without restoring the previous project's title. Retain the last known correct project name where available; a pre-project bootstrap fallback must not persist after resolution.
- [ ] Preserve the existing visible AppShell project identity, accessible entity headings and settings; add focused title regressions and regenerate both tracked web-ui-dist consumers with the UI change.
- [ ] Verify: Two initialized projects have distinguishable browser tabs on overview and detail routes.
- [ ] Verify: A task displays e.g. My Project - T1000 [Refactor parameter handling]; F/P detail follows the same project-first rule.
- [ ] Verify: Navigation, live renames, loading/errors with known project context and effect cleanup do not drop or restore stale project identity.

### K. P126(F025) — Code workspace access and shared analysis service

Expose revision-aware source access and one reusable analysis runtime to agents and the Web UI.

Current state: packages/plan-server/src/serve.ts:525 exposes planner-owned Markdown document routes only; packages/plan-web-ui/src/lib/api.ts:1 consumes HTTP domain APIs. packages/plan-server/src/ws-hub.ts:1 broadcasts planner events, not source-buffer revisions. No general code workspace service is implemented.

P121/T474 owns common provider adapters and lifecycle, but does not yet implement a shared multi-consumer runtime. packages/plan-server/src/server-record.ts:1 shows existing local server discovery; its advisory record alone is not proof of atomic process ownership. MCP/Pi/server can run in different processes.

Goals:
- Provide project-scoped source reads and conflict-aware saves without broadening planner-document APIs.
- Share compatible provider processes across editor and supported agent surfaces with explicit document versions and ownership.

Responsibilities:
- P126(F025)/T484: Add project-scoped source access and revision-safe file saves. A shared source-workspace service can enumerate, read and save user-project text files with explicit versions, conflicts and change provenance.
- P126(F025)/T485: Share language-server processes across agents and the editor. Agents and the browser query one compatible provider runtime per project/worktree, provider/version and effective analysis configuration.

Boundaries:
- Do not recreate provider discovery/adapters owned by P121/T473-T475.
- Do not make browser-only Monaco APIs part of planner core or start the dashboard implicitly.

Risks:
- Independent MCP, Pi and Web UI hosts can each start a duplicate provider unless runtime ownership is coordinated.
- Unsaved editor buffers and external agent writes can invalidate analysis or lose work if versions are implicit.

Acceptance:
- The explorer can read and save files only in the resolved project scope; planner Markdown remains separately governed.
- Two consumers saving from the same revision cannot silently overwrite each other; conflict responses preserve both the user draft and current content.
- Successful or external saves notify consumers and invalidate dependent evidence without fabricating task attribution.
- Opening Monaco while an agent uses the same compatible workspace does not create a second language-server process; concurrent startup is covered by evidence.
- Different worktrees, providers or effective configurations are isolated and their results never cross-contaminate.
- Browser disconnect, unsaved edits, external saves and provider restart preserve explicit source versions and do not stop other consumers or advertise unsupported operations.

Use .planner/docs/agent-brain-editor-and-project-identity.md and exact child task contracts. Existing source references are named above; revalidate before editing.

Preserve canonical planner IDs/decision ownership, phase-scoped handoffs, existing settings, atomic session ownership, warning-only no-task behavior and shared versus worktree-local runtime boundaries. Read existing source precedents and applicable Guidelines before coding. File:line entries above are navigation evidence inspected on 21 October 2026, never durable identity; source hashes are recorded in the supporting document. Verify current code before implementation. Use task checklists rather than creating tasks per step. This registration does not start implementation, install dependencies, commit or publish.

Registered scope: P126(F025)/T484, P126(F025)/T485. All tasks remain planned; implementation has not started.

#### P126(F025)/T484 — Add project-scoped source access and revision-safe file saves

Outcome: A shared source-workspace service can enumerate, read and save user-project text files with explicit versions, conflicts and change provenance.

Existing state: packages/plan-server/src/serve.ts:525 exposes planner-owned Markdown document routes only; packages/plan-web-ui/src/lib/api.ts:1 consumes HTTP domain APIs. packages/plan-server/src/ws-hub.ts:1 broadcasts planner events, not source-buffer revisions. No general code workspace service is implemented.

Implementation responsibility:
- Read the existing source-access, document-path and runtime boundaries; add separate code-workspace APIs instead of widening .planner/docs routes.
- Resolve project/worktree roots and normalized relative paths; enforce root containment, explicit symlink handling, regular-text-file checks, encoding, binary/size limits and useful pagination for large trees.
- Return file content with revision/hash, language identity hints and checkout provenance; resolve durable CodeLinks via the existing E1 contract rather than treating a URL line as permanent identity.
- Implement saves with an expected revision, per-file serialization and safe replacement; reject stale saves with current/base/draft comparison rather than silently overwriting an agent or external edit.
- Observe on-disk changes and publish scoped source/version events; invalidate affected provider results, graph/context and meaning-review evidence through their owning contracts.
- Attribute UI/external edits honestly in task changesets, preserving unrelated dirty work and task/session ownership; verify APIs on isolated mkdtemp fixtures with save races, deletion and malformed/foreign paths.

Acceptance and evidence:
- The explorer can read and save files only in the resolved project scope; planner Markdown remains separately governed.
- Two consumers saving from the same revision cannot silently overwrite each other; conflict responses preserve both the user draft and current content.
- Successful or external saves notify consumers and invalidate dependent evidence without fabricating task attribution.

Read before editing:
- packages/plan-server/src/serve.ts:525
- packages/plan-server/src/ws-hub.ts:1
- packages/plan-web-ui/src/lib/api.ts:1
- packages/plan-core/docs/runtime-boundaries.md:1

Detailed discussion contract:
- Source bytes remain in the user-project filesystem; canonical planner links remain planner-owned and derived indexes are not a second source of truth.
- Saving code from the human supervisor does not imply that an agent task owns the edit, and does not grant agents a governance bypass.
- Revision checks are part of the save operation, not just an earlier client check. The implementation must document the actual external-writer race limits of its filesystem strategy.

Execution dependencies: P121(F025)/T475. Requirement aliases: BR19, BR07, BR08, BR14, BR16. Full design: .planner/docs/agent-brain-editor-and-project-identity.md.

Preserve canonical planner IDs/decision ownership, phase-scoped handoffs, existing settings, atomic session ownership, warning-only no-task behavior and shared versus worktree-local runtime boundaries. Read existing source precedents and applicable Guidelines before coding. File:line entries above are navigation evidence inspected on 21 October 2026, never durable identity; source hashes are recorded in the supporting document. Verify current code before implementation. Use task checklists rather than creating tasks per step. This registration does not start implementation, install dependencies, commit or publish.

Checklist:
- [ ] Read the existing source-access, document-path and runtime boundaries; add separate code-workspace APIs instead of widening .planner/docs routes.
- [ ] Resolve project/worktree roots and normalized relative paths; enforce root containment, explicit symlink handling, regular-text-file checks, encoding, binary/size limits and useful pagination for large trees.
- [ ] Return file content with revision/hash, language identity hints and checkout provenance; resolve durable CodeLinks via the existing E1 contract rather than treating a URL line as permanent identity.
- [ ] Implement saves with an expected revision, per-file serialization and safe replacement; reject stale saves with current/base/draft comparison rather than silently overwriting an agent or external edit.
- [ ] Observe on-disk changes and publish scoped source/version events; invalidate affected provider results, graph/context and meaning-review evidence through their owning contracts.
- [ ] Attribute UI/external edits honestly in task changesets, preserving unrelated dirty work and task/session ownership; verify APIs on isolated mkdtemp fixtures with save races, deletion and malformed/foreign paths.
- [ ] Verify: The explorer can read and save files only in the resolved project scope; planner Markdown remains separately governed.
- [ ] Verify: Two consumers saving from the same revision cannot silently overwrite each other; conflict responses preserve both the user draft and current content.
- [ ] Verify: Successful or external saves notify consumers and invalidate dependent evidence without fabricating task attribution.

#### P126(F025)/T485 — Share language-server processes across agents and the editor

Outcome: Agents and the browser query one compatible provider runtime per project/worktree, provider/version and effective analysis configuration.

Existing state: P121/T474 owns common provider adapters and lifecycle, but does not yet implement a shared multi-consumer runtime. packages/plan-server/src/server-record.ts:1 shows existing local server discovery; its advisory record alone is not proof of atomic process ownership. MCP/Pi/server can run in different processes.

Implementation responsibility:
- Extend P121 provider contracts with a shared analysis service; define the complete runtime key, capability negotiation, cancellation, diagnostics and source/configuration fingerprints.
- Coordinate a single compatible runtime owner across supported MCP/Pi/server hosts using an atomic startup/discovery mechanism; reuse live compatible owners and distinguish dead/incompatible owners without killing foreign embedded hosts.
- Keep one upstream LSP session under broker ownership and expose common analysis APIs to consumers. Do not connect independent frontend/backend initializations blindly to one stdio connection.
- Define document-open/change/close ownership, source revisions and explicit unsaved overlays. Agents normally query a named saved snapshot unless an overlay is explicitly requested; conflicting browser drafts never silently replace one another or the agent's analysis.
- Use bounded resources, consumer leases/reference tracking, idle cleanup, reconnect and crash recovery. Closing an editor tab must not stop a provider still used by agents; analysis lifecycle must not imply dashboard activation.
- Verify simultaneous editor and agent clients, including separate supported host processes: one process for the same key, appropriate separate processes for different keys, versioned results, unsupported capabilities and stale/partial failures.

Acceptance and evidence:
- Opening Monaco while an agent uses the same compatible workspace does not create a second language-server process; concurrent startup is covered by evidence.
- Different worktrees, providers or effective configurations are isolated and their results never cross-contaminate.
- Browser disconnect, unsaved edits, external saves and provider restart preserve explicit source versions and do not stop other consumers or advertise unsupported operations.

Read before editing:
- packages/plan-server/src/server-record.ts:1
- packages/plan-server/src/ws-hub.ts:1
- packages/plan-core/docs/runtime-boundaries.md:1
- packages/plan-mcp/src/index.ts:1
- packages/pi-adapter/src/index.ts:1

Detailed discussion contract:
- CodeMirror or Monaco is an editor/client, not a reason to start another server. The agreed design is one compatible analysis owner serving both human UI and agents.
- An editor LSP-client package does not automatically implement reuse. Prefer editor provider hooks mapped to the common broker APIs; an LSP gateway requires explicit initialization/session virtualization if selected.
- Language support remains manifest/configuration driven. Syntax coloring and semantic operations are separate capabilities, and no provider means explicit text-only/incomplete analysis rather than zero references.

Execution dependencies: P126(F025)/T484, P121(F025)/T474. Requirement aliases: BR20, BR11, BR14, BR16. Full design: .planner/docs/agent-brain-editor-and-project-identity.md.

Preserve canonical planner IDs/decision ownership, phase-scoped handoffs, existing settings, atomic session ownership, warning-only no-task behavior and shared versus worktree-local runtime boundaries. Read existing source precedents and applicable Guidelines before coding. File:line entries above are navigation evidence inspected on 21 October 2026, never durable identity; source hashes are recorded in the supporting document. Verify current code before implementation. Use task checklists rather than creating tasks per step. This registration does not start implementation, install dependencies, commit or publish.

Checklist:
- [ ] Extend P121 provider contracts with a shared analysis service; define the complete runtime key, capability negotiation, cancellation, diagnostics and source/configuration fingerprints.
- [ ] Coordinate a single compatible runtime owner across supported MCP/Pi/server hosts using an atomic startup/discovery mechanism; reuse live compatible owners and distinguish dead/incompatible owners without killing foreign embedded hosts.
- [ ] Keep one upstream LSP session under broker ownership and expose common analysis APIs to consumers. Do not connect independent frontend/backend initializations blindly to one stdio connection.
- [ ] Define document-open/change/close ownership, source revisions and explicit unsaved overlays. Agents normally query a named saved snapshot unless an overlay is explicitly requested; conflicting browser drafts never silently replace one another or the agent's analysis.
- [ ] Use bounded resources, consumer leases/reference tracking, idle cleanup, reconnect and crash recovery. Closing an editor tab must not stop a provider still used by agents; analysis lifecycle must not imply dashboard activation.
- [ ] Verify simultaneous editor and agent clients, including separate supported host processes: one process for the same key, appropriate separate processes for different keys, versioned results, unsupported capabilities and stale/partial failures.
- [ ] Verify: Opening Monaco while an agent uses the same compatible workspace does not create a second language-server process; concurrent startup is covered by evidence.
- [ ] Verify: Different worktrees, providers or effective configurations are isolated and their results never cross-contaminate.
- [ ] Verify: Browser disconnect, unsaved edits, external saves and provider restart preserve explicit source versions and do not stop other consumers or advertise unsupported operations.

### L. P127(F025) — Integrated Monaco workspace and external-editor navigation

Provide editable project files, semantic navigation and code-to-planner context in the desktop Web UI.

Current state: packages/plan-web-ui/src/app/router.tsx:51 defines planner routes, packages/plan-web-ui/src/routes/doc-viewer.route.tsx:1 provides a Markdown textarea, and packages/plan-web-ui/package.json:1 has no code editor dependency. T385 deliberately kept the Markdown baseline lightweight; the new source-code workspace is a separately loaded capability.

P123/T479 owns graph and reverse code-to-rationale navigation, P120 owns anchors/history, P122 owns projections/retrieval, and K2 owns provider sessions. This task binds those existing contracts to the editor; it does not recreate any of them.

The current Web UI has no discovered preferred-editor launcher. packages/plan-server/src/serve.ts:1564 exposes existing UI configuration and AppShell receives local server context; runtime settings must stay local rather than becoming shared project policy.

Goals:
- Provide a file explorer, Monaco editing, diff and safe saves integrated with planner identity.
- Use shared analysis and canonical code links for semantic navigation, and open the selected file in a preferred external editor.

Responsibilities:
- P127(F025)/T486: Build a lazy-loaded Monaco file explorer and editable workspace. A desktop code workspace provides a project file tree, file tabs, Monaco editing, syntax coloring, change comparison and conflict-aware saving.
- P127(F025)/T487: Connect Monaco navigation to shared analysis and planner rationale. Selecting code exposes verified semantic navigation and relevant prior tasks, decisions, rules and evidence beside the current or historical source.
- P127(F025)/T488: Open source locations in the preferred external editor. A user can open the current file or resolved symbol in a locally configured external editor, including line/column when supported.

Boundaries:
- Do not introduce a second planner, debugger, terminal, extension marketplace or general autonomous IDE platform.
- Mobile code editing is not an acceptance gate for choosing Monaco; preserve existing planner responsiveness and document actual source-view limits.

Risks:
- Editor workers/assets or mixed Monaco integration versions can fail in freshly packaged/offline deployments.
- A browser-local editor opener and a server-host launch target are different machines in LAN/remote use.

Acceptance:
- A user opens project files from the tree, edits, compares and saves them; navigation or external edits do not discard drafts silently.
- The same code workspace supports newly configured language assets without a core language whitelist; syntax availability is distinct from LSP readiness.
- Monaco works from freshly packed local artifacts with correctly resolved workers/assets, and opening ordinary planner pages does not eagerly load the code editor.
- Definition/reference navigation and context panels reuse the same provider and canonical identities seen by agents.
- The worked T002/T010/T020 case is navigable from both planner and code without inventing missing rationale.
- Unavailable/stale/partial analysis is explicit; historical source and draft context cannot be mistaken for current verified results.
- A configured editor opens the correct project/worktree file at the resolved location; launch arguments preserve literal paths.
- Preferences remain machine-local and the user can configure a compatible editor without changing core.
- Remote/LAN use and unsaved drafts never silently open or present the wrong machine/file version as current.

Use .planner/docs/agent-brain-editor-and-project-identity.md and exact child task contracts. Existing source references are named above; revalidate before editing.

Preserve canonical planner IDs/decision ownership, phase-scoped handoffs, existing settings, atomic session ownership, warning-only no-task behavior and shared versus worktree-local runtime boundaries. Read existing source precedents and applicable Guidelines before coding. File:line entries above are navigation evidence inspected on 21 October 2026, never durable identity; source hashes are recorded in the supporting document. Verify current code before implementation. Use task checklists rather than creating tasks per step. This registration does not start implementation, install dependencies, commit or publish.

Registered scope: P127(F025)/T486, P127(F025)/T487, P127(F025)/T488. All tasks remain planned; implementation has not started.

#### P127(F025)/T486 — Build a lazy-loaded Monaco file explorer and editable workspace

Outcome: A desktop code workspace provides a project file tree, file tabs, Monaco editing, syntax coloring, change comparison and conflict-aware saving.

Existing state: packages/plan-web-ui/src/app/router.tsx:51 defines planner routes, packages/plan-web-ui/src/routes/doc-viewer.route.tsx:1 provides a Markdown textarea, and packages/plan-web-ui/package.json:1 has no code editor dependency. T385 deliberately kept the Markdown baseline lightweight; the new source-code workspace is a separately loaded capability.

Implementation responsibility:
- Use Monaco Editor as the selected source-code component; resolve compatible ESM/worker/React integration versions and measure startup, memory and bundle cost before choosing any optional wrapper.
- Lazy-load the workspace, editor workers and needed language assets; ship assets locally in both tracked Web UI bundles rather than depending on a public CDN or assuming VS Code extensions can be installed.
- Implement the explorer, keyboard-accessible tabs/panes, file opening, search within a document, dirty indicators, explicit save/discard and safe close/navigation behavior using current routing/UI patterns.
- Bind models to project/worktree/file identity with versioned saved baselines; preserve separate drafts, undo history and selections across supported tab navigation, and dispose unused models/listeners deliberately.
- Connect K1 file APIs for saving and external-change notices; show base/draft/current conflicts and use the Monaco diff view without silently losing unsaved work.
- Load syntax support from an extensible language/asset registry independently of semantic providers; show explicit plain-text mode if a grammar/tokenizer is unavailable.
- Keep the Markdown document editor and existing planner pages lightweight; apply J1 project-first titles to source routes, regenerate both web-ui-dist consumers and verify fresh packaged desktop loading.

Acceptance and evidence:
- A user opens project files from the tree, edits, compares and saves them; navigation or external edits do not discard drafts silently.
- The same code workspace supports newly configured language assets without a core language whitelist; syntax availability is distinct from LSP readiness.
- Monaco works from freshly packed local artifacts with correctly resolved workers/assets, and opening ordinary planner pages does not eagerly load the code editor.

Read before editing:
- packages/plan-web-ui/src/app/router.tsx:51
- packages/plan-web-ui/src/routes/doc-viewer.route.tsx:1
- packages/plan-web-ui/src/components/layout/app-shell.tsx:118
- packages/plan-web-ui/package.json:1
- scripts/copy-web-ui.sh:1

Detailed discussion contract:
- The user chose the file-explorer/edit/highlight/open-external experience. Source editing and saving are included, not deferred behind a read-only-only first delivery.
- Monaco is selected for the desktop workflow after the user clarified that mobile code editing should not determine the editor choice. CodeMirror was evaluated, not accepted as the implementation choice.
- Do not mix incompatible Monaco wrappers and LSP stacks. No client-side language server is started by default; semantic operations use K2. Exact dependency versions are implementation choices verified against current primary docs and the installed bundle.

Execution dependencies: P126(F025)/T484, P125(F025)/T483, P123(F025)/T480. Requirement aliases: BR19, BR18, BR11, BR15, BR16. Full design: .planner/docs/agent-brain-editor-and-project-identity.md.

Preserve canonical planner IDs/decision ownership, phase-scoped handoffs, existing settings, atomic session ownership, warning-only no-task behavior and shared versus worktree-local runtime boundaries. Read existing source precedents and applicable Guidelines before coding. File:line entries above are navigation evidence inspected on 21 October 2026, never durable identity; source hashes are recorded in the supporting document. Verify current code before implementation. Use task checklists rather than creating tasks per step. This registration does not start implementation, install dependencies, commit or publish.

Checklist:
- [ ] Use Monaco Editor as the selected source-code component; resolve compatible ESM/worker/React integration versions and measure startup, memory and bundle cost before choosing any optional wrapper.
- [ ] Lazy-load the workspace, editor workers and needed language assets; ship assets locally in both tracked Web UI bundles rather than depending on a public CDN or assuming VS Code extensions can be installed.
- [ ] Implement the explorer, keyboard-accessible tabs/panes, file opening, search within a document, dirty indicators, explicit save/discard and safe close/navigation behavior using current routing/UI patterns.
- [ ] Bind models to project/worktree/file identity with versioned saved baselines; preserve separate drafts, undo history and selections across supported tab navigation, and dispose unused models/listeners deliberately.
- [ ] Connect K1 file APIs for saving and external-change notices; show base/draft/current conflicts and use the Monaco diff view without silently losing unsaved work.
- [ ] Load syntax support from an extensible language/asset registry independently of semantic providers; show explicit plain-text mode if a grammar/tokenizer is unavailable.
- [ ] Keep the Markdown document editor and existing planner pages lightweight; apply J1 project-first titles to source routes, regenerate both web-ui-dist consumers and verify fresh packaged desktop loading.
- [ ] Verify: A user opens project files from the tree, edits, compares and saves them; navigation or external edits do not discard drafts silently.
- [ ] Verify: The same code workspace supports newly configured language assets without a core language whitelist; syntax availability is distinct from LSP readiness.
- [ ] Verify: Monaco works from freshly packed local artifacts with correctly resolved workers/assets, and opening ordinary planner pages does not eagerly load the code editor.

#### P127(F025)/T487 — Connect Monaco navigation to shared analysis and planner rationale

Outcome: Selecting code exposes verified semantic navigation and relevant prior tasks, decisions, rules and evidence beside the current or historical source.

Existing state: P123/T479 owns graph and reverse code-to-rationale navigation, P120 owns anchors/history, P122 owns projections/retrieval, and K2 owns provider sessions. This task binds those existing contracts to the editor; it does not recreate any of them.

Implementation responsibility:
- Register Monaco provider hooks for available hover, definitions, references, signatures and diagnostics through K2 APIs; gate each operation on verified capability and document version.
- Resolve graph/task/decision CodeLinks through E1 when opening the editor; display ambiguous or stale candidates instead of assuming old file:line locations remain valid.
- Connect the editor selection and source range to the graph/context API and T479 inspection surface, exposing prior tasks, accepted decisions, requirements/rules and verification provenance.
- Support the T002/T010/T020 case: current signature, prior parameter purpose and the recorded slim/functional constraint appear through the shared code target even when tasks lack direct links.
- Keep current disk, unsaved draft and historical baseline contexts visibly distinct; do not query a live provider on old text and present the response as historical evidence.
- Verify degraded/no-provider operation, coordinate conversion, cancellation, large-reference pagination and stale-result rejection; preserve existing graph/hierarchy routes and accessible focus behavior.

Acceptance and evidence:
- Definition/reference navigation and context panels reuse the same provider and canonical identities seen by agents.
- The worked T002/T010/T020 case is navigable from both planner and code without inventing missing rationale.
- Unavailable/stale/partial analysis is explicit; historical source and draft context cannot be mistaken for current verified results.

Read before editing:
- packages/plan-web-ui/src/routes/task-detail/route.tsx:108
- packages/plan-core/src/api-v1.ts:343
- packages/plan-server/src/entity-events.ts:1
- packages/plan-server/src/serve.ts:185

Detailed discussion contract:
- The differentiator is code plus project intent: LSP contributes technical results while approved decisions and conventions come from canonical planner knowledge.
- T479 remains the owner of graph inspection; this task owns editor bindings and cross-navigation. A selected code region can be shown with relevant evidence without asserting that the model understood the whole project.

Execution dependencies: P127(F025)/T486, P126(F025)/T485, P123(F025)/T479. Requirement aliases: BR19, BR20, BR07, BR09, BR12, BR13, BR14, BR15. Full design: .planner/docs/agent-brain-editor-and-project-identity.md.

Preserve canonical planner IDs/decision ownership, phase-scoped handoffs, existing settings, atomic session ownership, warning-only no-task behavior and shared versus worktree-local runtime boundaries. Read existing source precedents and applicable Guidelines before coding. File:line entries above are navigation evidence inspected on 21 October 2026, never durable identity; source hashes are recorded in the supporting document. Verify current code before implementation. Use task checklists rather than creating tasks per step. This registration does not start implementation, install dependencies, commit or publish.

Checklist:
- [ ] Register Monaco provider hooks for available hover, definitions, references, signatures and diagnostics through K2 APIs; gate each operation on verified capability and document version.
- [ ] Resolve graph/task/decision CodeLinks through E1 when opening the editor; display ambiguous or stale candidates instead of assuming old file:line locations remain valid.
- [ ] Connect the editor selection and source range to the graph/context API and T479 inspection surface, exposing prior tasks, accepted decisions, requirements/rules and verification provenance.
- [ ] Support the T002/T010/T020 case: current signature, prior parameter purpose and the recorded slim/functional constraint appear through the shared code target even when tasks lack direct links.
- [ ] Keep current disk, unsaved draft and historical baseline contexts visibly distinct; do not query a live provider on old text and present the response as historical evidence.
- [ ] Verify degraded/no-provider operation, coordinate conversion, cancellation, large-reference pagination and stale-result rejection; preserve existing graph/hierarchy routes and accessible focus behavior.
- [ ] Verify: Definition/reference navigation and context panels reuse the same provider and canonical identities seen by agents.
- [ ] Verify: The worked T002/T010/T020 case is navigable from both planner and code without inventing missing rationale.
- [ ] Verify: Unavailable/stale/partial analysis is explicit; historical source and draft context cannot be mistaken for current verified results.

#### P127(F025)/T488 — Open source locations in the preferred external editor

Outcome: A user can open the current file or resolved symbol in a locally configured external editor, including line/column when supported.

Existing state: The current Web UI has no discovered preferred-editor launcher. packages/plan-server/src/serve.ts:1564 exposes existing UI configuration and AppShell receives local server context; runtime settings must stay local rather than becoming shared project policy.

Implementation responsibility:
- Add a local user/machine editor preference and extensible launcher definitions with executable/argument templates or supported URI mechanisms; do not restrict the product to a fixed editor list.
- Resolve the current CodeLink/file/worktree and location before launch; pass structured arguments through a validated launcher without evaluating browser-provided shell commands.
- Provide Open in preferred editor from the workspace and relevant source links, with actionable missing-launcher or unsupported-position diagnostics.
- Make the target machine explicit: a server-host launcher opens on that host, while browser-device opening requires an explicitly supported local handler and path mapping; never claim a remote path is automatically local.
- Detect dirty editor drafts before opening the disk file and make save/open behavior explicit; observe later external edits through K1 without silently overwriting the browser draft.
- Verify path escaping, spaces, Unicode, long refs resolved to locations, unsupported OS/editor configuration and host mismatch with stubbed launchers in temporary fixtures; retain project identity and current human controls.

Acceptance and evidence:
- A configured editor opens the correct project/worktree file at the resolved location; launch arguments preserve literal paths.
- Preferences remain machine-local and the user can configure a compatible editor without changing core.
- Remote/LAN use and unsaved drafts never silently open or present the wrong machine/file version as current.

Read before editing:
- packages/plan-server/src/serve.ts:1564
- packages/plan-server/src/server-record.ts:1
- packages/plan-web-ui/src/lib/api.ts:1
- packages/plan-core/docs/runtime-boundaries.md:1

Detailed discussion contract:
- Opening an editor is an explicit human action. An editor preference is not a project-wide Accepted Decision and must not leak machine-specific paths into canonical configuration.
- File:line is a launch position only; durable source identity is resolved before constructing the launch request. This planning task does not install or launch any editor.

Execution dependencies: P127(F025)/T486. Requirement aliases: BR21, BR07, BR18, BR16. Full design: .planner/docs/agent-brain-editor-and-project-identity.md.

Preserve canonical planner IDs/decision ownership, phase-scoped handoffs, existing settings, atomic session ownership, warning-only no-task behavior and shared versus worktree-local runtime boundaries. Read existing source precedents and applicable Guidelines before coding. File:line entries above are navigation evidence inspected on 21 October 2026, never durable identity; source hashes are recorded in the supporting document. Verify current code before implementation. Use task checklists rather than creating tasks per step. This registration does not start implementation, install dependencies, commit or publish.

Checklist:
- [ ] Add a local user/machine editor preference and extensible launcher definitions with executable/argument templates or supported URI mechanisms; do not restrict the product to a fixed editor list.
- [ ] Resolve the current CodeLink/file/worktree and location before launch; pass structured arguments through a validated launcher without evaluating browser-provided shell commands.
- [ ] Provide Open in preferred editor from the workspace and relevant source links, with actionable missing-launcher or unsupported-position diagnostics.
- [ ] Make the target machine explicit: a server-host launcher opens on that host, while browser-device opening requires an explicitly supported local handler and path mapping; never claim a remote path is automatically local.
- [ ] Detect dirty editor drafts before opening the disk file and make save/open behavior explicit; observe later external edits through K1 without silently overwriting the browser draft.
- [ ] Verify path escaping, spaces, Unicode, long refs resolved to locations, unsupported OS/editor configuration and host mismatch with stubbed launchers in temporary fixtures; retain project identity and current human controls.
- [ ] Verify: A configured editor opens the correct project/worktree file at the resolved location; launch arguments preserve literal paths.
- [ ] Verify: Preferences remain machine-local and the user can configure a compatible editor without changing core.
- [ ] Verify: Remote/LAN use and unsaved drafts never silently open or present the wrong machine/file version as current.

### Additional accepted decisions

#### AD11: Use Monaco for the desktop source-code workspace

Decision: Use Monaco Editor for the integrated file explorer, editable source tabs, syntax coloring and diff. Source editing/saving is included. Mobile code editing is not a deciding acceptance requirement; preserve existing planner responsiveness and document actual limitations.

Rationale: The user selected an experience like the adjacent file explorer and clarified that mobile source editing is not a meaningful reason to prefer CodeMirror. Monaco is the resulting choice.

Implementation notes: Load Monaco/workers/language assets on demand and ship them locally; retain the lightweight existing Markdown workflow. Choose a compatible tested integration stack and versions without assuming VS Code extension compatibility. Do not install dependencies or implement product code as part of this planning update.

#### AD12: Share analysis through one compatible runtime owner

Decision: Agents and the editor use the same analysis service. Reuse one compatible language-server runtime for the same project/worktree, provider/version and effective configuration; the frontend does not start a duplicate process by default.

Rationale: The user asked whether Agent Plan and the embedded editor would run two LSP servers. The agreed architecture explicitly avoids duplication merely because both consumers exist.

Implementation notes: Extend P121 contracts with broker-owned upstream sessions, atomic cross-host-process ownership/reuse, cancellation, consumer lifecycle and named document revisions/overlays. Monaco provider hooks call common APIs; an optional frontend LSP client/gateway must not independently initialize a competing server. Separate keys may require separate runtimes, and provider capabilities remain dynamic.

#### AD13: Put project identity first in browser page titles

Decision: The actual project name must identify the overview and prefix entity-detail browser titles. Task detail follows ProjectName - TaskID [Short task title]; feature and phase details follow the same project-first convention.

Rationale: The user cannot distinguish projects when tabs show only Agent Plan or a task title. Both reported title failures must be corrected.

Implementation notes: Use one route-aware title owner, preserve known project context through navigation/live renames/errors, retain full variable-width refs and avoid stale cleanup restoration. The bracketed description means the short entity title, not the full Markdown task description.

## User scenarios and evidence matrix

| Case | Scenario | Required observation |
|---|---|---|
| S01 | Several phase handoffs after a long absence | Purpose/state/blockers are understandable and recommendation agrees with current canonical state. |
| S02 | A → B → C detours with temporary phase completion | Unwind C → B → A; preserve unavailable returns and session recovery. |
| S03 | Global priority versus current phase | Higher global ready work wins; active work, returns, ownership and dependencies remain authoritative. |
| S04 | Compaction, restart, same session with lost context | Restore actual required content; do not trust timestamp-only memory. |
| S05 | Concurrent callers and ownership recovery | No foreign-owner success, duplicate claims or recovery of a live caller. |
| S06 | Duplicate capability and task proliferation | Reuse open/completed ownership, current checklist or ideas inbox as appropriate. |
| S07 | Reference shift/refactor/copy/delete/parse failure | Resolve or explicitly expose candidates/ambiguity/unknown; preserve history and reject stale/foreign indexes. |
| S08 | Unsupported language or missing provider configuration | Keep planner/text use available; do not report unknown usages as zero. |
| S09 | Empty folder with undecided then agreed stack | Discussion works before language detection; prerequisites control actual analysis readiness. |
| S10 | T002 → T010 → T020 across unrelated phases | Recover current signature, prior parameter purpose and durable slim/functional constraints. |
| S11 | Large task with dirty baseline and overlapping work | Trace the changeset/module outcome without false attribution or per-function manual notes. |
| S12 | New component that compiles but violates local architecture | Use the correct precedents; detect/report missing analysis and reject nonconforming completion in review. |
| S13 | Dynamic provider registration and polyglot fixtures | Enable an additional language through metadata/configuration on an existing adapter; verify real providers from unrelated families, configuration and per-operation coverage, with explicit FFI/JNI/dynamic/external limits. |
| S14 | Requirements and graph API/event compatibility | Requirement links remain discoverable, projections preserve IDs and clients remain compatible. |
| S15 | Supervisor graph/review/setup workflows | Show actionable provenance, coverage and freshness while preserving hierarchy and role boundaries. |
| S16 | Freshly packed installed artifacts and real harness entry points | Verify actual supported runtime paths and exact fingerprints, with bounded logs and no release side effects. |
| S17 | Variable-width feature, phase and task references | Exercise 999→1000, 9999→10000 and larger valid values on isolated fixtures: allocation, composite/bare refs, numeric ordering/search, dependencies, parked returns, API/MCP/Pi, export and Web UI; preserve identity and reject partial or incorrect-parent matches. |
| S18 | Project identity across browser navigation | Overview and all detail routes retain the known project name; task format is ProjectName - TaskID [Short task title], including live renames, back/forward and known-context error/loading. |
| S19 | Editable Monaco workspace with concurrent writes | Open files/tabs, edit and compare; stale saves preserve draft/current content and source changes invalidate affected evidence. |
| S20 | Shared analysis and explicit document versions | Simultaneous supported agent/editor consumers reuse one compatible provider process, including startup races, disconnect/restart and explicit saved/draft snapshots. |
| S21 | Preferred editor and target-machine semantics | A resolved file opens through local configured launchers with literal paths and supported positions; remote machines and unsaved drafts remain explicit. |

## Source catalog

Positions are baseline navigation hints, never permanent identity. Before editing, reread the named symbol/module and validate the current source. The file hash identifies what was inspected, not semantic continuity.

| Key | Source at baseline | Symbol | SHA-256 |
|---|---|---|---|
| schema | packages/plan-core/src/schema.ts:85 | export const AcceptedDecisionSchema | 5974d2b4ef5c27531c16c4679cbfb13fac1a4f4a67919917d7b0f1bc420aade2 |
| store | packages/plan-core/src/plan-store.ts:3399 | async createAcceptedDecision | ff7fd84a652c248fa0f883000be02e0d841a9485bcf7a73f2e9c974ce8f6a13c |
| ownership | packages/plan-core/src/plan-store.ts:3502 | async claimTask | ff7fd84a652c248fa0f883000be02e0d841a9485bcf7a73f2e9c974ce8f6a13c |
| selection | packages/plan-core/src/task-selection.ts:283 | export function recommendNextTask | a8d2ba9f84aaf75b419898b37f462f81990ccc46ef1ca505ba590e26968e3c79 |
| recap | packages/plan-core/src/recap.ts:46 | export async function buildRecap | 3d1e6da81194a44133be2ffa8a586069da0d6a84952237aca3051969f22055ca |
| hold | packages/plan-core/src/on-hold.ts:1 | (module) | d64543be2900c8aaa756c2fcf34282289b5ea6b3ca86c20fc03eb76886e44cb8 |
| focus | packages/plan-core/src/session-focus.ts:1 | (module) | efeeaf1c0bd6268bd5b57ae67ce5e436cab4ea66c39034227c012f71709dc0f4 |
| taskContext | packages/plan-core/src/task-context.ts:175 | export function buildPhaseContextBlock | 4eac899e1fcd10573644ab05508cd2029b2a5362524eed06c5df9f426b7bb3a6 |
| projectContext | packages/plan-core/src/project-context.ts:357 | export function buildProjectContextLoadReply | 915a05082a4c4c36bdbb51c542781d58f8c8724b806a58d324ffadfdbcd6e4c1 |
| reads | packages/plan-core/src/read-tracking.ts:28 | type ReadState | d2e94bb25498fd0a9bbabc02e4f3ce05e796944c8976994c6184d364dd0c6ce0 |
| rules | packages/plan-core/src/planner-rules.ts:20 | const PROJECT_GUIDELINES_RULE | 14f082f0dba87c1b657ecbc6084fcddab2430ee6acd09c6e803fe928cd64dcae |
| skill | packages/plan-core/planner-skill.md:42 | ## Lifecycle-first context protocol | 7ab07d0b0cc661e64f8cb5d930b79b607ccf371b5bc12ee17a4d0f8d4215139f |
| guard | packages/plan-core/src/guard-decision.ts:312 | export function noTaskWarning | 1d0dc2517aa21d9c3b05680213f93ccf64899e55bcb14fea8dfa63f09da7b0bc |
| completion | packages/plan-core/src/task-completion-gate.ts:58 | export function evaluateTaskCompletionGate | 9f2fa5d65bef5085fd6189348c4c0a30b67e9fd221e8e396542a1b6f6920c4f6 |
| handoff | packages/plan-core/src/handoff-context.ts:1 | (module) | ed1f411831e3258b202395a8daf892e1de63e7d508da7584dd4d984112a64ea9 |
| freshness | packages/plan-core/src/description-freshness.ts:1 | (module) | 30f9cbd69e161380cb861c846e676a038ffd462f07e46db05f2567e2a7a477f4 |
| coreApi | packages/plan-core/src/api-v1.ts:343 | export function buildApiV1Model | d26d55905771d106fda58a6d637dbb1a333bc3d22d11c97bb0f13e278f316c9e |
| events | packages/plan-server/src/entity-events.ts:1 | (module) | 4701eceee5efc585779697e1baa52d4711be44689c42dd1291b3509cb3ae68ff |
| serverApi | packages/plan-server/src/api-v1.ts:1 | (module) | 4e32bc65f878955b2db0a57917b88aaabe57c417675a05d22cd35c051e376c8e |
| server | packages/plan-server/src/serve.ts:1 | (module) | 683ad4cb8d6205323af8b0ddd5ec7e12e8e5f44425f4624101f9c5c87234d8be |
| mcp | packages/plan-mcp/src/index.ts:2263 | server.registerTool("planner-task-start" | 9758764c28657590fa9dfbd8aea40b6009ca04f9031487c8161524483a7c6179 |
| pi | packages/pi-adapter/src/index.ts:1385 | async function scanCodebase | 167ac3fd6b7f4294e47f7c5c9815a585b35abcb7d78ce60f3d712abc03dd0da0 |
| cli | packages/agent-plan/src/index.ts:1 | (module) | 5c296749b47409ffa0ee0d60e213228457ed31d7619f9bf6c2642e4b16261a6f |
| sync | scripts/sync-plugins.cjs:1 | (module) | 0fe436cd0bc45e88abafb29f93833dcb5a58213d2c0dc6bcfc5fcde120dde59a |
| ui | packages/plan-web-ui/src/components/dashboard/work-tree.tsx:1 | (module) | d0905aa2e1d5032144256b898b469e8a16fd2995f6cc330f8ca4f6714b2dafc7 |
| uiRows | packages/plan-web-ui/src/components/dashboard/work-tree-rows.tsx:1 | (module) | d52f0891bc73f7c1ad4438c075e7461baa175bf6dfd98aee46e6d4a47228ea8b |
| uiTask | packages/plan-web-ui/src/routes/task-detail/route.tsx:1 | (module) | 623bdf0a6fe8a74851d59e3b6c5a9c5139962d89aa7c1fa240faa1af61ef47b1 |
| uiProject | packages/plan-web-ui/src/components/dashboard/project-context.tsx:1 | (module) | 0bfb761029ffd0818cfb76f16699b4944c2012a50715a7d499048e998c7682ed |
| boundaries | packages/plan-core/docs/runtime-boundaries.md:1 | (module) | cd4157af1cd51b5157c8cd70defc6dbdca6d84b71688298d05fa1c3aec6aaf1a |
| verify | package.json:35 | verify:final | 89660aebbc87b44f160552bfcefd0a270c8fe09e13768a7b073230be86a1631e |

## Remaining technical choices

- Graph engine/storage and package/module boundaries must be selected from evidence; Graphify is a capability reference, not an approved mandatory dependency.
- Choose versioned provider interfaces/versions, supported platforms and installation/update policy in F; do not assume every tool must be installed.
- Any new write-denial policy needs an explicit scope decision compatible with the existing warning-only no-task guard.
- Qualitative conformity review cannot be replaced by a read receipt or a universal semantic-proof claim.

## Registration and verification

1. Verify repository/branch and unchanged existing planner ownership. Use a project-scoped MCP server with the correct root. Never initialize a new planner in the chat folder.
2. Create one feature, nine phases and twenty-two tasks via public mutations. Read back allocated refs and IDs, persist dependencies and phase discussions, and leave all work planned.
3. Create seventeen outcome requirements with actual phase links, ten single-owner decisions and append the working rules without replacing existing Guidelines. Use exact-title/identity checks to avoid duplicates when resuming a partial import.
4. Save this supporting design under `.planner/docs/agent-brain-plan.md` and attach the feature description reference. Preserve the canonical/local runtime split.
5. Read back all new entities and verify counts, containment, priorities, acyclic dependencies, requirement links, decision owners, complete text and unchecked task steps. Verify pre-existing features/phases/requirements and existing Guidelines/decisions are preserved.
6. Query recommendation to identify the first ready planned task; do not start it. No implementation, commit, push, PR, installation or release is part of registration.



## Full discussion contracts supplement

The initial plan described independent outcomes and registration. This supplement restores the concrete mechanisms and examples from the discussion. Read [the complete technical handoff](agent-brain-registration-handoff.md) before registering or implementing this plan. The structured payload task descriptions now include the contracts below; the operational planner remains authoritative after registration. These are discussion contracts, not proof of implementation or a frozen choice of proposed schema fields.

### A. Baseline and acceptance contracts

#### A1. Reproduce the reliability failures on isolated fixtures

- Reproduce each of the six user reports against the current source and loaded runtime; keep user observations, static findings and established causes distinct.
- F024 already addressed parked-state startability: verify its actual remaining regression rather than implementing an obsolete historical description.
- Include unrelated-task rationale, large dirty-baseline changesets, ignored conventions and unsupported language in the eventual scenario coverage; this task establishes the baseline, not the full implementations.

#### A2. Define one shared next-work and context contract

- Define one shared selection result with candidate, availability/exclusion reasons and caller identity. Work dependency ordering is separate from shared-code or decision-applicability relationships.
- Define actual delivered content, current snapshot and effective context restoration separately from stored session attestations and conformity review.
- Preserve warning-only no-task behavior; any new write-denial scope is a separate open decision.

### B. Deterministic priorities and reliable returns

#### B1. Unify ready-work selection and recommendation explanations

- Evaluate owned active work and pending returns before globally ready feature → phase → task priority; current-phase continuity introduces no hidden precedence.
- Use the same snapshot/caller inputs across recap, recommendations, completion, MCP/Pi/server and UI; respect priority zero, ties, dependencies and ownership.
- An explicit user instruction is distinct from an autonomous recommendation and does not require unnecessary permission ceremony.

#### B2. Preserve and resume nested interrupted work across phase closure

- Persist the full temporary A → B → C return chain with source, reason, checkpoint and resume obligation; unwind through phase completion as well as task completion.
- Retain an unavailable return with its explicit blocker instead of dropping it in favor of unrelated new work.
- Recover only explicitly stopped recoverable callers; never take a live or foreign session merely because its work appears in the same graph.
- 21 October clarification: the formatter pads to a minimum of three digits and core refs.ts already accepts one or more digits. on-hold.ts currently restricts prose refs to 1–4 digits; correct that inconsistency without renumbering entities, truncating a longer reference or confusing composite parents. Retain number-only matching and false-positive boundaries such as HTTP2.

### C. Useful orientation and efficient context restoration

#### C1. Replace handoff choice lists with an actionable resume overview

- Present phase purpose, current and partial state, remaining work, reason for stopping, blockers and practical next action; old refs and first lines do not orient a returning user.
- Bound the overview using reliable metadata/source-backed summaries; full handoff bodies are available on demand rather than all read for every recap.
- Historical/terminal prose and dates do not create actionable claims; recommendation comes from the shared selection result.

#### C2. Coordinate complete context delivery and freshness-aware reuse

- A persisted session ID/read timestamp can survive loss of model context; add explicit restoration and supported lifecycle/compaction refresh rather than relying on that timestamp.
- Reuse only content that is unchanged AND still available in effective model context. Do not drop required rules/requirements/decisions to meet a budget.
- Report partial/truncated/continued delivery and measure characters/bytes/tokens honestly on comparable flows; no percentage saving is established.

### D. Application of existing standards and planning discipline

#### D1. Add evidence-backed source analysis and conformity review to existing workflow

- Read applicable rules and correct architectural precedents, their interfaces/tests and integration points before implementation. Record source/version, relevance, reuse and ownership on the existing task.
- Distinguish approved rules from empirical code conventions; legacy or similarly named components in the wrong layer are not authoritative examples.
- At closeout compare the actual diff with rules/precedents. Automate explicit checkable constraints and record qualitative architectural conformity separately. A receipt/tick/build does not prove comprehension or conformity.
- Make missing/stale analysis observable where integrations allow it. Preserve the warning-only guard and disclose interception gaps; a universal source-write block is not already authorized.

#### D2. Synchronize the operating protocol across harnesses and context-loss events

- Extend the existing canonical core/shared skill distribution and reconcile contradictory tool/rule/prompt wording, rather than creating a Claude-only authority.
- Adapt useful rule/skill/hook patterns from the referenced external project without importing conflicting mandates or claiming a hook reconstructs full context.
- Declare actual delivery/read/write/compaction capabilities per harness; provide explicit restoration where hooks are unavailable.

#### D3. Prevent duplicate capability ownership and unnecessary task creation

- Discover open and completed capability ownership before new task creation; use the existing task checklist for implementation steps and the inbox for unrelated ideas.
- Similarity offers candidates, not proof of duplication. Preserve legitimate independent results and initial planning without arbitrary task quotas.
- No automatic destructive merge/delete or new task for each invalidated code/explanation link.

### E. Code links, task changesets and decision history

#### E1. Implement snapshot-bound code links and safe reference resolution

- Keep CodeLink (canonical entity relation), CodeAnchor (recoverable historical destination/source/configuration evidence) and AnchorResolution (derived result for one current checkout) separate.
- Snapshot identity includes dirty source/configuration and repository/worktree context; current line ranges, names and provider IDs are not permanent semantic identity. Hashes require recoverable historical content.
- Validate expected snapshots on creation/relink. Resolve uniquely when supported; compare declaration/context/binding/configuration/dependency evidence; external rename/move yields candidates requiring verified continuity, and copies can remain ambiguous.
- Keep current-location status separate from meaning/prose review. Unknown/unsupported/parse-incomplete analysis is not a deletion or zero usages; legacy prose references become unverified candidates only.

#### E2. Capture large-task changesets and scoped code ownership

- Track the task changeset automatically at baseline, checkpoints and closeout, then record significant module/interface/function rationale rather than manually explaining every function.
- Separate pre-existing dirty state from observed current-task changes; a final aggregate diff or file watcher alone cannot reliably attribute overlapping tasks/sessions or infer intent.
- Use task/session/repository/worktree, before/after snapshots, observation source, affected areas and explicit uncertain attribution. A commit is not necessarily one task and a task can span commits.
- Connect tasks through shared code areas so later unrelated tasks can retrieve earlier work; maintain progress/rationale through interruption without turning code relationships into artificial scheduling dependencies.

#### E3. Version durable decisions and resolve their applicability to code

- Extend the existing single-owner Accepted Decision model with recoverable revisions and explicit code applicability, not a separate mutable decision authority.
- General coding standards stay in Guidelines; a durable local design choice belongs to an appropriate owner that outlives its originating task and links to the code area.
- For T002/T010/T020 preserve original slim/functional constraints, T010 parameter purpose and current source; continuity across changed signatures needs evidence.
- A newer task or implementation does not supersede a decision. Missing recorded rationale remains unknown; legacy text/Git backfill produces candidates, not invented user intent.

### F. Project setup and multilingual code intelligence

#### F1. Implement capability-based setup for empty and existing projects

- Start from idea/requisites and a declared or undecided stack in an empty folder. Use existing technologies/tools and project decisions; later manifests validate rather than silently choose the stack.
- The extensible manifest/catalog contract describes provider identity, language selectors/versions, platform, interface, capabilities, prerequisites, preparation and probe diagnostics. Inspect configured tools and registered provider metadata; protocols alone cannot enumerate or install every server/indexer in existence. Never reject a language because it is absent from a core enum.
- Separate shared desired configuration, local executable/tool caches and per-checkout index state. Avoid injecting analyzer dependencies into the user application.
- Planning/text/structural/semantic options activate only needed tools. A binary or IDE extension is insufficient: validate actual configuration and results before marking analysis ready.
- Persist the selected provider and desired capabilities in shared configuration; keep local executable paths and indexes separate. Re-probe after tool/configuration changes. The agent explains and invokes a deterministic setup result instead of inventing installation commands or silently selecting the project language.

#### F2. Discover and configure analysis providers through shared adapters

- Discovery uses extensible registered manifests plus configured compatible tools and probe results. Each entry declares languages/versions, interface, capabilities and prerequisites; the catalog is data, not an exhaustive language enum compiled into the planner domain.
- Separate adapters for index ingestion, live queries and syntax normalize common evidence while retaining their different capabilities. An LSP executable or SCIP file is not proof of every operation being available.
- Persist provider/configuration/snapshot provenance and coordinate encoding with results. A TypeScript host can invoke a provider for any compatible language; its compiler does not analyze that language.
- A fixture must add a language/provider entry after initial setup using the existing adapter contract and obtain real results without changing core. Unknown metadata/protocol and missing prerequisites yield explicit diagnostics rather than invented preparation commands.
- The earlier 11-case TypeScript proof is historical local evidence only and does not certify this provider contract or other languages.

#### F3. Verify dynamic provider coverage and mixed-language boundaries

- Validate provider configuration and usable output rather than executable presence. Rust, Java, C/C++, JavaScript, TypeScript and other languages are illustrative fixtures, not a closed rollout sequence or whitelist.
- Use real tools from unrelated families and an extension fixture for a newly configured language. Capture normalized definitions/references only when supplied; record structural-only or unavailable capabilities separately.
- Use separate providers for mixed source areas and retain per-area/per-operation coverage. Combining graphs does not create FFI/JNI/network/generated-code edges.
- Unsupported or incomplete analysis retains planning/text retrieval and explicit source links. Agent-proposed relationships are labeled inference, not compiler-resolved facts. Adding a genuinely new protocol adapter is distinct from configuring another language on an existing adapter.

### G. Unified graph, contextual retrieval and freshness

#### G1. Build a provenance-aware graph projection and query API

- Project existing canonical containment, requirements/phase links, dependencies and decisions, plus code/changeset/verification relationships with provenance and snapshot identity.
- The graph is derived and rebuildable; do not copy planner status/decision authority into another mutable store. Work dependency edges differ from code usage and decision applicability.
- Account for missing Requirements in current API/event projection and evolve contracts compatibly. Search/neighborhood/path results explain evidence and coverage, not merely graph proximity.
- Graphify is a capability reference, not an already selected graph engine/database; choose exact storage/interfaces from a bounded actual corpus.

#### G2. Deliver global orientation and impact-scoped implementation context

- Deliver a source-backed global project/module orientation, then deep context for the task and relevant impact boundaries; do not promise the model instantly knows the entire repository.
- Resolve ambiguous targets explicitly and retrieve current source, scoped constraints, prior changesets/rationale, appropriate precedents, consumers/interfaces/dependencies and tests.
- T020 must discover T002/T010 through their shared code destination even across unrelated phases; large tasks start from module responsibilities/integration flows instead of only one named function.
- Context packets expose mandatory delivery, snapshot/scope, coverage, missing/stale/not-yet-retrieved information and continuations. A receipt is not comprehension or conformance proof.

#### G3. Refresh impacted context and manage review evidence over time

- Invalidate affected resolution/context/review when relevant source, binding, configuration, known dependency or text changes; unchanged function text alone does not prove unchanged meaning.
- Begin with correct on-demand snapshot validation and bounded batches/cancellation; watchers are an optimization rather than authority on freshness.
- Review shows historical baseline, diff, current source and original decision, and records source/text versions plus observations. Expected fingerprints prevent approving an unseen newer state.
- Update factual text through its actual owner; explicit decision changes preserve approved history. Collect obligations in existing relevant work instead of generating automatic new tasks.

### H. Supervisor UI and graph exploration

#### H1. Add graph navigation and reverse code-to-rationale inspection

- Improve existing reliability views before graph work, then add graph inspection while preserving hierarchy/routes and canonical identity.
- Use focused neighborhoods/paths, provenance and coverage instead of requiring a giant whole-project visualization for normal use.
- Support code → prior tasks/decisions/usages, current location versus baseline and partial/stale/unknown states; reuse real UI precedents and regenerate both tracked bundle consumers.

#### H2. Expose setup, context analysis and review state in supervisor workflows

- Expose empty/undecided/missing/configuration-incomplete/indexing/ready/stale setup state with actual next actions.
- Show source precedents, convention/conformity evidence, delivered context, task changesets and review obligations; no model-comprehension score.
- Keep current-location confirmation distinct from review of architectural meaning and use expected snapshots for mutations. Preserve human-supervisor versus agent governance boundaries.

### I. Compatibility, installed validation and operating documentation

#### I1. Verify migrations, invariants and complete cross-surface scenarios

- Validate old/new planner migration and granular atomic operations without losing IDs, handoffs, approved decisions, checkpoints, requirements or dependency edges.
- Run the full discussed scenario matrix with actual coverage and non-success/error handling; do not equate an entity count or handler presence with complete behavior.
- Cross-language, text-only, mixed-repository and context-loss paths need concrete evidence. Unobserved/unsupported behavior remains explicitly unverified.
- Use isolated fixtures with counters near boundaries, not thousands of real planner entities. Minimum three-digit padding is compatible with F001 and F1000, P10000(F1000)/T100000 and F1000/P10000/T100000. Preserve UUIDs/shortIds/history, validate parent mismatches and full-token boundaries, prevent numeric truncation/rounding, and define the supported safe-integer range explicitly. MT-xxx requirement macro-task limits are a separate model and are outside this requested F/P/T change.

#### I2. Validate installed artifacts and publish the operating guide

- Verify fresh packaged entry points and actual runtime/source fingerprints using the existing bounded gate/smoke process; workspace tests alone do not establish installed behavior.
- Document the complete empty-folder/provider/fallback/context/traceability/review workflow and real limitations for the next agent.
- Record revision-bound test/evidence links and a future AgentTest seam; a separate autonomous testing product, publishing and unapproved commits/PRs are outside scope.

## Parent and closeout reconciliation from the previous editor expansion (historical)

Start from an idea or existing repository and dynamically resolve, configure and validate compatible analysis providers for its actual languages.

Current state: extend existing Agent Plan functionality; see each task for the verified starting point. This phase follows E and owns only the outcomes below.

Outcomes:
- Support empty folders and undecided stacks.
- Support an open, provider-driven language set through extensible metadata/configuration and shared adapters, with per-area/per-operation coverage made explicit.

Tasks and boundaries:
- F1: Implement capability-based setup for empty and existing projects. A shared setup manager using declared stack decisions and detected actual configuration, with reusable managed tools and clear readiness states.
- F2: Discover and configure analysis providers through shared adapters. Usable language-independent provider adapters with discovery, configuration and normalized analysis driven by compatible provider metadata and actual capabilities.
- F3: Verify dynamic provider coverage and mixed-language boundaries. Reproducible provider extensibility and mixed-project coverage, including real configuration requirements, partial support and explicitly unresolved cross-language boundaries.

Preserve canonical planner identity, phase-scoped handoffs, derived status and session ownership. Read existing code precedents before implementation; use the current task checklist for steps. Source locations are navigation evidence at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231, not permanent anchors.

Existing source entry points:
- packages/agent-plan/src/index.ts:1 — (module)
- packages/pi-adapter/src/index.ts:1385 — async function scanCodebase
- packages/plan-core/src/schema.ts:85 — export const AcceptedDecisionSchema
- packages/plan-core/docs/runtime-boundaries.md:1 — (module)

Acceptance: Idea → stack discussion → scaffold/configuration → analysis activation works without guessing a language. One shared project configuration resolves compatible providers locally across agents/machines; adding a language to an existing adapter needs provider metadata/configuration rather than a planner-core code change. Unavailable analysis never blocks planning and is never reported as zero references. Real tools from at least two unrelated language families pass the same applicable link/query contract; the selected fixture languages are examples, not a product whitelist. A compatible provider for an additional language can be registered/configured without modifying planner-core language dispatch; stale tool/configuration/source snapshots are rejected or explicitly refreshed. Only verified provider operations are advertised; syntax parsing is not semantic reference resolution, and no provider implies a complete runtime graph or silent refactor continuity. Provider support claims identify exact tested tool/version/configuration and source-area coverage; a language outside the initial fixture set is enabled through the existing adapter contract. A partly supported repository remains usable with per-area and per-operation coverage; a syntax-only provider never advertises semantic usages. Missing providers or build prerequisites yield unknown/incomplete analysis and text/planning fallback, never a false absence of usage or automatic FFI/JNI/service edges.

Design detail: .planner/docs/agent-brain-plan.md. Product requirements: BR07, BR10, BR11, BR13, BR14, BR16.

Full technical contracts and worked cases are in .planner/docs/agent-brain-registration-handoff.md. Preserve them in execution context; counts/titles alone do not satisfy this phase. Associated task descriptions include their detailed discussion contracts.

Shared-runtime extension: P126(F025) extends these provider adapters with revision-aware source access and one compatible multi-consumer analysis runtime. Provider discovery, language extensibility and conformance remain in T473-T475. Monaco does not create another language-server process by default. See .planner/docs/agent-brain-editor-and-project-identity.md.

Expose the same scheduling, context and traceability evidence that agents receive.

Current state: extend existing Agent Plan functionality; see each task for the verified starting point. This phase follows G and owns only the outcomes below.

Outcomes:
- Make graph navigation, provenance, setup readiness and review obligations understandable.
- Preserve existing hierarchy, routing, human-supervisor semantics and live updates.

Tasks and boundaries:
- H1: Add graph navigation and reverse code-to-rationale inspection. Accessible navigation between requirements, work, code usages and decisions, with source-backed explanations and preserved hierarchy.
- H2: Expose setup, context analysis and review state in supervisor workflows. A coherent inspector for analysis readiness, pre-implementation evidence, changesets and explicit review/relink operations.

Preserve canonical planner identity, phase-scoped handoffs, derived status and session ownership. Read existing code precedents before implementation; use the current task checklist for steps. Source locations are navigation evidence at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231, not permanent anchors.

Existing source entry points:
- packages/plan-web-ui/src/components/dashboard/work-tree.tsx:1 — (module)
- packages/plan-web-ui/src/components/dashboard/work-tree-rows.tsx:1 — (module)
- packages/plan-web-ui/src/routes/task-detail/route.tsx:1 — (module)
- packages/plan-web-ui/src/components/dashboard/project-context.tsx:1 — (module)
- packages/plan-server/src/api-v1.ts:1 — (module)
- packages/plan-server/src/entity-events.ts:1 — (module)

Acceptance: A supervisor can navigate from a function or module to T002/T010/T020 and the applicable decision. Graph and hierarchy show the same canonical identities and current state. Partial semantic coverage is visibly distinguishable from no usage. A supervisor can see why a task is ready to implement or what evidence is missing. Current-location confirmation is not presented as approval of architectural meaning. Existing settings, routes, content and human controls remain intact.

Design detail: .planner/docs/agent-brain-plan.md. Product requirements: BR01, BR05, BR07, BR08, BR09, BR10, BR11, BR12, BR14, BR15, BR16, BR17.

Full technical contracts and worked cases are in .planner/docs/agent-brain-registration-handoff.md. Preserve them in execution context; counts/titles alone do not satisfy this phase. Associated task descriptions include their detailed discussion contracts.

Monaco workspace extension: P127(F025) owns the editable file explorer, Monaco integration, editor bindings and preferred external opener; this phase retains graph/inspector ownership. P125(F025) owns project-first browser-title fixes. Editor bindings reuse this phase's canonical graph/context contracts and the shared runtime in P126(F025). See .planner/docs/agent-brain-editor-and-project-identity.md.

Verify complete user workflows and leave a reproducible implementation handover.

Current state: extend existing Agent Plan functionality; see each task for the verified starting point. This phase follows H and owns only the outcomes below.

Outcomes:
- Validate migrations, supported harnesses, polyglot analysis and the complete scenario matrix. Ensure variable-width feature/phase/task sequences across supported surfaces.
- Document real capabilities, limitations and the seam with a future AgentTest concept.

Tasks and boundaries:
- I1: Verify migrations, invariants and complete cross-surface scenarios. Reproducible compatibility and workflow evidence over isolated old/new plans and actual supported surfaces.
- I2: Validate installed artifacts and publish the operating guide. A reviewable feature closeout with current architecture/setup/protocol documentation and verified installed behavior, without publishing a release.

Preserve canonical planner identity, phase-scoped handoffs, derived status and session ownership. Read existing code precedents before implementation; use the current task checklist for steps. Source locations are navigation evidence at c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231, not permanent anchors.

Existing source entry points:
- packages/plan-core/src/schema.ts:85 — export const AcceptedDecisionSchema
- packages/plan-core/docs/runtime-boundaries.md:1 — (module)
- package.json:35 — verify:final
- packages/agent-plan/src/index.ts:1 — (module)
- packages/plan-mcp/src/index.ts:2263 — server.registerTool("planner-task-start"
- packages/pi-adapter/src/index.ts:1385 — async function scanCodebase
- packages/plan-server/src/serve.ts:1 — (module)

Acceptance: All required scenarios have concrete evidence or a named unresolved blocker. No migration fabricates semantic links or loses approved history. Normal reads do not silently rewrite canonical knowledge; allocation, full reference resolution, numeric ordering/search, dependencies, parked returns, API/MCP/Pi, export and Web UI preserve identities beyond three and four digits. Final evidence identifies exact package/source fingerprints and tested supported environments. A new agent can follow the documented workflow using the planner, existing sources and explicit uncertainty. No release/publish claim is made without the corresponding authorized action and registry evidence.

Design detail: .planner/docs/agent-brain-plan.md. Product requirements: BR01, BR02, BR03, BR04, BR05, BR06, BR07, BR08, BR09, BR10, BR11, BR12, BR13, BR14, BR15, BR16, BR17.

Full technical contracts and worked cases are in .planner/docs/agent-brain-registration-handoff.md. Preserve them in execution context; counts/titles alone do not satisfy this phase. Associated task descriptions include their detailed discussion contracts.

Expanded closeout: all editor-workspace work must be verified before feature closeout. T481 additionally depends on P127(F025)/T487 and P127(F025)/T488; their prerequisites include P125(F025)/T483, source APIs and the shared runtime. Cover project identity, editable Monaco/diff, save conflicts, single compatible provider ownership across consumers, explicit document versions and preferred-editor target-machine semantics. T482 covers fresh local Monaco workers/assets, installed behavior and current operating documentation. See .planner/docs/agent-brain-editor-and-project-identity.md.

Registered editor completion prerequisites: P127(F025)/T487 and P127(F025)/T488 must finish before T481; all three new phase outcomes are included in this closeout.

Final task requirements are the canonical T481/T482 descriptions, including persisted dependencies on T487/T488 and three added verification checklist items. Earlier registration instructions/counts are historical instructions and must not be replayed to create duplicate entities.


## Complete current phase/task ownership map

| Phase | Tasks | Current title |
| --- | --- | --- |
| P116(F025) | T461, T462 | Baseline and acceptance contracts |
| P117(F025) | T463, T464 | Deterministic priorities and reliable returns |
| P118(F025) | T465, T466 | Useful orientation and efficient context restoration |
| P119(F025) | T467, T468, T469 | Application of existing standards and planning discipline |
| P120(F025) | T470, T471, T472 | Code links, task changesets and decision history |
| P121(F025) | T473, T474, T475 | Project setup and multilingual code intelligence |
| P122(F025) | T476, T477, T478 | Unified graph, contextual retrieval and freshness |
| P123(F025) | T479, T480 | Supervisor UI and graph exploration |
| P124(F025) | T481, T482 | Compatibility, installed validation and operating documentation |
| P125(F025) | T483 | Project identity and browser page titles |
| P126(F025) | T484, T485 | Code workspace access and shared analysis service |
| P127(F025) | T486, T487, T488 | Integrated Monaco workspace and external-editor navigation |
| P128(F025) | T489, T496, T490 | Shared planner authority and workspace isolation |
| P129(F025) | T491, T492, T493 | Task executions and revision-aware target integration |
| P130(F025) | T494, T495 | Lossless shared-planner migration and durable recovery |

New requirements: BR22 — One authoritative project planner across local worktrees, BR23 — Independent workspace and caller context within a shared project, BR24 — Attributable task executions separate from delivery, BR25 — Revision-aware target availability and delivery views, BR26 — Lossless adoption of a shared planner from existing copies, BR27 — Planner history and recovery independent of code commits, BR28 — Consistent affected hierarchy and dependency context after every change, BR29 — Bounded context cost across all Agent Brain workflows.

New Accepted Decisions: AD14 — One shared planner authority outside code branch copies, AD15 — Planner, code workspace and caller runtime have separate identities, AD16 — A logical task has executions and independent target integrations, AD17 — Current code availability differs from work progress and historical merges, AD18 — Shared-planner adoption requires lossless migration and independent recovery, AD19 — Every mutation reconciles affected context through bounded deltas.

Current scenario matrix includes S22–S29 in the supporting import model and the full mechanisms in the two new handoffs. Earlier source discussion/proof attachments are immutable historical evidence.
