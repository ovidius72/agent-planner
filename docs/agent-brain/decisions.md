# Agent Brain and Heca-Pro: accepted decisions

Consolidated register, 2026-11-02. It merges the room-chat interview of 2026-11-01 and the integration review of 2026-11-02 with Antonio. This is the product contract for both repositories; [decisions-2026-11-01](decisions-2026-11-01.md) and [decisions-2026-11-02](decisions-2026-11-02.md) remain dated records. Decisions stay revisable when a change brings a clear benefit, and every recommendation states the assumption it depends on. Protocol and schema spellings in the linked specifications are implementation proposals until conformance evidence exists.

## Scope

| Topic | Decision |
| --- | --- |
| Product | Evolve Agent Plan in this repository; preserve existing entities, IDs and history. |
| Deployment | One computer, one OS user. Multi-computer use, remote endpoints, TLS/pairing and network-hosted shared planning are outside this delivery. |
| Out of scope | Capturing native harness transcripts, autonomous AgentTest generation/execution, a test runner inside the service, a global individual-task queue. |
| AgentTest scope | Record only (decided 2026-11-02): agents run tests with their own tools; the planner records command/suite, environment, result, relevant coverage and the source/configuration revision. A result at one revision never certifies another. A built-in runner or a full AgentTest product is later work with its own design. |

## Service and storage

| Topic | Decision |
| --- | --- |
| Storage | Per-project SQLite in the user's HOME is the operational authority. JSON is an explicit export/import format, never a live mirror. |
| Process | One Agent Plan application service per OS user, serving several projects. Pi uses its adapter, other harnesses use thin MCP bridges; no client opens the database. |
| Distribution | Heca's bundled service and npm installs both place versions under `~/.agent-plan/runtime/<version>/`. The user-scoped launcher always starts the newest installed version; the service accepts protocol N and N-1. A newer installed version takes over once no write is in progress. |
| SQLite driver | Chosen by benchmark in T502 (revised 2026-11-02): `node:sqlite` (built into Node, no native addon) versus `better-sqlite3` (native addon, expected to be faster), measured on real planner flows (start/claim, context load, FTS search, bulk import, backup) on the latest Node release available when T502 starts. Either sits behind a thin persistence-driver interface. Heca bundles that pinned Node runtime; npm installs declare it as the minimum. If `better-sqlite3` wins, prebuilt binaries per OS/CPU are part of the bundle and npm packaging. Spot check 2026-11-02 on Node 22.23.4: `node:sqlite` has SQLite 3.53.4 with FTS5 and JSON working, and still prints an experimental warning. |
| Web UI access | Local only, no token (decided 2026-11-02): the service listens only on `127.0.0.1`, accepts only a `localhost`/`127.0.0.1` `Host` header (against DNS rebinding) and, on writes and WebSockets, only the Agent Plan UI and Heca origins; no `CORS *`. The LAN mode is removed. Preparation for remote use: one authentication middleware with pluggable strategies (today loopback + Host/Origin, later per-device tokens issued by pairing), a resolved `principalId` on every request for audit, and no endpoint that treats "local" as "allowed everything". |
| Existing projects | Resolve the repository descriptor first; otherwise offer a validated migration of legacy `.planner/`. |
| Folder binding | Worktrees of a registered clone bind automatically. A second clone, copy or fork carrying a known `projectId` is asked once: same project or new project (new `projectId`, descriptor rewritten for the user to commit). The answer is stored; rebinding later is explicit. With nested descriptors the nearest one walking up from the agent's working directory wins, so each monorepo sub-project has its own planner. |
| Recovery | Local history, independent backup and portable export/import, with optional publication to a configured Git branch that never touches the code checkout. |

## Agents, sessions and planner writes

| Topic | Decision |
| --- | --- |
| Entry point | Every orchestrator and worker uses planner load to register its own session and receive its own context. One shared service handles every caller; loading never opens another server or browser. |
| Integration boundary | Only agents enrolled in a Heca room carry a Heca binding. An agent started manually in a Heca terminal stays standalone. |
| Planner writes | Not restricted between agents: workers and orchestrators may modify other tasks on request. Every mutation records actor and requester (audit). No role- or room-based planner write gates and no delegation grants. Heca `Role.allow` command permissions and AgentProfile tool permissions still apply to Heca actions and tools. |
| Execution lock | The only planner block. **In-progress** blocks a start by another live session. **Parked** (after a switch or return) does not block; a takeover warns, is recorded and the original session is told on return. **Abandoned** when the adapter heartbeat (about every 30 s, in code) stops: the lease expires about 2 min after the process dies, with no manual recovery. The same logical agent (same Heca member, or same harness + workspace when standalone) reclaims its own tasks from a new conversation. A live owner idle beyond a configurable threshold (e.g. 2 h) is shown idle; another agent or the user may take over only with explicit confirmation. The Web UI offers a human Release action. |
| Task selection | Feature -> phase -> task priorities, dependencies and phase continuity stay. The orchestrator chooses the next task following planner priorities; recommendations are advisory. With the user's agreement a task may start out of order: the planner records the reason and does not block. Unmet dependencies produce a warning. |
| History | Standalone and integrated agents have attributable execution history; Heca adds verified instance, workspace, membership and orchestrator associations. |

