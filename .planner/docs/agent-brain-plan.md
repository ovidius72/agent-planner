# F025 current execution map

Registered: 2026-10-29; consolidated 2026-11-02 with [the decision register](../../docs/agent-brain/decisions.md).

F025 evolves Agent Plan in this repository. The canonical feature, phase, task, requirement and Accepted Decision records are the execution contracts. This document is a navigation map, not another import payload or task store.

## Registered scope

- 16 phases and 41 planned tasks: all 40 prior task identities/history are preserved; P128(F025)/T502 is the sole new task.
- 33 linked outcome requirements; 21 feature Accepted Decisions, including the prototype-led UI/API boundary. The existing project decision remains on its original owner.
- 64 acyclic task dependency edges (four removed on 2026-11-02) and 230 unchecked checklist items. No implementation task has started.
- Global F025 priority remains 24. The phase order below does not change the existing project-wide priority model.

## Architecture and design contract

One user-scoped Agent Plan application service owns per-project SQLite under HOME. Pi adapter, MCP, CLI, Web UI and Heca clients use its APIs; they never open the database. A portable repository descriptor identifies the project. JSON/documents are explicit export/import artifacts, not a live mirror.

Identity -> transactional storage/documents/search -> mutation consistency -> service/client parity -> migration/recovery is the foundational order. No real project migration occurs during planning. Legacy documents and custom guidance must remain accessible through the new service.

Source knowledge retains historical/current location and decision applicability separately. Provider selection is dynamic, including empty/undecided/unsupported projects. Agent execution, verification, target integration and current availability are distinct. Monaco reuses compatible shared analysis. AgentTest is a future evidence-producer seam; a separate autonomous testing product is not approved.

The Web UI will be redesigned from reviewed prototypes. Domain rules stay in core/application APIs; the UI renders results and submits commands. Read [prototype provenance and review limits](../../docs/agent-brain/ui-prototypes.md). Current visuals and illustrative prototype data are not implementation acceptance evidence.

Heca-Pro remains optional: its public facade owns room/member/chat/action state; Agent Plan never calls agent-comms or models directly. Its only reverse request in v1 is the Heca action `send_message`. Planner writes are free and attributed; only the execution lock blocks. Heca planner WebView/native hosting belongs to its existing owners. Heca-Pro task amendments were registered on 2026-10-31, including its new conformance owner P011(F003)/T047; implementation remains open.

## Phase order

P131 is phase 4 so a usable Heca integration ships before code intelligence and Monaco.

| Order | Phase | Outcome | Tasks in phase order |
| --- | --- | --- | --- |
| 1 | P116(F025) | Baseline failures and shared architecture contract | T461, T462 |
| 2 | P128(F025) | Descriptor, SQLite authority and user-scoped application service | T489, T502, T496, T490 |
| 3 | P130(F025) | Legacy migration, portable snapshots and independent recovery | T494, T495 |
| 4 | P131(F025) | Optional Heca public API client and collaboration UI | T497, T498, T499, T500 |
| 5 | P117(F025) | Deterministic priorities, phase continuity and reliable returns | T463, T464 |
| 6 | P118(F025) | Useful resume overview and complete bounded context | T465, T466 |
| 7 | P119(F025) | Existing conventions, portable guidance and proportionate planning | T467, T468, T469 |
| 8 | P129(F025) | Attributable executions and revision-aware target availability | T491, T492, T493 |
| 9 | P120(F025) | Code anchors, large changesets and scoped rationale | T470, T471, T472 |
| 10 | P121(F025) | Capability-driven setup and multilingual provider validation | T473, T474, T475 |
| 11 | P122(F025) | Provenance graph, relevant retrieval and incremental freshness | T476, T477, T478 |
| 12 | P126(F025) | Source workspace access, safe saves and shared analysis | T484, T485 |
| 13 | P123(F025) | Supervisor graph and evidence-backed controls | T479, T480 |
| 14 | P125(F025) | Project-first browser page titles | T483 |
| 15 | P127(F025) | Editable Monaco workspace and contextual source navigation | T486, T487, T488 |
| 16 | P124(F025) | Standalone compatibility and installed cross-product closeout | T481, T482 |

## Task owners and real prerequisites

Dependencies constrain execution; table order is not permission to bypass readiness or another feature's priority. Keep coherent phase work and recover explicit approved detours. No global individual-task queue is adopted.

