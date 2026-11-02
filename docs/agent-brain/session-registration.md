# Agent session registration and task attribution

Target contract, consolidated 2026-11-02. The semantics implement the [accepted decisions](decisions.md); field names below are the schema proposal for the owning API implementations, not current tool parameters. Use the same domain commands from MCP, Pi, CLI and the Web UI.

## Entry point and service lifecycle

Every agent uses planner load. The adapter resolves the repository descriptor and project identity, discovers or atomically starts the single user-scoped Agent Plan service, authenticates, registers its own session and receives canonical project context. Legacy import, first initialization and missing-HOME restore retain their explicit migration/restore flows.

MCP/Pi are clients, never direct database clients. Several simultaneous loads must reuse one compatible service. The service serves APIs and the dashboard independently of an MCP process. Loading a worker does not open a browser or create another HTTP server. Opening the dashboard is a separate presentation action that reuses the existing project URL.

Project requirements, guidelines and accepted decisions must be delivered completely under the context contract. Follow with the assigned feature/phase/task context, using revision-based reuse and targeted refresh rather than rereading unrelated feature trees. One agent's load never proves another agent received context.

## Session fields

Required means the owning service must resolve the value before acknowledging registration; it does not mean an LLM must type it. Optional metadata stays explicitly unknown when an adapter cannot report it. Do not invent model names or native session IDs.

| Fields | Required / source | Meaning |
| --- | --- | --- |
| protocolVersion, clientKind, clientVersion | Required; adapter handshake, validated by service | Negotiated API compatibility; clientKind is extensible. |
| adapterId, adapterVersion, capabilities | Required integration identity; empty capability set is valid | Which integration supplied metadata and which operations it actually supports. |
| projectId | Required; descriptor verified by service | Durable planner project identity across worktrees. |
| principalId, grantId | Required; authenticated service context | Authenticated principal and its project grant. Never take these on trust from tool arguments. |
| agentId | Required; service registration | Logical agent identity. Display names and native session IDs are not authority. |
| sessionId | Required; Agent Plan issues it | Planner session used for context receipts, task ownership and activity. Distinct from the harness conversation. |
| displayName, harnessId | Required resolved display metadata; adapter/profile | Stable handle (`worker-1`, `orchestrator`) and extensible harness identifier. The live label (model + current F/P/T) is computed at display time and never stored in the name. |
| harnessVersion | Optional; adapter | Version used for capability and verification reports. |
| nativeSessionId | Optional and later updatable; harness adapter | Exact native conversation ID, scoped by harness/host/profile. Absence does not prevent registration. |
| modelProvider, modelId | Optional and later updatable; native metadata | Actual reported model/provider; preserve changes over time. |
| hostId, workspaceId | Required registered source/host context | Scope for source paths, native IDs and runtime observations. Host names and PIDs alone are not authentication. |
| workingDirectory, sourceRoot | Required registered locators for source-backed work | Resolve against the registered host/workspace, not the browser's filesystem. |
| repositoryRegistrationId, branch, worktreePath, baseRevision | Required when applicable to Git work; observed source registration | Local clone/worktree and approved starting revision. Use null/not-applicable for non-Git projects. |
| runtimeMode, integrationProviderId | Required service-derived mode; provider only when integrated | standalone or integrated after a verified binding; provider identifiers are extensible, with heca-pro as this integration. Physical terminal origin cannot select this mode. |
| integrationBindingId | Required only for integrated sessions; verified provider registration | References the trusted Heca/member associations below for this provider. Keep provider-specific fields outside the harness-neutral core. A self-declared room ID does not enroll a caller. |
| callerInstanceId, connectionId | Service/adapter-generated runtime metadata | Separate the adapter process and transient connection from the planner session. Reconnection does not create an execution by itself. |
| contextEpoch, contextRevision | Required context bookkeeping | Detect a new/reset agent context and stale project deliveries independently of transport reconnects. |
| registeredAt, lastSeenAt, disconnectedAt, endedAt, endReason | Service-generated lifecycle observations | Preserve disconnection separately from a finished conversation or task. |

Do not store access tokens, connection secrets or native credentials in these historical records. Store grant references and policy revisions; credentials live in protected service settings.

## Verified Heca binding

Heca provides serverId, bootEpoch, instanceId (the Heca session), workspaceId, memberId, agentCommsAgentId and the native session correlation when known. Membership is an array: roomId, roleId, configured orchestratorMemberId, membership revision and join/leave interval. A member can belong to several rooms. Project/feature/phase/task associations are explicit and validated against the planner; paths only locate source.

