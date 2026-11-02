# Agent Brain and Heca-Pro: public collaboration API and client contract

> Superseded draft (2026-10-23). The current contract is [the communication contract](../../docs/agent-brain/heca-protocol.md) with [the decision register](../../docs/agent-brain/decisions.md). Kept as historical context only.

Planning amendment requested on 23 October 2026. This document supports canonical planner records; it is not a second planner, an executable import manifest, an implemented API or permission to start implementation. Actual allocated references are recorded after registration.

## Verified baseline and ownership

Source precedents: ../heca/heca/src/rpc.rs:1 (catalog-driven parser and introspection, not proof of a public API), ../heca/heca/src/server/run.rs:1 (ServerLoop; currently explicitly not wired into the running app), ../heca/heca/src/server/wire.rs:24 (internal ClientMsg/ServerMsg), ../heca/heca/src/actions/catalog/mod.rs:235 (ActionCatalog), helper/protocol.json:1 (private helper commands/events), heca-pro-comms/src/supervisor.rs:1 (bounded helper supervision), heca-pro-workflow/src/environment.rs:14 (capability-owned environment), docs/architecture.md:75 (one command door), docs/agent-plan-work.md:7 (planner/domain boundary).

Source precedents: packages/plan-server/src/serve.ts:1, packages/plan-server/src/ws-hub.ts:1, packages/plan-server/src/entity-events.ts:1, packages/plan-core/src/api-v1.ts:1, packages/plan-core/src/plan-store.ts:3493 (registerSession/claimTask), packages/plan-mcp/src/index.ts:1, packages/pi-adapter/src/index.ts:43 (queueing is not delivery/start), packages/plan-web-ui/src/app/router.tsx:1.

Cross-project prerequisite: open Heca P099(F012)/T544 must provide and verify the running headless host/attach/extension seam; its status was in-progress at inspection. Reuse existing public extension/action ownership; missing host APIs remain tracked Heca work, never private-copy patches in heca-pro or a second dispatcher. A prototype socket/parser or a mock is not evidence that production external RPC is exposed. Capture supported upstream revision/package and native conformance evidence before declaring capability available. Cross-project refs are explicit external gates, not fabricated local dependsOn edges.

Open Heca owns host/session/extension/action infrastructure. Heca-Pro owns rooms, memberships, roles, assignment, messages and orchestration. Agent Plan owns canonical project knowledge, task/execution evidence and source/target views. Heca-Pro keeps reading the planner; agents write through their own authorized planner tools. Outside clients project Heca state rather than redefining rooms in .planner. New public API exposure must reuse current owners and authorization, not private-copy patches or another execution path. Named local operations below are proposed semantic API families; exact public transport/method spelling must be validated against the owning host.

## Public API families to implement in Heca/Heca-Pro

- **discovery.describe**: Protocol/API version, server identity/epoch, advertised and runnable capabilities, principal-visible actions, health and source of status. Installed/predisposed is distinct from available.
- **planner.bindings.list**: Opted-in shared planner identity and repository/workspace bindings; enumerate only authorized instances. Paths and branch names are mutable locators, never shared-plan identity.
- **collaboration.snapshot**: Consistent project-scoped instances, rooms, members, extensible roles, membership edges, observed agent/session state and task/execution associations, with snapshot revision and event cursor.
- **conversations.list / messages.list**: Authorized room/direct conversations and bounded history with stable conversation/message IDs, ordering, pagination and planner links.
- **messages.send / messages.status**: Send to a room or member with an authenticated sender, explicit destination, client request ID and optional planner context references. Report accepted/queued/delivered only when evidenced; message delivery does not prove an agent turn began.
- **actions.list / actions.describe / actions.invoke / actions.status**: Discover catalog-backed executable actions with typed arguments and scope, enforce the same host permission/confirmation door, and track asynchronous request outcomes. Ordinary chat text never grants command authority.
- **events.subscribe**: Authorized filtered event stream with source, server epoch, event ID/sequence, entity revision and correlation IDs. Reconnect via retained cursor or explicit gap + fresh consistent snapshot; bounded queues/history and no fabricated exactly-once guarantee.

Every request has protocol version, request identity and explicit scope/destination. The transport establishes the principal; a supplied role string does not. Apply the current native permission/confirmation check for both UI and agent callers, and keep raw chat separate from administrative intent. Capability metadata distinguishes declared, supported, configured and runnable behavior. Do not expose private helper credentials, grants or unrelated rooms.

