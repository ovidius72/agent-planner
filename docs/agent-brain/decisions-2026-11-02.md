# Agent Brain and Heca-Pro: review decisions, 2026-11-02

> Dated record of 2026-11-02. The current consolidated register is [decisions.md](decisions.md).

Accepted with Antonio on 2026-11-02 during the integration review. These decisions take precedence over [the 2026-11-01 register](decisions-2026-11-01.md), [the communication contract](heca-protocol.md), [session registration](session-registration.md) and [architecture](architecture.md) wherever they differ. Rows of the earlier register not named below remain valid. All decisions stay revisable when a change brings a clear benefit; each recommendation states the assumption it depends on.

## Decision register

| # | Topic | Accepted behaviour | Supersedes |
| --- | --- | --- | --- |
| 1 | Channel shape | Restricted duplex. Heca still initiates the WebSocket. Every reverse request from Agent Plan is an invocation of a Heca action-catalog entry through Heca's single command door (Heca decision 14), authorised for a dedicated `agent-plan` principal role. v1: planner reads/events for Heca plus one reverse action, `send_message(room, to?, text)`. Further reverse actions are added only per explicit use case. | Open-ended "Agent Plan requests Heca room/history/action operations" in the communication contract. |
| 2 | Web UI access | *Revised the same evening: local only without a token (loopback, Host and Origin checks, LAN mode removed, pluggable auth middleware); see [decisions.md](decisions.md).* Originally: an authenticated token, restricted origin/CORS, and no unauthenticated LAN writes. | Current `cors({origin:"*"})` without auth in `plan-server`. |
| 3 | Room chat in Agent Plan | Navigation: project -> its Heca-linked rooms -> room group chat (the agent-comms room conversation, not a harness transcript). Messages are visible to the whole room but delivered as model input only to addressees: the configured orchestrator by default, `@member`, or `@all` for an explicit broadcast. v1 is plain text; no attachments or native actions. Receipts: queued / sent / uncertain. | Default destination and visibility rows of the 2026-11-01 register are refined, not replaced. |
| 4 | Room without orchestrator | A recipient-less message is rejected with a typed `no_default_recipient` error; the UI asks for `@member` or `@all`. An orchestrator added later becomes the default for new messages. Messages queued for a removed orchestrator stay visible as undelivered and are never redirected. | - |
| 5 | Member names | Stable handle per member (`worker-1`, `orchestrator`) used for `@mentions` and history, plus a live label computed at display time (model + current F/P/T, or the free-text title), e.g. `worker-1 (sonnet, F001/P001/T056)`. Typing `@` autocompletes matching members and shows model and F/P/T. The label is never part of the stored name. | - |
| 6 | Planner write permissions | No inter-agent planner write restrictions: workers and orchestrators may modify other tasks on request. Every mutation records actor and requester (audit). Role/room-based planner write gates, YAML delegation grants and the "Heca binding not verified" fallback are dropped. Heca `Role.allow` command permissions and `AgentProfile` tool permissions remain. Real protection is for browser/network access (row 2). | Delegation row of the 2026-11-01 register; "Delegated commands" in session registration and the communication contract; Heca-Pro F002 decision "scoped planner writes" (now "Planner writes are free and attributed"). |
| 7 | Execution lock | The only planner block. Three states: **in-progress** blocks a start by another live session; **parked** by a switch/return does not block, a takeover warns, is recorded and the original session is told on return; **abandoned** when the adapter heartbeat (about every 30 s, in code, not model turns) stops, the lease expires about 2 min after the process dies, with no manual recovery. The same logical agent (same Heca member, or same harness + workspace when standalone) reclaims its own tasks from a new conversation. A live owner idle beyond a configurable threshold (e.g. 2 h) is shown idle; another agent or the user may take over only with explicit confirmation. The Web UI offers a human Release action. | Today's permanent ownership that rejects a resume (`TASK_OWNED_BY_ANOTHER_SESSION`). |
| 8 | Task selection | The orchestrator chooses the next task following planner priorities; recommendations are advisory. With the user's agreement a task may start out of priority order: the planner asks for and records a deviation reason and does not block. Unmet dependencies produce a warning. | - |
| 9 | Disconnection | Heca window closed: nothing changes. Heca server stopped: room agents stop with their terminals; Agent Plan shows rooms/chat unavailable. Only the WebSocket dropped: rooms and agent-comms keep working; Agent Plan marks rooms, members and chat stale/unavailable and preserves drafts. Planner permissions never depend on the Heca binding. | Standalone-permission fallback discussed earlier the same day. |
| 10 | Multi-computer | Out of scope for this delivery: no remote endpoint, TLS, pairing or NAT story. One computer, one OS user. | Remote paragraph of the communication contract. |
| 11 | Distribution | Heca's bundled service and npm installs both place versions under `~/.agent-plan/runtime/<version>/`. The user-scoped launcher always starts the newest installed version; the service accepts protocol N and N-1; MCP/Pi bridges are thin, version-tolerant clients. A newer installed version takes over once no write is in progress. No "first starter wins" incompatibility. | README remaining decision 2 (packaging/discovery). |
| 12 | F025 order | P131(F025) "Optional Heca public API client and collaboration UI" moves to phase 4, right after P116/P128/P130, so a usable Heca integration ships before code intelligence, graph, LSP and Monaco. Code/editor links in the collaboration UI become an optional later extension. | Phase-15 position in the replan registration and execution map. |

## Planner changes applied, 2026-11-02

All writes used the PlanStore API; task identities, states, checklists and history were preserved. Field-level diffs show only descriptions, `descriptionUpdatedAt`, `updatedAt` and the two decision texts changed besides the dependency and priority edits listed here. Every amended entity starts with a "Review amendment, 2026-11-02" block that takes precedence over the earlier wording below it.

Agent Plan (this repository):

- Phase priorities in F025: 1 P116, 2 P128, 3 P130, **4 P131**, 5 P117, 6 P118, 7 P119, 8 P129, 9 P120, 10 P121, 11 P122, 12 P126, 13 P123, 14 P125, 15 P127, 16 P124.
- Removed dependencies: T500 -> T487, T500 -> T488, T497 -> T491, T498 -> T493.
- Amended: F025; P117, P128, P131; T463, T464, T490, T497, T498, T499, T500.
- Parent freshness: no new stale parent compared with the before snapshot.

Heca-Pro (planner only; its documents and code were not changed):

- Amended tasks: T012, T017, T021, T022, T023, T024, T025, T029, T039, T043, T044, T045, T047; parents P3, P4, P5, P6, P7, P9, P11, P19 and F1, F2, F3.
- F002 decision `a5a57885` retitled "Planner writes are free and attributed (supersedes scoped planner writes)"; decision `352a84e5` gained a note that delegated planner operations are removed.
- Parent freshness: no new stale parent compared with the before snapshot.

## Known follow-ups

- Heca-Pro documents were aligned the same day (banners plus edits in room-chat, room-execution-policy, agent-brain-integration, agent-plan-work, decisions 26/64, workflow-file, components, architecture, agent-brain-registration). Heca-Pro T012 and T022 are not done; their tasks carry the code-check notes instead of code changes.
- Cross-project prerequisites (Heca-Pro T043/T047 versus Agent Plan T497) still cannot be expressed as planner dependencies; they are recorded in the task texts.
- The UI prototypes contain no Heca room, member or chat screens; design intake is needed before T500 (see [UI prototypes](ui-prototypes.md)).
