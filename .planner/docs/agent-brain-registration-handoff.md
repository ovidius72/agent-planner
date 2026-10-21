# Agent Brain: registration handoff for codex-agent

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

The user explicitly requested creation of the Agent Brain feature, all planned phases and tasks, requirements, constraints, working rules and agreed decisions in this repository's Agent Plan planner. The user then asked the supervising chat to communicate these instructions to the existing `codex-agent` session. The app messaging tool refused delivery because this session already has an active writer. This file is the concrete handoff; it does not imply that a message was delivered or a feature was registered.

## Previous registered editor expansion (historical)

The previous editor-only F025 scope was **12 phases / 28 planned tasks / 21 requirements / 13 decisions / 33 dependency edges**, with all **229** checklist items unchecked. Read `.planner/docs/agent-brain-editor-and-project-identity.md` for the complete new handover and `.planner/docs/agent-brain-editor-expansion-registration.json` for exact refs. P125/T483 fixes project identity in overview/detail browser titles; P126/T484–T485 owns revision-aware source access and shared analysis; P127/T486–T488 owns editable Monaco, semantic/context bindings and preferred external opening. Monaco is selected, mobile source editing is not a gate, and an editor client must not start a second compatible language server. T481/T482 remain final closeout owners with the expanded acceptance scope. All earlier 9-phase/22-task counts below describe historical registration; do not replay them as new work.

## Planning amendment — 21 October 2026

The canonical F025 amendment keeps the same 9 phases, 22 tasks, 17 requirements, 10 decisions and 21 task dependencies. Language names in historical source documents are examples. P121/T473 owns stack-driven setup and tool preparation; T474 owns extensible provider discovery/configuration and shared adapters; T475 verifies dynamic extension and mixed-language coverage. No runtime setup or product implementation is performed by this amendment.

The open language set comes from versioned provider manifests/catalog entries and explicit compatible-provider configuration. Each entry declares language/version selectors, protocol/interface, supported operations, prerequisites, preparation and probes. Match these against the declared or detected stack, reuse compatible local tools or prepare the selected tools under existing policy, validate effective workspace/build configuration and real results, then expose verified capabilities per source area. Configure a new language on an existing adapter through metadata; a new protocol can need an adapter. No protocol promises a complete discoverable installation catalog. Missing analysis retains planning/text retrieval and explicit limits.

Feature, phase and task numbers have a minimum display width of three digits, not a three-digit capacity. Current naming.ts uses padStart(3) and refs.ts accepts one or more digits. The concrete exception found during this planning review is on-hold.ts REF_IN_TEXT, which limits recognition to 1–4 digits. P117/T464 owns that parked-return correction; P124/T481 owns allocation/resolution, ordering/search, dependencies, exports, API/MCP/Pi and UI compatibility at 999→1000 and 9999→10000 and larger valid values. Preserve UUIDs, shortIds, existing sequence values and history. Use isolated counter-boundary fixtures and an explicit safe-integer policy rather than renumbering or merely increasing the padding width. MT-xxx macro-task limits belong to a separate model and are outside this requested F/P/T change.

The 20 October registration verification remains historical evidence of the original registration. Current amendment verification is recorded separately; neither report establishes implemented product behavior.

## Assignment and boundaries

Complete **planner registration only** in `/Users/antonio/projects/agent-plan`. Do not start implementing the feature yet. Read `AGENTS.md`, the Agent Plan skill and applicable canonical project context first. The user's request authorizes the necessary planner mutations and supporting documents. No GSD, source implementation changes, AGENTS.md changes, dependency installation, commit, push, PR, release or publication is included.

You own completing this registration. You are not alone in the checkout: preserve other edits and reconcile current content. At handoff time `.planner/SKILL.md`, `.planner/project.json` and `.planner/requirements.json` were already modified after the receiving session's planner load. Do not revert them or overwrite their state from an old snapshot. The supervising chat will avoid concurrent planner writes.

The branch already exists: `feat/agent-brain`, created from refreshed `origin/main` at `c4d0c459f74f5365c9ab8a9fe53ad6d7907a8231`. Verify the current branch; do not create another branch, reset the checkout or merge unrelated work. Its current upstream points to `origin/main`; this does not authorize pushing to main.

## Complete inputs

- Read this handoff in full, including the technical contracts, worked examples and coverage map below. The assignment is not satisfied by importing entity counts and titles.
- [Structured import specification](agent-brain-planner-import.json): feature, phases, tasks, outcome requirements, accepted decisions, Guidelines addition, inspected source catalog and scenario matrix.
- [Full supporting design](agent-brain-plan.md): detailed explanations, task steps and acceptance criteria.
- [Full discussion scope record](agent-brain-discussion-scope.md): the six original failures, corrections to the initial gap analysis and the standards-enforcement findings, preserved in the original discussion language.
- [Full code-link and setup design record](agent-brain-code-links-design.md): the complete earlier implementation proposal, setup flow, resolution algorithm, language-provider boundaries and experiment limits.
- [Recorded anchor experiment results](agent-brain-anchor-proof-results.json): historical evidence from the isolated 11-case TypeScript experiment. This is not a current product test report.
- [Archived experiment source](agent-brain-anchor-proof.mjs): the exact earlier prototype, preserved as reference evidence; it is not production implementation and is not run during registration.
- [Handoff evidence manifest](agent-brain-handoff-manifest.json): source-copy hashes, transferred documents and expected registration counts. Hashes establish artifact identity, not completeness or comprehension.