## Shared-plan relationships

Resolve the same canonical planner/project binding plus repository/workspace mapping; copied paths or branch names cannot establish identity. Namespace external IDs by runtime/server instance. Preserve distinct planner-caller, native-session and execution identities, optional model metadata, multi-room memberships and explicitly scoped task/execution/message links. Reuse validated instance-feature and room-phase workflow bindings. Planner ownership claims remain separate from organizational assignment.

## Data and command paths

Agent in Heca -> authorized planner tools -> canonical planner -> existing planner WebSocket -> Agent Plan UI and Heca read adapter.

Agent Plan UI -> Agent Plan server runtime facade -> public Heca owner API -> existing collaboration/action owner -> receipts/events -> both clients. An authenticated agent adapter can use the same public services with its own limited principal. Sharing a planner alone grants no enrollment, messaging or orchestrator permissions.

Keep planner entity events separate from Heca room/member/message/turn events, even when multiplexed. Snapshot/cursor bootstrap must not lose updates. Retained history is bounded; gaps/restarts require resync. UI/event sync and heartbeat handling are deterministic and make no LLM calls. Requests use correlation IDs and documented retry/idempotency limits; an interrupted acknowledgement produces unknown or a status lookup, not an automatic duplicate action. A queued message does not prove delivery, generation or task_start.

## UI and evidence

Standalone resume/planner/graph/code/controls stay usable. Optional collaboration views expose instances, rooms, members, roles, last observed state and task/workspace associations. Feature/phase/task/execution/code views link to relevant rooms and conversations. Room/direct chat shares Heca conversation/message IDs and history; separate human and agent authors. Chat does not automatically become Accepted Decisions. Read receipts cannot certify convention conformity; current-source evidence is independent of historical test success and target merges.

Task/work state, observed harness-turn state, connection availability and source/target integration are independent. Unknown native/model metadata stays unknown. Context selection does not redirect active writes or pending commands. Preserve drafts and explicit conflicts. Missing Heca/public RPC appears as unavailable, never simulated success.

## Registration ownership and external gates

Heca-Pro F003 receives a public-collaboration API phase, reusing P003(F001)/T012-T014, P006(F002)/T022, P007(F002)/T023 and P011(F003)/T032. Open Heca P099(F012)/T544 is an external host-readiness gate, not duplicated here. Heca-Pro native conformance uses a reference client and does not wait on the Agent Plan UI, avoiding a completion cycle.

Agent Plan F025 receives a consumer phase: neutral binding, live read/event connector, attributed chat/authorized actions, and collaboration UI. Existing T484-T488 own editor/source/LSP/external open; T491-T493 own executions/availability; T479/T480 own graph/inspector; T496 owns affected hierarchy/dependency reconciliation. T481/T482 retain combined final validation and installed documentation. No existing implementation owner is replaced.

Cross-project prerequisites are tracked as explicit repository/feature/task refs and runtime conformance evidence. Local dependency edges never point to another project's coincidentally numbered task. API availability requires a supported native host and version/configuration evidence, not a phase registration, schema mock or private helper test.

## Required verification scenarios

- Same planner, two workspaces and two clients; stable room/member/message identity and exact task/execution links.
- Unknown model/native session, stale registration and active work without proven native generation.
- Native host absent, public API missing, protocol incompatible, service declared but not runnable.
- Snapshot/subscription race, lost cursor, server epoch change, permission revocation and bounded slow-consumer queues.
- Room and direct chat; trusted authorship, unauthorized destination/role, message text resembling a command.
- Duplicate request, acknowledgement loss, timeout/restart uncertainty and no automatic duplicate worker launch.
- Recorded task updates continue through existing planner WebSocket without a mirrored status loop.
- Active new execution with prior result already integrated; old checks never certify changed source.
- Heca disconnected while planner, context, source drafts and checks remain usable.
- Bounded relevant context, paginated history, no full-plan reload per message and no LLM work for routine synchronization.

Use isolated mkdtemp fixtures and native supported-host checks. State exactly which results are mocked versus native. Do not use another real project planner as a fixture, run a full gate repeatedly, install globally, publish or alter release policy. This planning amendment creates no product implementation.