## Heca connection

| Topic | Decision |
| --- | --- |
| Direction | Heca initiates one authenticated WebSocket to Agent Plan. Agent Plan never dials Heca. Standalone MCP/Pi callers connect to Agent Plan independently. |
| Restricted duplex | Every request from Agent Plan to Heca is an invocation of a Heca action-catalog entry through Heca's single command door (Heca decision 14), authorised for a dedicated `agent-plan` principal role. v1: planner reads/events for Heca, room snapshots/events and chat history for Agent Plan, and one reverse action, `send_message(room, to?, text)`. Further actions only per explicit use case. |
| Disconnection | Heca window closed: nothing changes. Heca server stopped: room agents stop with their terminals. Only the WebSocket dropped: rooms and agent-comms keep working. In every case Agent Plan marks rooms, members and chat stale/unavailable and preserves drafts. Planner permissions never depend on the Heca binding. |
| Independence | If Heca stops, planning continues. If Agent Plan stops, room chat, rules and orchestration continue, and planner operations report unavailable. |

## Rooms and chat

| Topic | Decision |
| --- | --- |
| Chat scope | One shared group conversation per room, exchanged through agent-comms (not a harness transcript). Heca owns its SQLite archive and attachments, kept until explicit deletion, including after the room closes. |
| Planner UI in Heca | Heca shows the Agent Plan Web UI in open Heca's generic WebView when it exists. Until then (decided 2026-11-02) Heca opens the Web UI in the system default browser; no private WebView in heca-pro and no patch to open Heca. Native planner widgets remain later work. |
| Both interfaces | Heca-Pro and the Agent Plan Web UI read and write the same room conversation. In Agent Plan: project -> its Heca-linked rooms -> room chat. Agent Plan proxies through Heca and is not a room member. |
| Addressing | Messages are visible to the whole room but delivered as model input only to addressees: the configured orchestrator by default, `@member`, or `@all` for an explicit broadcast. |
| No orchestrator | A recipient-less message is rejected (`no_default_recipient`) and the UI asks for `@member` or `@all`. An orchestrator added later becomes the default for new messages. Messages queued for a removed orchestrator stay visible as undelivered and are never redirected. |
| Member names | Stable handle per member (`worker-1`, `orchestrator`) for mentions and history, plus a live label computed at display time (model + current F/P/T, or the free-text title), e.g. `worker-1 (sonnet, F001/P001/T056)`. Typing `@` autocompletes matching members with model and F/P/T. |
| v1 message content | Plain text from Agent Plan; no attachments or native actions yet. Receipts: queued / sent / uncertain. |
| Busy recipient | Ordinary messages queue without interrupting work. Urgent intervention is explicit and only through a supported harness capability. |
| Delivery honesty | Persist local acceptance, distinguish delivery from execution, use stable message identities and expose uncertain outcomes; no unconditional exactly-once claim. |

## Room policy

| Topic | Decision |
| --- | --- |
| Workflow | Create a room in a Heca workspace, select an orchestrator and workers (or let the orchestrator create workers within limits), then follow the planner. Save the reproducible setup as YAML. |
| Execution policy | Extend Heca-Pro's Kubernetes-style workflow YAML with skills, verification, commit and review policy. No delegation group. Heca delivers the policy at creation, restart/resume and activity start without depending on Agent Plan. |
| Policy changes | Skill, review and commit changes apply from the next task; the current task keeps its policy revision. Permission revocations apply immediately. |

## Plan order

F025 phase order: P116, P128, P130, **P131** (Heca integration), P117, P118, P119, P129, P120, P121, P122, P126, P123, P125, P127, P124. A usable Heca integration ships before code intelligence, graph, LSP and Monaco; editor links in the collaboration UI are a later optional extension. See [the execution map](../../.planner/docs/agent-brain-plan.md).

## Open technical choices

These remain open; the product choices were settled with Antonio on 2026-11-02:

1. Repository descriptor: exact field spelling of `.agent-plan.json` (engineering detail of T489; binding and nesting are decided above).

Generic Heca layout details (pinning, composition, native focus) belong to their open-Heca owners. Deferred with multi-computer use: field-level reconciliation of divergent snapshots from different computers.

## Specifications

| Contract | Specification | Owners |
| --- | --- | --- |
| Service, storage, identity, recovery | [Architecture](architecture.md) | Agent Plan P128/P130 |
| Sessions, attribution, execution lock | [Session registration](session-registration.md) | Agent Plan T490/T491; Heca-Pro T023/T029/T032/T039/T047 |
| Heca connection | [Communication contract](heca-protocol.md) | Agent Plan T497-T500; Heca-Pro T043-T046 |
| Room chat and archive | [Heca room chat](../../../heca-pro/docs/room-chat.md) | Heca-Pro T012-T014/T017/T045; Agent Plan T499/T500 |
| Room execution policy | [Heca room policy](../../../heca-pro/docs/room-execution-policy.md) | Heca-Pro T021-T025 |