The two discussion records are source material, not additional operational authorities. They contain earlier snapshot-specific observations and historical registration-state notes. Use their reasoning and preserve the user constraints; revalidate implementation facts against the current checkout. The English contracts below include the later examples about unrelated tasks, large developments and ignored conventions that are not fully developed in the earlier records.

These documents are prepared input, **not a second operational planner**. The canonical `.planner/` entities and decisions remain authoritative. The previous chat's permission blocker and prepared/not-registered notes are historical state: verify actual current access and entities rather than treating them as a fresh failure.

Discover current entities with planner list/show tools before creation. No feature was created by the supervising chat, but another partial import must be resumed without duplication. Keep a map of the import-local keys to actual allocated planner refs and IDs.

## Required registration

1. Create one feature named exactly **Agent Brain — reliable agent workflow and code-aware project memory**, with the complete feature description, workDone/workRemaining and dependencies from the JSON.
2. Create its **9 ordered phases** A–I and **22 tasks**. Preserve every task's rich description, checklist, implementation responsibility and acceptance criteria. All tasks remain planned and all implementation checklist items remain unchecked. Parent statuses are derived; do not set their lifecycle status directly.
3. Populate phase goals, non-goals, risks, open questions and completion criteria through normal discuss/update operations. Set ordered priorities within the new feature and phases without reordering unrelated work.
4. Persist all **21 task dependency edges** through validated dependency operations. A1/B1/etc. are local aliases, not allocated task refs. Resolve actual target identities; dependencies must exist in structured data, not only prose. The phase `requires` field is explanatory; the task edges carry executable dependency ordering.
5. Create **17 product/system outcome Requirements**, linking them to the actual specified phase IDs through supported tools. Requirements have no lifecycle status. Coding standards and agent process belong to Project Guidelines rather than Requirements.
6. Register **10 single-owner Accepted Decisions**: AD01 belongs to the project; AD02–AD10 belong to this feature. Reuse an equivalent existing canonical decision instead of duplicating it. Never replace the whole acceptedDecisions array or copy each decision onto every phase/task.
7. Append `guidelinesAppend` **once** to the current canonical Project Guidelines, preserving existing text. Do not replace unrelated project goal/scope, decisions or settings.
8. Attach `.planner/docs/agent-brain-plan.md` as the feature's descriptionRef. Reconcile that document's registration state, historical permission blocker and alias descriptions with the actual completed registration, and include the allocated phase/task refs. Keep the source-bound design and existing entity authority clear.

The structured payload has been enriched with `discussionContract` on every task and matching text in each task description. Preserve this text in the actual entity descriptions. The standalone field is import metadata, not a request to introduce a new field into today's planner schema. The feature and phase descriptions also point to this complete handoff. Do not use an older copy from the previous conversation folder, which predates this enrichment.

Use public planner mutations or supported core-backed interfaces; do not hand-edit canonical entity JSON. The global `agent-plan` CLI and MCP/core runtime were verified as 0.4.9. The receiving session already loaded the correct project planner. If scripting MCP, set the project cwd and `AGENT_PLAN_ROOT` explicitly; do not initialize a new planner in the old conversation folder. Use bounded descriptions and descriptionRef where required by transport limits.

## Critical scope and agreed constraints

