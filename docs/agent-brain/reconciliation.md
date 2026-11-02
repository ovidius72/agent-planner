# Documentation and planner reconciliation

> Dated audit (2026-10-29 to 2026-11-01). Current decisions: [decisions.md](decisions.md). Since 2026-11-02 P131 is phase 4 of F025 and four task dependencies were removed.

Inspection date: 2026-10-29. F025 registration finalized: 2026-10-30. This is a review matrix, not a second executable backlog. [The registration report](replan-registration.md) records the completed Agent Plan amendment; Heca-Pro task amendments were registered on 2026-10-31; its new conformance owner is P011(F003)/T047. Before-state source observations below are dated evidence, not current task instructions.

## 1. Inspection boundary

| Repository | Inspected checkout | Existing work preserved |
| --- | --- | --- |
| Agent Plan | `feat/agent-brain`, `030919a7f67e275810c614e4c80a5b2a35b5d5c9` | Modified F025/project/requirements/P124; untracked collaboration specification/P131. |
| Heca-Pro | `develop`, `7ebcd1920c6ee427358c453c5a468c2974531ea9` | Modified feature/project/requirements/skill/P010 and agent-comms report; untracked collaboration document/P019. |

Agent Plan MCP discovery returned F025 priority 24, 16 phases and 40 tasks, all planned. Heca-Pro planner inventory returned 15 done tasks among 46 tasks. The Heca-Pro reads used local canonical JSON as a bounded diagnostic because the connected MCP tools have no project selector and are bound to Agent Plan. No raw planner JSON was edited. Source inspection and archived verification reports are evidence of their stated boundaries; no runtime tests were rerun for this documentation review.

## 2. Treatment of old work

| Finding | Registration policy |
| --- | --- |
| Correct delivery under an older contract | Keep the done task and its original evidence. Add a linked adaptation outcome if necessary. |
| Incorrect original closure | Reopen only with concrete missing original acceptance evidence and a reason. |
| Planned/waiting task | Amend its existing contract/checklist and preserve useful partial implementation. |
| Obsolete capability | Explicitly retire/supersede it; retain history and reconcile consumers. |
| Several old tasks affected by one coherent change | One adaptation owner with references, not a new task per bullet. |

Current evidence does not justify automatically reopening T009, T019/T020 or T030/T031. T030's five unchecked items have an explicit historical forced-completion reason; that is not evidence that the replacement delivery never happened. T031 covers a published package contract, not the Heca product integration.

## 3. Agent Brain before-state gap matrix and registered resolution

All references belong to F025. The before-state gap descriptions led to the now-registered contracts. All 41 tasks remain planned; current phase order and the exact DAG are in [the execution map](../../.planner/docs/agent-brain-plan.md). No project-wide scheduling model change was made.

