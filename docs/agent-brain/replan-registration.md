# F025 canonical replan registration

> Registration record. The current decisions are in [decisions.md](decisions.md) and the current order in [the execution map](../../.planner/docs/agent-brain-plan.md). Counts dated 2026-10-30 are historical (F025 now has 64 task edges).

Replan: 2026-10-29. Final prototype/API clarification and verification: 2026-10-30.

## Result

| Item | Registered result |
| --- | --- |
| Feature | F025, original UUID/short ID and global priority 24 retained. |
| Phases | 16 existing identities; ordered 1-16. |
| Tasks | 41 planned: all 40 originals retained plus P128(F025)/T502 (MR7WJ). |
| Requirements | 33 linked outcome requirements; prior IDs/links/macro-task history preserved. |
| Decisions | 21 feature-owned decisions; prior decision IDs/accepted dates retained. Project-owned decisions unchanged. |
| Dependencies | 68 task edges, task and phase graphs acyclic. |
| Checklists | 230 unchecked items. No implementation completion or task start. |
| Parents | All 16 phases and F025 reconciled after child updates; no stale parent in this scope. |

T502 UUID: `bf80a08e-a3d7-4cd9-8910-c7ad62b62238`. It owns relational/document/FTS persistence, transactional command receipts, worker isolation and crash boundaries. No placeholder IDs remain in its registered dependencies.

## Current phase order

Updated 2026-11-02 ([review decisions](decisions-2026-11-02.md)): P131 moved from 15 to 4; dependencies T500 -> T487/T488, T497 -> T491 and T498 -> T493 were removed.

| Order | Phase | Outcome | Tasks |
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

The full task/prerequisite map is [the current execution map](../../.planner/docs/agent-brain-plan.md). Canonical task/phase descriptions carry implementation responsibilities, acceptance evidence, current source navigation and open choices.

## Material corrections

- P128: T489 -> T502 -> T496 -> T490. Identity, storage, mutation consistency and service/client parity have explicit owners.
- P130: migration/backup/export/import/HOME restore follows the service foundation without waiting for advanced target integration. No direct file/DB clients or live JSON mirror.
- Scheduling: no global individual-task queue; preserve phase continuity and explicit durable returns within the current ready-work priority model.
- P129: execution, verification, integration and currently observable target availability remain separate.
- P125/T483 remains independent. P124/T481 is a standalone milestone; T482 adds installed/optional-native closeout rather than preventing standalone delivery.
- P131 consumes Heca public capabilities and, since 2026-11-02, is phase 4. Heca-Pro amendments were subsequently registered on 2026-10-31, preserving completed work and adding only P011(F003)/T047; see [its report](../../../heca-pro/docs/agent-brain-registration.md).
- The prototype-led UI and API-owned business policy are now a feature decision and part of the affected UI/parent contracts. See [design evidence](ui-prototypes.md).

## Verification boundary

The bounded registration validator checks 1,542 assertions against a before snapshot and the desired current contracts: original identity/history preservation, exact task descriptions/checklists/priorities/dependencies, phase identity/order/context readiness, requirements/decision preservation, no unrelated feature/phase changes and acyclic task/phase graphs. The final separate parent read-back covers all 17 F025 parent descriptions.

[Machine-readable registration evidence](../../.planner/docs/agent-brain-replan-verification.json) records these results. This is planner consistency evidence, not a passing implementation suite or installed-release claim. No full repository gate was needed for documentation/planner-only work.

One pre-existing, unrelated requirement reference remains unchanged: `f794df81-953f-42e4-bb68-91e1c303d7d0` (Detail-page filter parity with WorkTree + text-search fix) contains `P074` where a resolvable phase UUID is expected. It was present in the before snapshot and is recorded as an out-of-scope warning.

## Open contracts and next action

Descriptor schema/rebinding, service discovery/authentication, SQLite driver/version support, divergent snapshot conflict resolution and public Heca host/transport details remain explicit owner decisions. Network-authoritative team planning and autonomous AgentTest generation/execution remain outside this registration.

The next F025 task is P116(F025)/T461. Starting implementation still requires the user's implementation instruction and current project-context read. No source changes, real migration, dashboard/service launch, commit, push, PR, release or AGENTS.md modification was performed by this replan.

The [reconciliation matrix](reconciliation.md) retains the dated source audit and Heca-Pro follow-up, while this report records the now-completed Agent Plan registration. Archived old plan/handoff prose is historical; never replay it as an import.

## Room integration amendment registered, 2026-11-01

The [accepted decisions](decisions-2026-11-01.md) and [session fields](session-registration.md) were registered in six existing task contracts, P128/P129/P131, F025 and relevant existing requirements/decisions. No task IDs, states, priorities, dependencies or checklist ticks changed. Four affected parents passed the core freshness diagnostic. Native host/message/service conformance remains implementation work.