- Stabilize the six reported problems first: orientation among multiple phase handoffs, repeated resume-context cost, ignored rules/conventions, lost returns to interrupted work, inconsistent next-work priorities and task proliferation.
- Existing planner memory, Requirements, Accepted Decisions, phase-scoped handoffs, read gates and atomic session ownership already exist. Extend them. Completed F016/F018/F020/F021/F023/F024 are precedents, not open tasks to recreate; recheck current implementations because historical prose can be stale.
- When no active owned work or actionable return takes precedence, use globally ready **feature → phase → task** priority. Current-phase continuity must not override that. Dependencies, blocking and ownership remain availability constraints.
- Code intelligence analyzes the **user project's code**, including Rust, C/C++, Java, JS/TS and unsupported languages. Agent Plan's TypeScript compiler is not a universal analyzer. Validate a common contract across languages and declare actual coverage.
- Empty folders and an undecided language are valid. Start from discussion and declared stack; later source detection checks reality. Activate only needed providers with explicit prerequisites and a versioned setup plan. Unsupported languages retain planner/text capabilities.
- `file:line` is navigation evidence, never permanent identity. Preserve recoverable historical snapshots, current resolution and meaning-review state separately. External refactors and uncertain identity must not silently retarget decisions.
- Large tasks use observed changesets plus significant module/interface/function-scoped rationale, not a manual note for every function. Separate pre-existing dirty and foreign work; ambiguous attribution remains explicit.
- Preserve the T002 → T010 → T020 scenario: later work finds the current signature, previous parameter purpose and still-applicable slim/functional constraints through shared code targets, even across unrelated tasks/phases. Never invent missing user intent.
- Offer a global project orientation and impact-scoped deep context, not a claim of instant complete model knowledge. Expand to relevant usages, interfaces, dependencies, architectural precedents and tests. Distinguish absent, unavailable, stale and not-yet-retrieved information.
- Existing standards are already written. Extend evidence of their reading/application and final conformity review instead of adding repeated instructions. Preserve project decision `7995854e-4109-48aa-b08b-a54bff4d8432`: the no-task guard is warning-only. A new write-denial policy is not implicitly approved. A read receipt, a ticked checklist and a green build do not independently prove architectural conformity.
- Graph engine/storage, provider versions, supported platforms and installation/update policy remain explicit technical choices in their owning tasks. Graphify is a capability reference rather than a mandated engine. Standalone AgentTest is outside this feature; revision-bound test/verification evidence and an extension seam are included.
- Preserve canonical/local runtime boundaries, phase handoffs, single-owner decisions, derived statuses, human-supervisor behavior and explicit dashboard activation. Keep implementation steps in existing task checklists instead of generating more tasks.

## What the user corrected, and why this matters

The initial ProjectBrain discussion overstated what was missing. Agent Plan is not a collection of text tasks with no memory: it already has persistent requirements, feature/phase/task structure, dependencies, Accepted Decisions, coding Guidelines, lifecycle/checkpoint history, phase handoffs and session ownership. A future agent must not start by rebuilding those capabilities or moving them into a new knowledge store.

The missing connection is between that existing knowledge, the actual changing code and the agent's working process. A graph is useful only if its source relationships are recorded, resolved against the right checkout and actually retrieved before work. Showing an attractive graph does not by itself fix forgotten rules, missing rationale or wrong scheduling.

The six reliability reports are user observations, not six proven root causes. Some related behavior was already fixed in completed work, including parked-state resumption in F024. The first phase must reproduce the remaining scenarios on this baseline before prescribing a replacement implementation. Preserve completed work and change the actual failing owner.

The user explicitly rejected permanent `file:line` references, a TypeScript-only analyzer, the assumption of existing source files at project discussion, and a workflow that requires documenting every function of a large task. The user also emphasized that instructions about standards already exist but agents do not follow them. These are design constraints, not optional background anecdotes.

## Reliability behavior to preserve in the registered plan

### R1. Multiple phase handoffs after a long absence

The returning user may not remember which phase to choose. A list of phase refs, dates and first lines is insufficient. The load overview must explain each relevant feature/phase purpose, current and partial result, remaining work, why it stopped, blockers, pending return and practical next action. Use canonical current state and the shared selector to justify the recommendation. A newer handoff is not automatically higher priority.

Keep the overview bounded. Do not reread every complete handoff body simply to orient the user; use reliable metadata and source-backed summaries, with exact full bodies available on demand. Phase handoffs remain phase-scoped. Historical terminal capsules and Markdown prose do not create actionable claims.

### R2. Resume context and token cost

The current resume path can deliver overlapping project, feature, phase, task, requirement, decision and handoff content. Coordinate these deliveries instead of solving the cost by dropping required rules. Reuse only unchanged content still available in the effective model context. Measure actual equivalent flows and distinguish characters, transmitted bytes and tokenizer-derived tokens; no percentage saving has been established.

A session identifier and persisted read timestamp can survive compaction while the model loses the actual content. Maintain a way to restore context after supported reset/compaction events, plus an explicit restore path for harnesses without hooks. A file path, partial chunk or transport-truncated response must not count as full delivery. Refresh affected obligations when their source revision changes.

### R3. Standards that are actually applied

The existing skill and Guidelines already prescribe relevant reads and coding standards. Extend their execution and verification rather than adding another repeated instruction. Before writing, the agent must examine the correct implementation level, analogous components, their interfaces and tests, approved decisions and actual integration points. The rationale for choosing a precedent matters: a similarly named file in the wrong layer is not a valid reference.

Record a short analysis on the current task: sources and versions, applicable explicit rules, observed conventions, relevant reuse, architectural ownership, integration plan, verification and unresolved material conflicts. Observed patterns must remain distinguishable from approved rules. Do not copy legacy exceptions that conflict with current instructions or invent a numerical definition of "slim".

At closeout, compare the actual diff to these sources and obligations. Automated lint/format/type/API/architecture checks can cover explicit machine-checkable constraints. A motivated architectural/convention review is still needed for qualitative choices. A checked box, read receipt or passing build alone is insufficient evidence of conformity.

The existing read gate tracks planner context, not a proof that source analogues were studied or followed. The no-task guard only warns and becomes silent when a task is active. Preserve the approved warning-only policy; do not claim that `task_start` prevents arbitrary writes through other tools. For each harness document what guidance is delivered, what reads/writes are observable and what enforcement actually exists. A new write-denial policy is an explicit open decision.