| Existing owner | Verified scope / gap | Proposed registration | Order |
| --- | --- | --- | --- |
| P116/T461-T462 | Reliability fixtures and shared selection/context contract exist as planned work. | Include HOME service, transactional failures and new bootstrap; preserve the six reported failures and the decision not to add a global task queue. | Foundation |
| P128/T489 | Identity separation exists; description still defaults to git-common-dir storage. | Replace storage default with HOME SQLite and descriptor; retain clone/workspace provenance and non-Git support. | High |
| P128/T496 | Bounded parent/dependency reconciliation has a dedicated owner. | Reuse with SQL impact indexes and the command transaction; preserve explicit semantic pending obligations. | High |
| P128/T490 | One authority, startup ownership, revisions/idempotency and host conversion are covered; JSON remains permitted in its old contract. | Make the global service/API boundary explicit; remove direct operational stores in MCP/Pi/CLI. Reconcile with the proposed SQLite owner below. | High |
| P128/T502, now allocated | The before-state had no explicit relational/document/FTS implementation owner. | Registered T502 (MR7WJ), between T489 and T496; schema, documents/search, transactions, receipts, isolation and crash boundaries. | High |
| P130/T494-T495 | Divergent-copy migration, history/backup/export/restore already have owners; old text rejects a mandatory DB and assumes files under the Git common directory. | Amend to DB import, document transfer, consistent backup, Git transport snapshots and HOME restore. Review sequencing before the first usable migrated release. | High |
| P117/T463-T464 | Selection and durable nested returns already planned. | Preserve phase continuity, caller-scoped returns and ready-work checks; correct current-phase priority divergence. No free global task pool or task-queue UI. | Reliability |
| P118/T465-T466 | Resume overview and context reuse already planned. | Add project-resolved context preparation and delivered revision records; do not equate stored reads with retained model context. | Reliability |
| P119/T467-T469 | Code precedent/conformity, skill distribution and duplicate-task control already planned. | Update bootstrap/server delivery and DB document access; keep source review and bounded reconciliation. | Reliability |
| P120/T470-T472 | Code links, large-task changesets and decision applicability already planned. | Retain contracts; adapt persistence/queries and workspace identity to the common service. | Code intelligence |
| P121/T473-T475 | Dynamic setup, provider discovery and mixed-language checks already planned. | Retain open provider metadata and per-operation evidence. No fixed language whitelist or three mandatory tools. | Code intelligence |
| P122/T476-T478 | Graph/query, contextual retrieval and freshness already planned. | Reuse DB relationships and derived indexes with source revisions and bounded deltas. | Code intelligence |
| P123/T479-T480 | Graph inspection and supervisor context/setup views already planned. | Retain; use new APIs and truthful stale/unavailable state. | UI |
| P125/T483 | Project-first page titles already planned. | Preserve as independent work; do not create a duplicate title-fix task. | Independent |
| P126/T484-T485 | Workspace access/safe saves and compatible shared LSP processes already planned. | Retain; bind the source checkout independently of database storage. | Source |
| P127/T486-T488 | Monaco, contextual navigation and external editor already planned. | Retain; no second editor/LSP project. | UI |
| P129/T491-T493 | Executions, target integration and current availability already planned. | Bind durable evidence to database/execution/source identities; preserve partial integration and revert uncertainty. | Evidence |
| P131/T497-T500 | Optional runtime binding, live collaboration, attributed chat/actions and UI already planned. | Align with the shared HTTP/WS recommendation and the owner-approved Heca contract; preserve standalone use and Heca-owned orchestration. | After interfaces |
| P124/T481-T482 | Cross-surface validation, installed artifacts and guide closeout already planned. | Extend the matrix to database/bootstrap/import/protocol cases and exact native versions. Do not defer writing the design until final implementation closeout. | Closeout |
| AgentTest extension | T491 stores revision-bound evidence; T482 explicitly excludes a separate autonomous test product. | Document this existing boundary. A test generator/runner needs a separate agreed contract before allocation. | Open design |

### Sequencing correction registered in F025

The prior chain deferred migration behind target integration. It has been replaced: T489 -> T502 -> T496 -> T490 -> T494 -> T495. Reliability then uses that usable foundation. Target evidence remains T491-T493 without blocking basic migration/restore. Both task and phase DAGs pass the registration audit.

T481 verifies standalone delivery before T482's installed/optional-Heca closeout. T483 remains independent. Current UI contracts follow reviewed prototypes and keep business policy in APIs/core; see [prototype provenance](ui-prototypes.md). The exact registered counts and preservation evidence are in [the report](replan-registration.md).

## 4. Heca-Pro completed-work matrix

| Done owners | Evidence read | Assessment / follow-up |
| --- | --- | --- |
| F001/P001/T001-T004 | Completion records cover relay, licensing, pinning and first-message admission at named historical versions. | Keep research delivery. Confirm only the version-sensitive findings needed by T012/current launchers; the helper still pins 8.13.11 while a newer release check exists. No silent dependency upgrade. |
| F001/P001/T005-T007 | Completion records identify cost, permission-hook and exact session-resume investigations with coverage limits. | Keep completed research; current native harness behavior must be verified in owning integration tasks T023/T027/T029. |
| F001/P001/T008 | Research/proposal delivered; final licensing design belongs to T038. | Keep history; unrelated to SQLite/planner integration amendments. |
| F001/P001/T009 | Real older MCP ownership/focus/restart investigations; delegated implementation owners recorded. | Add new contract verification where the global-service identity changes; keep the old outcome and avoid client-set planner owner IDs. |
| F001/P002/T010-T011 | Workspace skeleton and pinned open-Heca library entry point delivered. | Keep; native host availability must be checked against the actual pinned revision, not a newer separate checkout. |
| F002/P005/T019-T020 | YAML format settled and reader implemented; headless fixtures are explicitly distinguished from production wiring. | Reuse parser/model/resolver. Adapt the read-only planner capability binding where required; do not reimplement the entire reader. |
| F003/P010/T030-T031 | Request delivered via F023; archived T031 report records 21 passing checks on published Agent Plan 0.4.9. | Keep done. Propose new-version conformance as a linked outcome; it must cover the service/API contract rather than repeat the old read-only report. |

## 5. Heca-Pro dated gap matrix and registered resolution

Actual feature priorities: F001 base=1, F002 workflows=2, F003 planner link=3, F004 visual tools=4, F005 multiple computers=5. Under the unchanged hierarchy, task priority 1 inside F003 does not outrank ready F001 work. A real dependency prevents the affected consumer from starting; it does not necessarily make its prerequisite the next global selection while unrelated higher-priority work remains ready.