Heca owns these facts and publishes their changes over its authenticated connection. Agent Plan stores attributable history and current projections; it does not invent roles or infer membership from a directory, PID, terminal wrapper, report hook or model name. A task using several applicable memberships must select an explicit policy/room context; ambiguity is an error, never an implicit merge.

For room-launched agents Heca's harness integration supplies a protected, session-scoped bootstrap reference. planner load passes it for correlation with Heca's registered member. This is separate from the generic terminal launch/status contract. A manually launched agent receives no room grant and remains standalone.

When native session metadata arrives after load, update the same registration with provenance and observed time. Neither an ID change nor an equal display name transfers ownership. A new or resumed conversation of the same logical agent (same Heca member, or same harness + workspace when standalone) reclaims its own tasks; another agent follows the execution-lock rules below.

## Per-command and execution records

The adapter reuses registration rather than repeating metadata in every model tool call. A sessionId argument may be omitted when the authenticated caller has one unambiguous bound session. An explicit sessionId must be in the caller's authorised scope. nativeSessionId is never an owner override or a permission credential.

Every command records requestId, idempotencyKey, principalId, actorSessionId, projectId, operation, target references, expected revision and resulting revision/receipt. Read-only commands need the identity/scope appropriate to their operation rather than fake task executions.

Every task attempt records executionId, taskId, server-derived phaseId/featureId, executionSessionId, requestedBySessionId, source workspace/branch/revision, optional Heca binding and policyRevision, startedAt, paused/resumed intervals, finishedAt, outcome/endReason and linked evidence. Snapshots of relevant agent/model/role metadata keep history meaningful after changes. Changing branches or policy never silently rewrites prior attempts.

The worker normally starts, pauses, resumes and reports completion of its own task. The orchestrator allocates coherent phase work, follows the planner's priorities and performs configured reviews. The orchestrator chooses tasks by planner priority; with the user's agreement it may assign one out of order, and the planner records the reason. Start revalidates readiness, context and the execution lock atomically; unmet dependencies produce a warning. Assignment is not execution: an unavailable or unprepared worker has no fabricated start time.

Planner writes are not restricted between agents: on request a worker or orchestrator may change other tasks. Record requester and executor separately on every command; this is audit, not a gate. The executor of a task still needs a registered compatible session and its own current context receipts; the orchestrator's reads do not satisfy them. Heca's native planner connector remains read-only; agents write through their own MCP/Pi callers.

### Execution lock

| State | Rule |
| --- | --- |
| In-progress | Blocks a start by another live session. |
| Parked | Set by a switch or return; does not block. A takeover warns, is recorded, and the original session is told on return. |
| Abandoned | The adapter heartbeat (about every 30 s, in code) stopped; the lease expires about 2 min after the process dies. No manual recovery. |
| Idle | A live owner inactive beyond a configurable threshold (e.g. 2 h). Takeover by another agent or the user requires explicit confirmation. |

The Web UI offers a human Release action. Release and takeover are recorded in history.

## Order, late startup and recovery

| Scenario | Required result |
| --- | --- |
| Standalone agent loads first | Register independent history and use the planner. No Heca enrollment. |
| Heca room exists before Agent Plan | Deliver room policy and operate without planner; retain desired integration state. On explicit planner use, bootstrap/connect and register current room/member snapshots. |
| Agent Plan already runs when room agent loads | Reuse the service; verify the Heca binding and the caller's own context. |
| Services start in either order | Heca retries a configured/opted-in integration in code, with backoff and compatibility/authentication checks; retries do not wake a model. |
| Heca disconnects | Keep last-known bindings visibly stale; every planner caller keeps its permissions. No task auto-completion; locks follow their own heartbeat. |
| Agent Plan disconnects | Room chat and policies keep working; planner commands report unavailable. Never create a worker-local competing planner or pretend an offline claim succeeded. |
| Adapter/agent restarts | Revalidate native identity and context epoch; the same logical agent reclaims its tasks; preserve task attempts and history. |

Acceptance includes late native IDs, two equal names, several rooms per member, concurrent loads/claims, forged session/room IDs, cross-task edits with actor/requester audit, all execution-lock states and same-agent reclaim, reconnect without a new task attempt, and no server/browser multiplication.