### R4. Temporary detours and parked work

Persist the source task, motivation, checkpoint, temporary task and obligation to return. For A → B → C, completing C returns to B, then completing B returns to A, including when either completion closes a phase. Preserve the entire caller-owned chain through restart and explicit stopped-session recovery. Never transfer a live caller's work or silently consume another session's pending return.

Temporary interruption, waiting for a dependency, a persistent block and intentional deferment are not interchangeable. If a return cannot run, retain it and explain why. Completion of an unrelated phase must not silently replace it with a newly recommended task. Reuse current parked-status startability work instead of blindly implementing an older description of its bug.

### R5. Global priority

After owned active work and pending returns have been resolved according to availability, the explicit user choice is global ascending feature → phase → task priority. Current-phase continuity does not override higher global ready work. Respect dependency/block/ownership constraints, priority zero, deterministic ties and derived parent state. A task explicitly assigned by the user is distinguishable from the agent's automatic recommendation.

One core result must drive recap, recommendation, completion follow-up, MCP/Pi/server and UI. Include exclusion reasons so a lower-priority ready candidate is explainable. Do not repair only the wording while leaving independent selectors in different surfaces.

### R6. Unnecessary new tasks

Compare requested outcomes against existing open and completed capability ownership. Implementation steps belong in the current checklist or task description. Already assigned work retains its owner; an unrelated idea can remain in the inbox. A genuinely independent result may justify a new task with a concrete reason.

Similarity is a candidate-discovery aid, not proof that two tasks are the same. Avoid destructive automatic merges, arbitrary task-count limits, one task per stale code link and automatic conversion of every design bullet into another task. Preserve identity, history, dependencies and decisions during any deliberate backlog maintenance.

## Technical contracts: existing authority and proposed extensions

The names and field groups below are an implementation proposal from the discussion, not already present schemas or universally approved package/API names. Their required separations and failure behavior must survive; the owning implementation task selects exact fields, module boundaries and versioning after reading current code. Do not promote an example object, tool version or storage engine into an Accepted Decision merely because it appears here.

| Responsibility | Existing authority / proposed extension |
|---|---|
| Work, requirements, Guidelines, decisions, handoffs | Existing canonical planner entities and operations |
| Approved code links and recoverable historical evidence | Validated canonical additions under the existing planner persistence boundary |
| Current index, provider processes and resolutions | Derived local runtime/cache, separated by checkout/configuration |
| Scheduling and context policy | Shared harness-independent core |
| Language analysis | Capability-declared provider modules, independent of agent harness adapters |
| Agent access | Shared core-backed MCP/Pi/server operations |
| Human supervision | Existing UI plus explainable graph/context/review surfaces |

### CodeLink, CodeAnchor and AnchorResolution

These are three distinct responsibilities:

1. **CodeLink** connects the canonical ID of an existing task, requirement or decision to a code destination, with relation and provenance. A decision link includes the canonical decision owner/ID and does not copy its body into the link.
2. **CodeAnchor** stores the observed destination and recoverable baseline: repository identity, initial path/module/container, symbol descriptor where available, observed source/configuration snapshot and fingerprints. It can target a module, file or region without semantic symbol support. An internal UUID names the planner reference; it does not prove eternal semantic continuity of code.
3. **AnchorResolution** is a derived result for a particular current checkout and source/configuration snapshot. It describes resolved location, changed content, candidates, ambiguity, absence or unknown/stale coverage. Its current line range is a navigation result. It does not automatically rewrite the canonical anchor or approve the linked explanation.

An example contract, with illustrative fields rather than a frozen schema:

```json
{
  "id": "link-id",
  "owner": { "kind": "task", "entityId": "canonical-task-id" },
  "relation": "modifies",
  "anchorId": "anchor-id",
  "baseline": {
    "repositoryId": "repository-id",
    "snapshotId": "source-and-configuration-manifest-id",
    "path": "src/pricing/calculation.ext",
    "symbolDescriptor": "provider-specific-descriptor-if-available",
    "declarationHash": "hash",
    "contextHash": "hash",
    "historicalContentRef": "recoverable-content-id"
  }
}
```

A branch name or commit alone does not identify dirty content. A hash without recoverable content cannot show historical source. Use available Git content for committed baselines and a deduplicated immutable content representation where uncommitted evidence must survive. Exact persistence format is a design task within the current canonical/local boundary.

### Link creation and safe resolution

Creation is a source-checked operation: search candidates, read the destination, select the actual target/relation, then validate the owner and expected source snapshot before persistence. A name mentioned in prose is insufficient evidence for an authoritative link. Reject stale selection rather than accepting a target that changed between reading and writing.

For subsequent resolution:

1. Validate repository/worktree identity, provider version/configuration and source fingerprints. An old index cannot produce a result presented as current.
2. Look for an unambiguous current declaration using module/container/kind/name/signature and known baseline evidence. Make body/signature/context changes visible even if a destination is located.
3. Compare relevant fingerprints: declaration, binding/import context, configuration and known dependencies. Any normalization must preserve operators and values. Track comments/documentation separately; ignoring whitespace for positioning does not justify ignoring a changed explanation.
4. If the declaration is missing, seek rename/move candidates using structure, signature, container, references and Git similarity as evidence. Similarity is not proof of logical identity.
5. An external move/rename requires verified confirmation of continuity; several plausible destinations remain ambiguous. A controlled refactor may supply a before/after map verified against the resulting snapshot. Confirmation must use an expected fingerprint so it cannot approve unseen subsequent changes.
6. Adequate coverage with no destination can produce "not found" while retaining historical evidence. Parsing failure, unsupported language or incomplete indexing produces unknown/incomplete, not a false deletion or zero usages.

Keep two axes separate in tools/UI: **where the reference resolves now**, and **whether its linked text/decision has been reviewed against the changed sources**. Finding the same text or symbol does not prove the old architectural rationale remains true. A dependency/configuration change can matter even when the function body is unchanged.

### Explanation freshness and decision revision

Connect factual descriptions, design rationale and review records to their actual supporting source/text versions. A review record should identify who/what performed it, applicable area, observations and source/text fingerprints. If those sources change, prior review is not automatically valid for the new state.

On invalidation show the old baseline, relevant diff, current code and original decision. Update factual descriptions through their actual owner. A changed approved decision requires the established decision process, preserving prior content, provenance and explicit replacement/exception history. A new task, newer timestamp or contradictory implementation does not silently supersede a decision.

Extend the existing single-owner Accepted Decision model rather than creating a second decision store. General coding standards stay in Project Guidelines. A function/module-specific choice belongs on an existing owner that can outlive the task in which it was discussed, with explicit code applicability and origin. Exact revision storage and applicability representation remain implementation work. The current schema/CRUD does not already provide all these mechanisms.

Legacy descriptions, task notes, handoff archives and Git history can suggest missing associations. Present such backfill as candidates with evidence; never manufacture the user's intent or assume a Git commit is the same unit as a planner task. If no recorded explanation exists and no source conversation was acquired, declare the rationale unknown.

## Worked example: T002, T010 and T020

Use this as an acceptance scenario, not as an invented claim about actual project tasks. `calculatePrice` is an illustrative name and the function could be written in any supported language.

| Work | Implementation state | Knowledge that must survive |
|---|---|---|
| T002 | Creates `calculatePrice(items)` | Origin of the function; user's constraint to keep it slim and follow the functional paradigm |
| T010 | Adds `discountPolicy` | Actual before/after signature, purpose of the parameter, expected behavior and observed verification |
| T020 | Requests a further parameter, `currency` | Current implementation plus previous rationale, applicable constraints and impacted uses/tests |

During T002, record project-wide functional conventions in Guidelines only if they are genuinely project-wide. Record a local durable architectural choice on the appropriate existing owner and connect it to the code area. T002 is provenance, not the only location where later work can find the choice. Do not duplicate the decision in every future task.

During T010, the provider or observed diff can reveal a changed signature. The agent must record why the new parameter was introduced; syntax alone does not establish that reason. Capture verified continuity between the previous and resulting destination even if its provider descriptor changes with the signature.

Before editing in T020, resolve the task's intended code against the current source. If the description says only "this function" and several targets fit, disambiguate; a graph cannot repair missing target identity by guessing. From the shared code destination retrieve T002/T010 changes and the applicable canonical decisions, even if they belong to unrelated phases and have no task dependency between them.

The implementation context must include current signature/body, the purpose and behavior of `discountPolicy`, the slim/functional constraint, relevant module responsibilities, known callers/interfaces and appropriate tests. Expand when the change crosses a subsystem or public API boundary. Coverage limitations on dynamic or external consumers remain explicit.

Adding a third parameter is not automatically a violation of "slim". The agent must assess the applicable responsibilities and composition style using actual precedents; it cannot invent an arbitrary line-count/parameter-count rule. If it proposes a change to the approved architecture, follow the existing decision process instead of quietly overwriting the original rationale.

Completing T020 appends its own change/evidence history. It must not rewrite T002 to make its original account look like a description of the latest implementation. Later work sees both historical reasons and the current source, with explicit reviews or unresolved conflicts.

## Large implementation tasks: tracking changes without a manual function journal

The unit of work is the task changeset plus relevant code areas. Detailed modifications come from observed source changes/indexing; an agent records the outcome, responsibilities and significant decisions, not a separate explanation for every edited function.

At task start capture the relevant baseline, including pre-existing dirty state. At useful checkpoints and closeout capture observed before/after changes associated with the task/session and map them to files/modules and, where supported, symbols. Keep historical source recoverable and avoid indexing the whole project after each keystroke. A Git commit can contain multiple tasks, and a task can span commits or uncommitted work.