| Owner / state | Current source or contract | Proposed amendment / effective precedence |
| --- | --- | --- |
| F001/P003/T012 waiting; T013 planned; T014 waiting | Helper pipe/protocol/supervisor exist. Production mesh entrypoint remains open; app state/action integration retain their owners. | Reuse existing work. Place any truly new base adaptation in F001 before its real consumers, with an explicit contract. Do not put all corrections into F003. |
| F001/P004/T015-T018 waiting | Room dock/activity/chat/notifications remain open; `heca-pro-components` is still a stub. | Reconcile rich chat, attachments, agent/session attribution and event projections with upstream generic components. User places docks. |
| F002/P005/T021 waiting | Compare/edit/save library code exists; native action/startup integration is not thereby complete. | Preserve headless implementation; wire approved runtime actions and explicit YAML save. |
| F002/P006/T022 waiting | Role registry/permission code and the native one-door integration are separate boundaries. | Ensure authenticated planner callers cannot bypass the role/assignment restrictions through the new API. |
| F002/P007/T023-T025 waiting | Team agent contract, workflow creation and orchestration retain ownership. | Provision service endpoint/project/workspace identity to MCP/Pi and coordinate phase work. Add prerequisites only where the startup path genuinely consumes them. |
| F002/P008/T026 waiting | Worktree library exists. It captures the current branch and passes `AGENT_PLAN_ROOT` to workers. | Update existing task: configured source/target branch, descriptor/service bootstrap and restart-safe cleanup. Before declaring worktree-based worker startup complete, verify these paths with T025. |
| F002/P009/T027-T029 waiting/planned | Permission requests, limits and restart/resume retain existing owners. | Revalidate planner caller recovery separately from exact native conversation resume and agent-comms identity. |
| F003/P011/T032 planned; T039/T040 waiting | Detect `.planner`, start per-project bundled server and follow/create planner. Planner crate is a stub. | Rewrite open contracts for descriptor resolve/migration/global service reuse. T032 continues to precede the consumers of its planner model. Version distribution/bootstrap ownership needs an explicit decision. |
| P011(F003)/T047, now registered | T031's old published-contract tests remain complete. | T047 verifies the new user-scoped service contract; it precedes T039/T032. Existing feature priorities remain unchanged and the old report is retained. |
| F003/P018/T041-T042 waiting | Native planner tree/detail overlay is planned. | Initial full WebView overlay and project URL reuse; native read-only views remain an explicit later stage. Reuse generic browser hosting from open Heca. |
| F003/P019/T043-T046 planned | Public collaboration provider contract/snapshot/events/chat/actions/native checks already registered. | Amend these owners rather than create a duplicate API phase. T043 is task priority 1 in phase priority 4 of feature priority 3; it is not globally first. |
| P012(F004)/T033 and P013(F004)/T034 waiting | Diagram overlay and workflow builder planned. | Keep ownership; consume upstream generic graph/layout/content widgets. |
| P014(F005)/T035, P015(F005)/T036, P016(F005)/T037, P017(F005)/T038 | Remote networking/relay/commercial server/licensing remain separate scope. | Do not treat these as an approved network authority for the planner database. |

The before-state findings above are retained as dated audit evidence. The 2026-10-31 [Heca-Pro registration](../../../heca-pro/docs/agent-brain-registration.md) records actual task/parent/requirement/decision updates; T047 is the sole new task. T042 now delivers initial WebView and T041 later native views. The current canonical DAG is authoritative.

### Concrete dependency guard

Existing Heca-Pro dependencies include:

```text
T012 -> T013 -> T014
T012 -> T039 -> T032
T031 -> T043
T043 + T013 + T032 + T023 -> T044
T043 + T014 + T022 + T023 -> T045
T044 + T045 -> T046
```

Do not make T013 depend on T044 or T014 depend on T045: those inversions create cycles. If a foundational public contract must precede implementation, separate that contract outcome from its later live consumer rather than attach a false reverse dependency.

## 6. Code findings to preserve in acceptance

