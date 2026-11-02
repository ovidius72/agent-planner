# Agent Brain and Heca-Pro communication contract

Consolidated 2026-11-02. The [decision register](decisions.md) is the product contract. DTO names and endpoint spelling below are the implementation schema proposal; no released API or successful native integration is claimed.

## Ownership and independence

| Owner | State |
| --- | --- |
| Agent Plan service | Projects, requirements, decisions, tasks, context, ownership, executions and verification history in its SQLite store. |
| Heca-Pro server | Rooms, membership, assignment, policies, orchestration, room messages and its conversation archive. |
| Heca helper | The single adapter to agent-comms, over its existing bounded private pipe. |
| Native harness integration | Native agent/session metadata and declared delivery capabilities. |

Heca and Agent Plan operate independently. Agent Plan never opens Heca's database or joins the agent mesh. Heca's native planner connector reads through Agent Plan's API; agents perform planner mutations through their own MCP/Pi clients.

There are two UI consumers: Heca displays the planner's project Web UI in open Heca's generic WebView overlay once it exists, and in the system default browser until then, with later native widgets still planned; Agent Plan can display linked Heca rooms, participants, history and chat actions for the selected project. Both use the same service contracts.

## Connection direction

Heca initiates one authenticated WebSocket connection to Agent Plan per server/principal/service relationship. Several authorised project subscriptions are multiplexed over it. It is a restricted duplex: Heca requests planner reads/subscriptions and publishes runtime facts; every request from Agent Plan to Heca is an invocation of a Heca action-catalog entry through Heca's single command door (Heca decision 14), authorised for a dedicated `agent-plan` principal role, with results returned over the already-open channel. No Heca public HTTP listener is required.

Standalone MCP/Pi/CLI agents connect to Agent Plan directly. An agent manually launched in a Heca terminal stays standalone even when a generic wrapper/status integration recognises it. Only explicit room membership supplies an integrated binding.

| Link | Target transport |
| --- | --- |
| Harness -> MCP adapter | Existing MCP contract, normally stdio. |
| Pi/MCP/CLI -> Agent Plan | Versioned authenticated command/read API. |
| Browser -> Agent Plan | Its HTTP API and browser WebSocket. |
| Heca -> Agent Plan | Heca-initiated authenticated, bidirectional WebSocket with requests, responses and events. |
| Heca -> helper | Existing private pipe. |
| Heca native windows -> Heca | Existing native server/client transport and action system. |

The Heca channel and the browser channel have different peer roles and grants; a browser cannot impersonate a Heca integration. Integration messages do not become a second native action dispatcher.

## Bootstrap and planner load

planner load is each agent's entry point: descriptor resolution, supported service bootstrap/reuse, session registration and complete applicable context delivery. Dashboard opening is independent, so multiple loads create neither multiple web servers nor browser windows. See [all registration fields](session-registration.md).

Heca discovers Agent Plan through its protected user-scoped service record and verifies server identity, boot epoch and protocol compatibility (N or N-1). If no service runs, Heca starts the newest version installed under `~/.agent-plan/runtime/<version>/`, where its bundled version is also installed. Local credentials are obtained through protected same-user provisioning. Multi-computer use (remote endpoints, TLS, pairing) is outside this delivery.

Heca attaches only opted-in planner/project integration. A room can exist and receive policy before the planner starts. The room harness integration and planner load use an opaque member bootstrap reference to correlate the caller; the reference is not inferred from cwd or generic terminal environment. The integration provider retries late service availability in code without requiring repeated model turns. Migration/init and credential consent retain their existing explicit user decisions.

If Heca stops, planner operation continues. If Agent Plan stops, room chat, rules and orchestration continue, while actual planner reads/claims report unavailable. A projection, queued request or YAML record never proves an offline planner mutation occurred.

## Handshake and scope

Proposed opening fields:

```json
{
  "protocolVersion": 1,
  "requestId": "request-uuid",
  "client": {"kind": "heca-pro", "version": "compatible-version"},
  "serverId": "persistent-heca-server-id",
  "bootEpoch": "heca-boot-uuid",
  "projects": [{"projectId": "planner-project-uuid", "repositoryRegistrationId": "registered-clone-id"}],
  "capabilities": ["rooms.read", "chat.read", "action.send_message"]
}
```

Credentials accompany authenticated transport, never this durable metadata. Agent Plan returns its service/boot identity, compatible protocol, granted project scopes, capabilities and replay positions. Bindings include source workspace registrations and authorised Heca instance/member/room relationships. Canonical UUIDs identify planner entities; short labels and filesystem paths only aid presentation/location.

One Heca server may advertise several feature-focused instances for one project; Agent Plan aggregates them. Instance, room, native conversation, planner session and task execution are distinct. A member may belong to several rooms. Authorise every requested binding and never enumerate unrelated projects in the handshake.

## Bidirectional operation contract

