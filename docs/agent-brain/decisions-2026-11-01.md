# Agent Brain and Heca-Pro: accepted integration decisions

> Dated record of 2026-11-01. The current consolidated register is [decisions.md](decisions.md); where they differ, it wins.

Accepted with Antonio on 2026-11-01 after the room-chat interview. Product behaviour below is settled. Target protocol schemas still require implementation and conformance evidence; this record does not claim a running integration.

## Decision register

| Topic | Accepted behaviour |
| --- | --- |
| Connection owner | Heca initiates its authenticated, bidirectional connection to Agent Plan. Standalone MCP/Pi callers connect to Agent Plan independently. Agent Plan does not dial Heca to discover collaboration. |
| Integration boundary | Only explicitly enrolled room agents carry a Heca binding. An agent manually started in a Heca terminal remains standalone for planner collaboration, even if native status reporting is enabled. |
| Entry point | Each orchestrator and worker uses planner load to register its own caller/session and receive project context. A shared service handles every caller; loading context does not create a dashboard server per agent. |
| History | Standalone and integrated agents have attributable task execution history. Heca adds verified instance, workspace, membership and orchestrator associations. |
| Scheduling | Preserve feature -> phase -> task priorities, dependencies and phase continuity. The planner selects eligible work; room assignment does not override task ownership. |
| Delegation | A caller may act for another execution session only under an explicit policy grant. Preserve both the actual requester and executor. Context gates still apply to the executor. |
| Work policy | Extend Heca-Pro's existing Kubernetes-style workflow YAML. Heca delivers the applicable policy at creation, restart/resume and activity start without depending on Agent Plan. |
| Policy changes | Skill, review and commit changes apply from the next task. Keep the current task's policy revision. Permission revocations affect subsequent operations immediately. |
| Chat scope | One shared conversation of room messages exchanged through agent-comms. Capturing/merging the native transcripts, tool output and internal conversations of every harness is outside this delivery. |
| Both interfaces | Heca-Pro and Agent Plan Web UI both read and write the same room conversation. Agent Plan proxies through Heca and is not an agent/mesh participant. |
| Default destination | A user message without a selected recipient is addressed to the room's configured orchestrator. |
| Visibility | Requests and replies are visible to the whole room. Visibility does not make every member an operational recipient or activate every model. |
| Busy recipient | Ordinary messages queue without interrupting work. Urgent intervention is explicit and available only through a supported harness capability. |
| Persistence | Heca owns a local SQLite conversation archive and attachment files. It is independent of the planner database. |
| Retention | Closing/archiving a room preserves messages and attachments until explicit deletion. Archival remains readable without restarting agents. |
| Delivery | Persist local acceptance, distinguish delivery from execution, use stable operation/message identities and expose uncertain outcomes. Adapter limitations must remain visible; no unconditional exactly-once claim. |

## Contracts and owners

| Contract | Specification | Current implementation owners |
| --- | --- | --- |
| Agent sessions and execution attribution | [Session registration](session-registration.md) | Agent Plan T490/T491/T497; Heca-Pro T023/T032/T039/T047 |
| Bidirectional service communication | [Communication contract](heca-protocol.md) | Agent Plan T497-T500; Heca-Pro T043-T046 |
| Shared room chat and archive | [Heca room chat](../../../heca-pro/docs/room-chat.md) | Heca-Pro T012-T014/T017/T029/T045; Agent Plan T499/T500 |
| YAML execution policy | [Heca room policy](../../../heca-pro/docs/room-execution-policy.md) | Heca-Pro T021-T025; Agent Plan T490/T491 for attribution and authorised commands |

Maintain the existing task identities, states, priorities, completed evidence and checklist ticks. Do not create a competing chat/planner implementation. These amendments do not reopen completed workflow parsing or old API-verification tasks.

## Implementation review gates

The following are engineering acceptance work, not unanswered product choices: supported Heca host hooks; versioned DTO/route spelling and installed package compatibility; credential pairing; addressed-message filtering before model invocation; durable receipt/idempotency support at the helper/mesh boundary; backup and attachment crash tests. Existing browser/editor/tab/pinning work keeps its own reviewed scope.

Network-authoritative shared planning, autonomous AgentTest generation and native transcript aggregation remain outside this delivery. Older registration counts and test reports stay dated evidence.

## Registration evidence

The accepted amendment was applied through planner APIs on 2026-11-01: six existing Agent Plan tasks and seventeen existing Heca-Pro tasks, their eleven phases/four features in total, the linked existing requirements and scoped decisions. Existing decision IDs/acceptance dates were preserved; one new Heca-Pro F002 execution-policy decision was added. No task, phase or feature was created, started, completed, reopened or reprioritised.

Read-back preserved all task identities, states, dependencies, checklists, histories and correctly completed evidence. The core freshness diagnostic reports all fifteen affected phase/feature descriptions fresh. F004's overview/builder still consume T013/T017/T021 through their existing owners and were reviewed unchanged rather than duplicated. Local Markdown links and whitespace were checked. These checks establish documentation/planner consistency, not native/runtime delivery.