Proposed changeset fields cover task ID, owning session, repository/worktree, baseline/current snapshot IDs, checkpoint sequence, observed changes, affected areas, attribution source, verification evidence and uncertainty. This is an implementation contract to refine, not a new top-level work hierarchy or mandatory per-function form.

For a pricing subsystem developed across many files, an agent might record that the calculation module owns transformations, the application module coordinates I/O, and a durable decision constrains the calculation area. The index records which symbols belong to each area. Future work on a newly added function inherits only explicitly applicable area decisions; containment alone is not permission to invent a rule.

Parallel edits in one checkout cannot reliably be attributed using a final aggregate diff alone. Use isolated workspaces when appropriate or observations tied to the writing session/tool. Preserve pre-existing/foreign changes and mark uncertain overlap. A filesystem watcher can notice a change without knowing who made it or why. Do not assign every changed file to whichever task happens to be active.

Record significant choices while they emerge, not only at the final summary. Checkpoints must preserve enough progress and rationale for interruption; compaction of the model context must not erase canonical evidence. If a decision was never recorded or its conversation never acquired, later code inspection cannot recover it with certainty.

## Project setup: from an empty folder to usable analysis

Discussion is allowed before source files, manifests or a language exist. Collect goals, requirements, platform constraints and options using existing project fields. Record the chosen stack in `technologies`/`tools` and a project Accepted Decision with rationale when agreed. An undecided stack remains explicitly undecided; neither Agent Plan's implementation language nor the agent runtime decides it.

The conceptual states are: idea/requirements, stack undecided or declared, required tool preparation, scaffold available, configuration validated, analysis active. They are setup conditions, not automatically created planner phases/tasks. When source later exists, detection checks the actual project against the declared stack; discrepancies are clarified or recorded rather than silently changing the decision.

Offer user-facing capabilities such as planning, textual/structural navigation and semantic usage/dependency analysis. A shared deterministic setup manager resolves these capabilities against a versioned provider catalog. The agent invokes and explains that plan rather than inventing install commands on each session.

The catalog/probe contract should cover supported languages and versions, platforms, supplied capabilities, executable/library origin and version, prerequisites, startup/import mode, configuration requirements, tested preparation steps, validation and diagnostics. Check actual compatibility and usability; the existence of a binary or IDE extension is not enough.

| Component | Preparation boundary |
|---|---|
| Common provider client/index reader/model | Part of the Agent Plan analysis module |
| Optional Tree-sitter runtime/grammars | Compatible application/provider assets, not injected into the user's application |
| Language server | Reuse a compatible configured executable or a supported managed copy |
| SCIP-producing indexer | Only the relevant indexer when persistent semantic indexing is needed |
| Generic `scip` CLI | Optional index utility, not a universal language compiler/indexer |
| Rust/JDK/C/C++ toolchains and build context | Separate project prerequisites to detect and respect |

Keep desired shared analysis configuration separate from local absolute executable paths. Managed tools can live in a configurable application data/cache location and be reused across compatible projects; indexes/resolutions remain checkout/configuration-specific. Do not add analysis libraries to the user's `Cargo.toml`, `pom.xml` or `package.json` merely to operate Agent Brain. A later load reuses the setup; a new machine resolves local prerequisites again. Installation/update authorization follows the agreed concrete policy and project rules, not a new prompt for every read.

Validate a real source-backed result and the supplied capabilities before declaring analysis ready. C/C++ may require compile commands/includes/defines; Rust analysis depends on Cargo configuration/targets/features/macros and toolchain context; Java needs its workspace, classpath and compatible JDK. Report missing/configuration-incomplete/indexing/stale/ready states and useful actions. Planning continues while semantic analysis is unavailable.

## Provider roles and unsupported languages

SCIP is a language-independent index format/protocol; actual indexers understand particular languages. LSP is a client/server protocol; language servers supply their actual capabilities. Tree-sitter can supply syntax structure when a compatible grammar is available; syntax or name matching alone does not establish semantic references. These are complementary options, not three tools to install universally.

Examples discussed include Rust tooling such as rust-analyzer; JS/TS tooling and SCIP indexers; clangd/scip-clang for C/C++; and JDT LS or a compatible Java indexer. Specific versions, distribution policy and actual interfaces remain to be selected and tested. A TypeScript host may invoke those tools and normalize their results; its TypeScript compiler does not analyze Rust, C or Java source.

Normalize origins, versions, root/configuration, snapshot identity, symbols/occurrences, coordinate encoding and capabilities. Support only the capabilities a provider actually returns. Declare static/dynamic/generated/external coverage limits. Do not assert identical persistent symbol identity across all refactors or complete runtime call graphs.

A mixed repository can have multiple providers with different coverage. Co-locating indexes does not automatically establish FFI, JNI, network or generated-code relationships. Such edges need explicit evidence, an appropriate integration or clearly labeled declarations/inferences.

If none of these tools supports a language, retain the existing planner, requirements/rules/decisions/history, file inventory, text search, source reads and explicit code links. Store snapshots, excerpts and surrounding context for textual anchors and mark resolution/review limits. The agent may propose relationships after reading the code, but label them as agent inference with source/version instead of compiler-resolved facts. Distinguish "not searched/unsupported/incomplete" from "searched adequately and none found".