| Source | Finding |
| --- | --- |
| `packages/plan-mcp/src/index.ts`, `planRoot` / `store` | MCP directly resolves cwd/.planner or AGENT_PLAN_ROOT and constructs PlanStore. |
| `packages/pi-adapter/src/index.ts`, `ensureStore` | Pi constructs a direct store and returns a `.planner/SKILL.md` pointer. |
| `packages/plan-server/src/api-v1.ts` | Non-GET requests are rejected; v1 cannot provide full server command parity. |
| `packages/plan-core/src/planner-skill.ts` | Managed/custom project skill handling must be migrated without losing custom content. |
| `heca-pro-planner/src/lib.rs` | Planner integration has no implementation yet; waiting-for-API comment is stale relative to T031, but does not establish the new API. |
| `heca-pro-workflow/src/environment.rs`, `PlannerRequest` | Read-only capability seam already exists, carrying project and feature/phase/task scope. Reuse it for service identity resolution. |
| `heca-pro-workflow/src/worktrees/mod.rs`, `WorkerFolders::open_inner` | Current branch is captured as target; planner directory is resolved from project path. |
| `heca-pro-workflow/src/worktrees/lifecycle.rs` | Worker environment uses AGENT_PLAN_ROOT. Cleanup already preserves unfinished/dirty/locked/unmerged work and retains branches. |
| `helper/README.md` and `heca-pro-comms` | Pipe supervision is implemented; production agent-comms mesh and native host integration remain bounded open work. |
| `heca-pro-agents/src/lib.rs`, `heca-pro-components/src/lib.rs` | Stubs; a diagram or workflow fixture cannot certify working orchestration/UI. |

File/symbol names are navigation evidence at the inspected commits, not durable code anchors.

## 7. Document reconciliation map

| Existing document | Treatment in this package |
| --- | --- |
| Agent Plan `PROJECT.md` | Replace old foundation-only project description with present/target product boundaries and links. |
| Agent Plan `ROADMAP.md` | Replace obsolete scaffold-first roadmap with the staged migration/integration plan; task state remains in the planner. |
| Agent Plan `README.md`, `docs/api-v1.md`, `docs/multi-agent-strategy.md` | Link the target specification; retain executable current instructions and label historical proposals. |
| Agent Plan core `docs/runtime-boundaries.md` | Label current file-based runtime; point to its accepted target replacement without pretending migration is installed. |
| `.planner/docs/agent-brain-plan.md`, registration handoff, shared-planner, editor, context-cost and collaboration specs | Add explicit supersession/coverage notices; replace conflicting storage/recovery summaries in the shared-planner document; retain detailed unaffected designs and dated reports. |
| Heca-Pro `docs/architecture.md`, `docs/agent-plan-work.md`, `docs/roadmap.md` | Reconcile per-project planner server, folder discovery and bootstrap against the global service. |
| Heca-Pro `README.md`, `docs/workflow-file.md`, `docs/components.md`, developer handoff | Link room-first workflow, descriptor resolution and the initial WebView/native staging. Preserve YAML format and generic composition rules. |
| Heca-Pro `docs/worktree-management.md` | Preserve current API documentation; explicitly flag current-branch capture and folder environment as migration targets. |
| Heca-Pro `docs/decisions.md` | Add a clearly scoped target supersession note for old discovery/startup/view choices. Do not erase historical decisions or invent canonical record IDs. |
| Both `AGENTS.md` files | Leave unchanged; note current-vs-target governance discrepancies for explicit later approval. |

## 8. Registration acceptance and remaining cross-project work

- Agent Plan: complete, one new coherent outcome T502; all other F025 identities reused. Heca-Pro: complete on 2026-10-31, 27 open tasks amended and P011(F003)/T047 allocated, with 15 done tasks preserved.
- Amend open descriptions/checklists and affected parent/requirement/Accepted Decision records together. Preserve ongoing work, histories and UUIDs.
- Record supersession once on the appropriate owner; reference it from affected tasks rather than duplicate decisions.
- Read back exact changes and run a bounded dependency-cycle/parent/reference consistency check.
- Keep completed records and archived evidence intact. Document any reopening against its original acceptance contract.
- Review effective feature/phase/task priority, not task priority alone. No new global queue or automatic interruption policy is part of this pass.

## 9. Evidence sources

Agent Plan: MCP F025 feature/task discovery and full T462/T463/T464/T466/T468/T489/T490/T491/T494/T495/T497/T481/T482 reads; current source modules above; older F025 registration documents.

Heca-Pro: local feature/phase/task inventories, completed-task contracts, `docs/planner-api-verification.md`, `docs/workflow-file.md`, `docs/heca-developer-handoff.md`, `docs/worktree-management.md`, helper progress and the corresponding Rust modules. Old temporary-worktree paths in completion notes are historical provenance; the inspected repository lists only its main local worktree.

## Accepted integration amendment, 2026-11-01

Use the [decision register](decisions-2026-11-01.md), [registration fields](session-registration.md), [Heca room chat](../../../heca-pro/docs/room-chat.md) and [YAML policy](../../../heca-pro/docs/room-execution-policy.md). Heca initiates the duplex connection; manual terminal agents remain standalone. Both UIs read/write one Heca-owned archived room conversation. Default recipient is the orchestrator, visibility is room-wide, ordinary delivery queues, history survives closure until deletion, and policy edits apply next task while revocations apply immediately. Completed historical evidence does not verify these amendments. Keep current task identities and priorities; preserve standalone operation and the existing scheduler.