Use a typed envelope with kind=request/response/event, protocolVersion, requestId or correlationId, source serverId/bootEpoch, projectId/bindingId, operation or event type, payload and optional expectedRevision/idempotencyKey. Bound request size, timeouts, concurrent calls and queues in configuration. Generated schemas/compatibility fixtures connect the two owners; do not duplicate validation logic by hand.

| Family | Semantics |
| --- | --- |
| Planner read/subscription | Heca requests feature/phase/task/history snapshots and committed events. |
| Runtime binding | Heca publishes verified instances, members, native sessions, policy references and membership changes. |
| Heca snapshot/subscription | Agent Plan requests authorised current rooms, participants, assignments and runtime events. |
| Chat list/history/search | Agent Plan requests pages from Heca's archive. |
| Chat send/status | v1 reverse action `send_message(room, to?, text)`: plain text, no attachments. Heca checks the `agent-plan` principal role at the one door and returns queued / sent / uncertain receipts. |
| Further actions | Added only per explicit use case, always as Heca action-catalog entries through the same door. |

Messages are visible to the whole room but delivered as model input only to addressees: the configured orchestrator by default, `@member`, or `@all` for an explicit broadcast. A room without an orchestrator rejects a recipient-less message with `no_default_recipient`; messages queued for a removed orchestrator stay undelivered and are never redirected. Ordinary messages queue without interrupting busy agents. Both UIs can compose and send. Agent Plan remains a proxy, not a room agent. [Room chat](../../../heca-pro/docs/room-chat.md) owns delivery, archive, attachments and visibility details.

Heca metadata publication does not give its connector planner write authority; agents write through their own callers, recorded with requester and executor. Planner permissions never depend on the Heca binding.

## Events and history

Persistent event cursors are scoped by archive/server identity; bootEpoch identifies runtime reconnection. Do not substitute timestamps for replay cursors. Snapshots and subscription replay must cover the same consistent boundary. Expired/gapped cursors require explicit resnapshot; slow clients must not receive silently incomplete state.

Heca persists room messages and attachments until explicit deletion, including after room closure. Agent Plan stores planner/execution history and attributable Heca associations, not a second operational chat archive. Archive replay does not execute commands, restart agents or deliver old messages as fresh instructions.

Each request has a stable idempotency key scoped to principal, project, destination and payload. Persist acceptance before acknowledging it. Distinguish queued, sent/transport-delivered, read/consumed, rejected, failed and uncertain outcomes; track recipients separately. None proves a model acted, a task started or code was integrated. A timeout is not proof of failure. Retry automatically only when the adapter's deduplication/status contract makes it safe.

The current agent-comms boundary does not establish a durable archive acknowledgement or an application-controlled send ID by itself. T012/T013/T045 must demonstrate the chosen stable-envelope/deduplication or compatible upstream receipt mechanism before enabling safe replay. Until then report uncertainty; do not silently invent delivery or exactly-once execution.

## Rules, permissions and UI

Heca delivers room rules at member creation, restart/resume and activity start independently of Agent Plan. Skill/review/commit policy is pinned for the current task; changes apply from the next task. Permission revocations affect later operations immediately. See [execution policy](../../../heca-pro/docs/room-execution-policy.md).

Protect credentials outside YAML, descriptors, exports and browser bundles. Authenticate peers, authorise project/room/operation on every request, validate browser origins, and keep administrative confirmation in the existing native action door. Chat text never implicitly becomes an unchecked shell or RPC command.

| Runtime result | UI behaviour |
| --- | --- |
| No authorised Heca binding | Core planner remains usable; live collaboration is unavailable. |
| Verified project binding | Show the authorised aggregate of instances, rooms and participants. |
| Heca disconnected | Mark rooms, members and chat stale/unavailable, keep last-known data, preserve drafts; planner permissions are unchanged. |
| Protocol incompatible | Explain compatibility failure; do not create a second service or planner. |
| Access revoked | Remove unauthorised data/actions and reject pending unauthorised operations. |

Room/feature selection never redirects an already submitted message. Display the destination and delivery state in both composers. The project WebView supports ordinary browser mouse/keyboard/IME interaction; native actions own open/close/focus. Generic browser/editor/tab/pinning choices remain in their existing Heca owners.

## Current owners and acceptance

Agent Plan T490/T491/T497-T500 and Heca-Pro T012-T014/T017/T021-T025/T029/T032/T039/T043-T047 own this contract. Heca-Pro T043 and Agent Plan T497 co-own the channel; the planner cannot express this cross-project dependency, so each task names the other.

Prove both startup orders, standalone terminal agents inside Heca, several projects/instances, multiple memberships, late native IDs, actor/requester audit, denied/forged IDs, sender/recipient attribution, no unintended model wakeup, busy-message queueing, policy-version changes, revocation, event replay/gaps, archival after closure and crash/unknown-send outcomes on a supported native host. Schema/pipe tests alone do not prove that workflow.
