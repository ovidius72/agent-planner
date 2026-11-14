# Agent Brain and Heca-Pro design package

Consolidated 2026-11-02. Implementation owner: Agent Plan F025, with the Heca-Pro owners named in each specification. This package is the target design; it does not claim that the architecture is implemented.

## Read in this order

| Document | Purpose |
| --- | --- |
| [Accepted decisions](decisions.md) | The single product register for both repositories, including the open technical choices. |
| [Agent Brain architecture](architecture.md) | Local service, SQLite authority, identity, commands, search, context, execution lock, code intelligence, migration and recovery. |
| [Session registration](session-registration.md) | Identity/context fields, standalone versus room agents, attribution and the execution lock. |
| [Communication contract](heca-protocol.md) | Heca-initiated restricted duplex, bootstrap, `send_message`, events and failure handling. |
| [Heca-Pro workflow and integration](../../../heca-pro/docs/agent-brain-integration.md) | The room-first user workflow, YAML, instances, conversations and layout. This relative link assumes sibling checkouts. |
| [Execution map](../../.planner/docs/agent-brain-plan.md) | Current F025 phase order and real task prerequisites. |
| [UI prototypes](ui-prototypes.md) | Inspected design references, their gaps and the API/presentation boundary. |
| [Replan registration](replan-registration.md) | How F025 was registered, with verification evidence. |
| [Reconciliation and gap matrix](reconciliation.md) | Dated audit of existing work and how it was resolved. |
| [Improvements and fixes](improvements-and-fixes.md) | Maintained register of reported bugs, discovery/conduct improvements and dependency-impact corrections for Agent Brain development. |
| [Decisions 2026-11-01](decisions-2026-11-01.md), [2026-11-02](decisions-2026-11-02.md) | Dated decision records and the planner changes applied on those days. |

Each server owns its API schema; the communication contract connects those schemas rather than introducing a third dispatcher or store.

## Source and authority boundaries

- These are product/developer specifications in Git. A user's planner documents, including imported `.planner/docs`, belong to the future planner database; they are a different document collection.
- Canonical task, phase and feature records are the execution contracts. Read the applicable task and its parents through planner tools before implementation.
- When a decision changes, update the affected task, phase, feature, requirements and Accepted Decisions together, keep one owner per decision and record unresolved reconciliation explicitly.
- Old registration reports, benchmark probes and test reports remain dated evidence. Their passing results do not certify the enlarged design.
- `AGENTS.md` remains unchanged. Its JSON persistence statement describes the current product; changing governance requires a separate explicit request.

## Implementation sequence

1. Settle the open technical choices in the [decision register](decisions.md).
2. Implement identity, SQLite and the complete command API before converting clients or migrating real data (P116, P128).
3. Deliver migration, recovery and export/import for the first usable database-backed release (P130).
4. Connect Heca: planner reads, room snapshots and room chat (P131).
5. Continue with priorities, context, executions, code intelligence and the P132 project-use improvements in the order of the [execution map](../../.planner/docs/agent-brain-plan.md).
6. Close with compatibility, real-host and freshly installed artifact evidence (P124).

No product code, real database migration, running service, commit, push or release has been created by this design work.