Each declared supported provider needs configuration and capability evidence. Validate real providers from unrelated language families and enable an additional language through metadata/configuration on an existing adapter, without changing planner core. Rust, C/C++, Java and JS/TS are non-exclusive fixture examples, not mandatory rollout groups or a whitelist. The isolated TypeScript experiment does not certify these providers or a production fallback.

## Context retrieval and the unified graph

Persist facts in the current authoritative entities and project derived relationships into the graph. Existing planner dependency edges represent work ordering; sharing code or referencing a decision is a different relation and must not create a fake scheduling dependency. A usage graph may contain cycles even when task dependency validation forbids them.

Project requirements and their actual phase links, feature/phase/task containment, dependencies, canonical decisions and applicable code areas, task changesets, code symbols/occurrences and verification evidence. Carry provenance for declared, extracted and inferred relationships, current snapshot/configuration and coverage. A path through the graph is a discovery aid, not proof that an approved decision applies to every nearby node.

The current public API/event projection does not cover every required relationship, including Requirements. Extend those contracts compatibly rather than claiming that rendering today's API payload already produces the complete graph. Keep the graph rebuildable from canonical knowledge and actual source/index evidence; it must not become another mutable authority for task state or decisions.

An incoming agent receives a global orientation: project goals, applicable general rules, major responsibilities/interfaces, important architecture choices and current work/returns. It retrieves deep context for the task and relevant impact boundaries: current implementations, scoped decisions, historical rationale, appropriate precedents, known callers/dependencies, tests and outstanding review obligations.

The information available in external project memory is not identical to what the model has actually read in the current session. A context packet should identify the source/snapshot, selected scope, mandatory delivered content, summaries/continuations, retrieval coverage and missing/stale information. A receipt can establish delivery through an observed interface; it cannot certify comprehension or semantic compliance.

A task naming a single function does not restrict context to its body. A signature change may require consumers, contracts and behavior tests; a large new subsystem starts from module responsibilities and integration flows. Expand based on relevant impact and evidence without promising every possible runtime consumer. Budgeted delivery must expose continuation or missing prerequisites instead of silently omitting required constraints.

For freshness, validate sources on demand first; watch/index incrementally as a later optimization. Relevant code, binding/configuration, known dependency or text changes invalidate the affected context/review. Avoid unnecessary full rescans and keep failed/partial analysis visible. This behavior must work without an open Web UI.

## Supervisor UI: what changes and why

Keep the existing hierarchy and routes. Reliability changes should improve current recap/focus surfaces before the graph phase: understandable resume alternatives, the active task and return chain, why next work was selected, and explicit blockers. The graph is an additional inspection/navigation tool, not the only way to use the planner.

Graph/context surfaces should make it possible to select a code area, inspect current resolved location or historical baseline, navigate to related work and decisions, inspect usages with coverage/provenance and see why a constraint applies. Favor focused neighborhoods/paths and useful filters over making users interpret a giant whole-project picture for every action.

Expose setup readiness, selected implementation precedents, context actually delivered, changeset history and review obligations. Distinguish location confirmation from review of meaning. Candidate/review mutations use expected snapshots; do not approve unseen new code. Show no comprehension score or unverified claim that all code has been analyzed.

Preserve the Web UI's human-supervisor role and the established difference between human controls and agent-only governance. Agents cannot impersonate the supervisor to bypass requirements. Reuse existing React components, routing, state/data conventions and test patterns, and regenerate both intentionally tracked web-ui-dist consumers with UI changes.

## Evidence already obtained and its limits

Earlier source inspection identified shared selectors/recap divergences, inconsistent lifecycle instruction wording, existing return/checkpoint/ownership structures, repeated context payloads, prose code references, shallow codebase scanning and the current API/event gaps. These are source observations at specific snapshots, not proof of the root cause of every user incident. Use the source catalog and current code to revalidate them before implementation.

An isolated experiment read `PlanStore.claimTask` and used the locally installed TypeScript compiler, with source transformations in memory. The historical report states 11/11 cases passed: unchanged source; 80-line prefix insertion; changed body; external rename; external move; multiple identical candidates; deletion; parse failure; a changed direct dependency with unchanged target; stale index; and another-worktree index. It also resolved eight direct project call targets.

That experiment is not an Agent Plan test-suite result, production integration, proof of semantic equivalence or cross-language support. It does not cover full transitive/runtime relationships, persistent refactor confirmation, migrations, all overload/import cases, API/UI flows or natural-language truth. Its token normalization ignored trivia; production design must handle comments/documentation and configuration separately. The recorded result is preserved for provenance and has not been rerun as part of this documentation update.

The implementation plan must validate old/new plan compatibility, preserved IDs and decision ownership, atomic granular mutation, per-session isolation, real error/non-success handling, installed runtime entry points and actual user-visible workflows. Use temporary fixture plans, bounded logs, affected verification during implementation and the repository's canonical gate/packed artifact rules at the appropriate boundary. No product build is required merely to improve this handoff.