| Task | Outcome owner | Prerequisite tasks |
| --- | --- | --- |
| P116(F025)/T461 | Reproduce the reliability failures on isolated fixtures | None |
| P116(F025)/T462 | Define one shared next-work and context contract | T461 |
| P128(F025)/T489 | Separate planner storage, code workspace and runtime identities | T462 |
| P128(F025)/T502 | Implement the transactional SQLite authority, documents and planner search | T489 |
| P128(F025)/T496 | Reconcile affected hierarchy and dependencies with bounded context cost | T502 |
| P128(F025)/T490 | Route all clients through one coordinated local planner authority | T496 |
| P130(F025)/T494 | Migrate divergent worktree planners through a lossless reviewed binding | T490 |
| P130(F025)/T495 | Add recoverable planner history, backup and portable export/restore | T494 |
| P117(F025)/T463 | Unify ready-work selection and recommendation explanations | T462, T495 |
| P117(F025)/T464 | Preserve and resume nested interrupted work across phase closure | T463 |
| P118(F025)/T465 | Replace handoff choice lists with an actionable resume overview | T464 |
| P118(F025)/T466 | Coordinate complete context delivery and freshness-aware reuse | T465 |
| P119(F025)/T467 | Add evidence-backed source analysis and conformity review to existing workflow | T466 |
| P119(F025)/T468 | Synchronize the operating protocol across harnesses and context-loss events | T467 |
| P119(F025)/T469 | Prevent duplicate capability ownership and unnecessary task creation | T468, T496 |
| P129(F025)/T491 | Persist attributable task executions and revision-bound verification | T490 |
| P129(F025)/T492 | Track target integrations and revalidate current code availability | T491 |
| P129(F025)/T493 | Expose work progress and target availability in planner context and UI | T492, T463 |
| P120(F025)/T470 | Implement snapshot-bound code links and safe reference resolution | T469, T491, T496 |
| P120(F025)/T471 | Capture large-task changesets and scoped code ownership | T470, T491 |
| P120(F025)/T472 | Version durable decisions and resolve their applicability to code | T471 |
| P121(F025)/T473 | Implement capability-based setup for empty and existing projects | T489, T490, T468 |
| P121(F025)/T474 | Discover and configure analysis providers through shared adapters | T473 |
| P121(F025)/T475 | Verify dynamic provider coverage and mixed-language boundaries | T474 |
| P122(F025)/T476 | Build a provenance-aware graph projection and query API | T472, T475 |
| P122(F025)/T477 | Deliver global orientation and impact-scoped implementation context | T476, T466 |
| P122(F025)/T478 | Refresh impacted context and manage review evidence over time | T477, T496 |
| P126(F025)/T484 | Add project-scoped source access and revision-safe file saves | T489, T490 |
| P126(F025)/T485 | Share language-server processes across agents and the editor | T484, T475 |
| P123(F025)/T479 | Add graph navigation and reverse code-to-rationale inspection | T478 |
| P123(F025)/T480 | Expose setup, context analysis and review state in supervisor workflows | T479, T473 |
| P125(F025)/T483 | Preserve project identity in overview and detail page titles | None |
| P127(F025)/T486 | Build a lazy-loaded Monaco file explorer and editable workspace | T484, T485, T483 |
| P127(F025)/T487 | Connect Monaco navigation to shared analysis and planner rationale | T486, T479, T472 |
| P127(F025)/T488 | Open source locations in the preferred external editor | T486 |
| P131(F025)/T497 | Define the optional execution-runtime contract and shared-planner bindings | T489, T490 |
| P131(F025)/T498 | Connect Heca collaboration snapshots and live events to the shared planner view | T497 |
| P131(F025)/T499 | Add attributed room chat and authorized runtime actions for UI and agent clients | T498 |
| P131(F025)/T500 | Add collaboration views, chat and planner-to-room navigation | T499 |
| P124(F025)/T481 | Verify migrations, invariants and complete cross-surface scenarios | T487, T488, T480, T493, T495, T469 |
| P124(F025)/T482 | Validate installed artifacts and publish the operating guide | T481, T500 |

## Read before implementation

1. Repository governance, [PROJECT](../../PROJECT.md) and [ROADMAP](../../ROADMAP.md).
2. The applicable canonical task, phase, feature, linked requirements and owner decisions through planner tools.
3. [Decisions](../../docs/agent-brain/decisions.md), [architecture](../../docs/agent-brain/architecture.md), [communication](../../docs/agent-brain/heca-protocol.md), [registration evidence](../../docs/agent-brain/replan-registration.md), and relevant current source precedents.
4. Confirm unresolved descriptor/auth/driver/import/Heca contracts in their named owners; a draft endpoint is not a released API.

The first F025 task is P116(F025)/T461, not a command to start it. All implementation, migration, service launch, Git publication and release remain outside this registration authorization. Preserve the existing warning-only no-task policy and release governance.

[Previous accumulated plan](history/2026-10-29-before-replan-agent-brain-plan.md) and [previous registration handoff](history/2026-10-29-before-replan-agent-brain-registration-handoff.md) are archived historical evidence. Do not replay old import specifications.