AgentTest remains a separate earlier concept. Revision-bound test/evidence links and a future integration seam are in scope. A standalone autonomous testing product or another planner is not silently included. Existing tests do not automatically certify design conformity, and absent semantic analysis does not prevent executing configured project test commands.

## Coverage map for registration and future work

This is a documentation traceability map, not a claim of implementation coverage. A receiving agent must retain the mechanisms, examples and acceptance expectations when registering the supplied tasks, rather than reducing them to generic titles.

| Discussed concern | Prepared work | Required context / acceptance |
|---|---|---|
| Reproduce actual remaining failures | A1–A2 | Existing implementations, completed predecessors, isolated cases and one shared contract |
| Wrong next task and lost parked returns | B1–B2 | Global hierarchy, ownership/readiness, nested returns and phase closure |
| Unclear multi-handoff load | C1 | Purpose/state/blocker/action summaries; no date-only priority |
| Repeated resume context and compaction loss | C2 | Real delivery, freshness-aware reuse, continuation and context restoration |
| Existing rules ignored / inconsistent component | D1–D2 | Appropriate source precedents, explicit versus inferred conventions, final diff conformity, actual harness coverage |
| Excess task creation | D3 | Capability ownership, checklist reuse and non-destructive discovery |
| Stale file:line and explanations | E1, E3, G3 | Three reference responsibilities, snapshot validation, explicit continuity and separate meaning review |
| Large multi-file tasks | E2 | Dirty baseline, observed task/session changesets, scoped rationale and uncertain attribution |
| T002/T010/T020 without mutual references | E3, G2 | Shared code target, current signature, old parameter purpose and durable constraints |
| Empty folder / undecided language | F1 | Discussion first, declared stack, scaffold/configuration readiness |
| Tool preparation and dynamic language support | F1–F3 | Extensible provider metadata/configuration, shared adapters, actual capability probes, additional-language extension and mixed-project fixtures |
| References beyond 999 and 9999 | B2, I1, BR16 | Minimum display width; full numeric recognition, no truncation/renumbering, cross-surface counter-boundary fixtures |
| No available language provider | E1, F1, G2 | Planning/text fallback, source-bound inference and unknown versus absent |
| Graph and cross-code retrieval | G1–G2 | Canonical projection, typed/provenanced relationships, Requirements/API/event compatibility |
| Global orientation versus model knowledge | C2, G2 | Scope-specific delivery and explicit limitations, not instant full understanding |
| Continuous freshness and review | G3 | Dependency/configuration/text invalidation and expected-snapshot review |
| Web UI benefits | B/C/D existing views, H1–H2 new views | Explainable focus, graph inspection, setup/evidence/review state, preserved hierarchy |
| Tests, verification and AgentTest boundary | I1–I2, BR17 | Revision-bound evidence, migrations, installed smoke, partial results and no standalone testing product |

## Decisions that remain open

Preserve user-approved requirements and scope while leaving unresolved engineering choices explicit. The proposed object names/field groups, exact canonical evidence layout, graph engine/store, optional embedding use, provider interfaces/versions/platforms and preparation/update policy require evidence-backed selection in their owning tasks. No graph database or analyzer installation is mandated merely by appearing in an example.

The standards workflow requires observable evidence and conformity review, but a new universal write-denial policy has not been selected. Keep that distinct from existing lifecycle denials and the explicit warning-only no-task guard. Avoid presenting a qualitative review or a delivery receipt as universal semantic proof.

Do not leave these open choices as an excuse to omit the agreed behavior from the plan, and do not fill them with unrecorded assumptions. The receiving agent's current assignment is to register the complete planned work and its open questions. Implementation and any materially changed policy remain outside that immediate assignment.

## Read-back and completion evidence

Read back every new entity. Verify expected counts, actual containment, requirement links, decision owners, complete descriptions, ordered priorities, unchecked/planned work and the 21 acyclic dependency edges. Preserve unrelated existing features/phases/tasks/requirements, current Guidelines and existing decisions. Query recommendation to identify the first ready task, but do not start it.

Also check content, not only counts: the registered descriptions and descriptionRefs must preserve the coverage map above, correct source/model boundaries, the three worked situations (unrelated tasks, large development and conventions ignored), actual source-analysis expectations, provider setup/fallback and decision-versus-prose review. A feature with the expected 9/22/17/10 totals but only generic descriptions is an incomplete registration. Record what was delivered/read and what remains uncertain; do not claim that a reference path alone transfers this context.

This is planner-only registration: meaningful planner integrity checks are required; a full product build/test gate is not necessary. Do not claim source implementation or installed feature verification.

Finish in the receiving chat with the feature ref, allocated phase/task map, requirement/decision counts, supporting document path, validation performed, first ready task and any actual unresolved issue. The supervising chat can read the receiving chat's final status; no cross-chat reply tool is necessary.


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
