# Versioned application API (`/api/v2`)

Status: implemented surface for P128(F025)/T490 C2. Every operation below runs a
shared `plan-core` flow; adapters (MCP, Pi, CLI, Web UI) only map the flow
result, refusal code and rendering to their own envelope. The legacy read-only
model API stays at `/api/v1` and is not replaced.

## Envelope and verbs

- Success: `{ "apiVersion": "2", "data": … }`.
- Error: `{ "apiVersion": "2", "error": { "code", "message", …details } }`.
- Status mapping is uniform: `400 INVALID_BODY` for a missing/invalid JSON body,
  `404` for an unknown entity, `409` for a refused state transition or missing
  confirmation, `422` for missing/invalid input, `500` only for a failed
  persistence/verification step.
- `error.code` is the stable contract. Adapters map codes to their own action
  labels and texts; they never re-derive domain messages.
- The status class is part of the contract too: 4xx is a refusal a client
  renders, 5xx is a service fault it propagates. `PlannerApiClient` throws
  `PlannerApiError` for the former and `PlannerServiceFailure` for the latter.
- Discovery: `GET /api/v2` returns the protocol version, boot id, service
  origin, the session header name and the full `families` map. The map is
  pinned by `packages/plan-server/test/api-v2.test.mjs` ("discovery inventory is
  the frozen complete application surface").

## Registered SQLite project scope

Start the registered-project authority with `agent-plan serve --user --json`.
MCP and Pi planner load can also launch a dedicated runtime that outlives
the harness. `agent-plan stop --user` stops a verified dedicated runtime.
From a registered descriptor checkout, `agent-plan serve --json` resolves the
scope and returns its project and workspace IDs, dashboard URL and verified endpoint.
On first registered launch an npm installation stages a private, version-pinned
copy under `~/.agent-plan/runtime/<version>/node_modules/@agent-plan/server/`.
A bundled distribution can supply the same package layout and an optional pinned
`bin/node` under its version directory. The launcher selects the newest
compatible installed version. A newer version reuses the same loopback port,
after the new runtime passes a startup probe and the dedicated service drains
admitted work and retires its previous boot.
Discovery advertises the runtime version and the supported protocol generations.
Protocol 1 is the first supported generation.
Its boot record is under the user's Agent Plan runtime directory. Project
requests require the UUIDs of a registered project and workspace, and the
service grants access only to principals recorded for that project. The
registered project store must already exist and be upgraded to schema 3.
`POST /api/v2/projects/resolve` accepts an absolute `cwd` and returns IDs
only after matching the descriptor and project grant. A linked Git worktree
is registered when Git confirms that it belongs to an already registered clone.

| Method | Path under `/api/v2/projects/{projectId}/workspaces/{workspaceId}` |
| --- | --- |
| GET | The scope itself returns project identity, revision and language preferences. |
| GET | `/project/overview` returns project metadata, summaries and active-task evidence. |
| GET | `/project/plan` returns the complete plan for clients that explicitly request it. |
| GET | `/project/export?full=` renders a Markdown export without modifying planner state. |
| GET | `/project/guidelines` reads current Project Guidelines. The full task context records the execution read receipt. |
| GET | `/project/description-freshness` previews leaf-to-root description reconciliation for this project. |
| GET | `/recommend` reads the recommendation for the live registered session, including its active work or pending return. |
| POST | `/project/update` updates project metadata and guidelines with `requestId` and `fields`. Supply `fields.expectedGuidelinesUpdatedAt` to guard against stale guideline edits. |
| GET | `/features`, `/phases`, `/tasks` return discovery summaries with the same ref filters as the legacy API. |
| GET | `/features/{ref}`, `/phases/{ref}`, `/tasks/{ref}` return scoped identity. Features and phases accept `full=true` for description, decisions and related requirements. Use `/tasks/context` to deliver and attest full task context. |
| POST | `/entities/create` allocates stable feature, phase and task IDs and creates the entity under the project transaction. |
| POST | `/entities/delete` takes `kind`, `ref` and a stable `requestId`. Tasks require `confirmed: true`. Feature deletion unlinks phases by default, or deletes them with `cascade: true`. |
| POST | `/entities/reorder` takes an entity `kind`, `movedId`, nullable sibling IDs `beforeId` and `afterId`, and a stable `requestId`. When priorities are too close, siblings are reindexed in the same transaction. |
| POST | `/entities/update` edits feature, phase or task fields with optional `expectedUpdatedAt` checks. Start/reopen/complete use their dedicated commands. |
| POST | `/entities/discuss` saves discussion fields and records context-ready provenance for features and phases. |
| GET | `/board` reads the project, features, phases, tasks, requirements and focus for the browser. |
| GET | `/ideas`, `/ideas/{ref}` list the Ideas Inbox or read an exact entry. |
| POST, PUT, DELETE | `/ideas` and `/ideas/{ref}` manage an inbox entry with a `requestId`. Deletion also requires `confirmed=true`. |
| POST | `/ideas/{ref}/promotion/begin` prepares a discussion. `/ideas/{ref}/promotion/finalize` records an existing target after confirmation using `requestId`. |
| GET | `/handoffs` lists handoffs in pages. Use `archived=true` for archives and `includeContent=true` for a page that includes document bodies. |
| GET | `/handoffs/{phaseRef}` reads a phase handoff with the bounded work map and verification status. |
| POST | `/handoffs/clear` archives the active handoff. Supply `ref`, `requestId` and `confirmed: true`. |
| POST | `/handoffs/prepare` returns the draft scaffold and current write token for `ref`. An optional `supportingDocuments` manifest is validated against scoped documents. |
| POST | `/handoffs/write` persists a confirmed, reconciled capsule and related planner context in one transaction. Supply `ref`, `requestId` and the write request in `fields`. Read the stored capsule before verification. |
| POST | `/handoffs/verify` validates the existing persisted capsule and read-back hash. Supply `ref`, `requestId` and `fields.expectedContentHash`. |
| GET | `/requirements` lists requirements. Use `phaseRef` to filter by a phase and its owning feature. The full task context records the execution read receipt. |
| POST | `/requirements/create`, `/requirements/update` and `/requirements/delete` change requirements and their phase links. Supply `requestId`, `fields` for create/update and `requirementId` for update/delete. Updates accept `fields.expectedUpdatedAt` for stale edit detection. |
| GET | `/accepted-decisions` lists the decisions of one `targetType` and `targetRef`. Omit the ref for the project. |
| POST | `/accepted-decisions/create`, `/accepted-decisions/update` and `/accepted-decisions/delete` change a decision within its owner. Supply `requestId`, the target, and `fields` for create/update or `confirmed: true` for delete. |
| POST | `/tasks/context` delivers and records the full context for a task and a live session. |
| POST | `/tasks/start` claims startable work through the same session after its context has been read. Supply a `ref` and a stable `requestId` to retry the same command. Taking over from an idle live owner requires explicit `confirmedTakeover: true`. |
| POST | `/tasks/deviation` records approval without changing task status. Supply the temporary task as `ref`, an optional `resumeTask`, a `reason` and a stable `requestId`. |
| POST | `/tasks/switch` checkpoints and releases the source, claims the destination, and records the return target in one transaction. |
| POST | `/tasks/recover` transfers active work and pending returns from an expired or ended session after explicit confirmation. Recovery is scoped to the same project, workspace, principal, and harness kind. |
| POST | `/tasks/reopen` reopens completed work after explicit confirmation and retains prior completion evidence. |
| POST | `/tasks/release` returns a task to planned after the dashboard user confirms release of an idle or abandoned claim. |
| POST | `/tasks/pause` saves a durable checkpoint and releases the owning session's claim. Supply a reason, the work underway, the resume location, and resume instructions. |
| POST | `/tasks/checklist/toggle` changes a single checklist item's checked state. Supply `ref`, `requestId`, `item`, and optionally `checked`. |
| POST | `/tasks/checklist/add` and `/tasks/checklist/remove` edit an individual checklist item. Supply `ref`, `requestId` and `item` with the new title or the existing item selector. |
| POST | `/tasks/dependencies` adds or removes a project-scoped dependency. Supply `ref`, `dependsOn`, `requestId` and `action`. Deletion requires `confirmed: true`. |
| POST | `/tasks/move` moves up to 100 tasks in one transaction using their IDs. Supply `tasks` with the source references, `targetPhase` and `requestId`. The response reports new refs and active handoffs on source phases. |
| POST | `/tasks/complete` completes the owning session's active task after validating checklist and completion evidence. Supply `descriptionUpdate`, `ref`, and `requestId`. |
| GET | `/snapshot` returns project metadata, bounded feature, phase, task and document summaries, and a consistent outbox cursor. |
| GET | `/events?after={cursor}` returns up to 100 project events and indicates whether more are available. |
| WS | `/events/stream` sends a snapshot and new events, or replays from `after` when the supplied `bootId` matches. |
| POST | `/sessions` registers the caller and issues a two-minute session lease. |
| POST | `/context/load` delivers planner context for the live `x-planner-session`. Incomplete deliveries do not create a read receipt. |
| POST | `/sessions/{sessionId}/heartbeat` renews a live lease within its original scope. |
| DELETE | `/sessions/{sessionId}` ends the lease. |
| GET | `/search?q={query}` searches project documents. |
| GET | `/documents/{id}` reads a document. |
| GET | `/documents?path=` resolves a logical Markdown path under `.planner/docs/` to a document. |
| PUT | `/documents/{id}` takes `requestId` and `content`, plus `expectedRevision` for a project revision or `expectedDocumentRevision` for a document-local revision. |

Deletion commits with its audit receipt and event. An inbound dependency from a task outside the deletion, active work or a saved checkpoint, a retained deviation, or a retained phase handoff causes an explicit refusal. A refused cascade leaves the entire feature and its descendants intact.

A document update commits its revision, receipt, audit row and event together.
Reusing the same request ID with identical content under the same principal
returns the prior result. The older unscoped application routes are served
by the legacy root service while client and domain migration continues.

The service marks an active claim idle after two hours without an execution
change by its owner. Set `AGENT_PLAN_EXECUTION_IDLE_MS` in the service
environment to change the threshold. Lease heartbeats keep the session alive
independently of execution activity.


## Sessions

`POST /api/v2/sessions` issues the `sessionId`; the service — never the client —
chooses it. Every operation marked *session* below requires the
`x-planner-session` header naming a registered, unended session. Context reads
and task lifecycle need it because they record receipts and ownership against
the receiving session.

## Families

### Handoffs
- `GET /api/v2/handoffs?page=&pageSize=` — paged handoff archive.
- `GET /api/v2/phases/{phaseRef}/handoff/prepare` — prepare payload. GET has
  no body, so an already-known `supportingDocuments` manifest travels as a
  JSON array in `?supportingDocuments=`; it is optional and usually
  unnecessary (oversized content is externalized automatically).
- `GET /api/v2/phases/{phaseRef}/handoff` — pending handoff.
- `POST /api/v2/phases/{phaseRef}/handoff` — write/replace a handoff.
- `POST /api/v2/phases/{phaseRef}/handoff/verify` — verify against disk.
- `DELETE /api/v2/phases/{phaseRef}/handoff` — clear.
- MCP: `planner-handoff-list`, `planner-handoff-prepare`, `planner-handoff-show`,
  `planner-handoff-write`, `planner-handoff-verify`, `planner-handoff-clear`
  (all bridged; the adapter rebuilds the typed handoff error from
  `failureKind` + code + details, so both transports share one rendering).

### Requirements and accepted decisions
- `GET|POST /api/v2/requirements`, `PUT|DELETE /api/v2/requirements/{requirementId}`.
- `GET|POST /api/v2/accepted-decisions`, `PUT|DELETE /api/v2/accepted-decisions/{decisionId}`
  (delete requires `?targetType=&targetRef=&confirmed=true`).
- MCP: `planner-requirement-*`, `planner-accepted-decision-*`.

### Features, phases and tasks (CRUD + discuss)
- `GET|POST /api/v2/features`, `GET|PUT|DELETE /api/v2/features/{featureRef}`
  (delete takes `?cascade=true`), `PUT /api/v2/features/{featureRef}/discuss`.
- `GET|POST /api/v2/phases`, `GET|PUT|DELETE /api/v2/phases/{phaseRef}`,
  `PUT /api/v2/phases/{phaseRef}/discuss`.
- `GET /api/v2/tasks`, `GET|PUT|DELETE /api/v2/tasks/{taskRef}` (delete takes
  `?confirmed=true`), `POST /api/v2/phases/{phaseRef}/tasks`,
  `PUT /api/v2/tasks/{taskRef}/discuss`.
- Task sub-resources: `POST /api/v2/tasks/move`,
  `POST|DELETE /api/v2/tasks/{taskRef}/dependencies`,
  `POST /api/v2/tasks/{taskRef}/checklist`,
  `POST /api/v2/tasks/{taskRef}/checklist/toggle`,
  `DELETE /api/v2/tasks/{taskRef}/checklist?item=`.
- Flow-rendered text travels in the envelope: creation replies
  (`POST /features`, `POST /phases`, `POST /phases/{ref}/tasks`), checklist
  add/toggle/remove and `POST /tasks/move` return the flow's `message`, so a
  client prints the same sentence the in-process tool did instead of
  rebuilding it. Dependency replies return the persisted `task` for the same
  reason.
- The discuss routes accept an optional `contextReadyReason`: provenance is the
  calling surface's fact, and omitting it records the API's own wording.
- Handoff prepare/show also return the flow's rendered `message`.
- Handoff errors carry `details.failureKind`, because a flow refusal
  (`refusal`) and a contract violation (`contract`) share the 4xx class but a
  client renders them differently: a refusal is usually a plain sentence, a
  contract violation is the pinned `❌ Handoff <action> denied [CODE]` block
  with its typed details. A write whose sync block fails plain-Error
  validation (missing `phaseNoUpdateReason`, a task outside the phase,
  incomplete completion evidence) is `422 HANDOFF_WRITE_INVALID` with
  `failureKind: "validation"` — a refusal of that request, not a service
  fault, and the retained body can be resent without `content`.
- Project settings: `PUT /api/v2/project/discuss`,
  `PUT /api/v2/project/guidelines` (optional `expectedUpdatedAt` guard,
  `409 PLAN_STALE_WRITE`), `PUT /api/v2/project/language`.
- MCP: `planner-feature-*`, `planner-phase-*`, `planner-task-*`,
  `planner-project-discuss`, `planner-project-guidelines-update`,
  `planner-project-language`.

### Lifecycle, deviations and recovery
- `POST /api/v2/tasks/{taskRef}/start|complete|pause|reopen` — *session*.
- `POST /api/v2/tasks/switch` — *session*; atomic source checkpoint, target
  claim and LIFO deviation (`422 SWITCH_CHECKPOINT_REQUIRED` carries the
  required context).
- `POST /api/v2/deviations` — *session*; records an approved detour without
  transitioning a task.
- `POST /api/v2/sessions/recover` — *session*; confirmed, single-owner recovery.
- MCP: `planner-task-start|complete|pause|reopen|switch|deviation`,
  `planner-session-recover`.

### Ideas Inbox
- `GET|POST /api/v2/ideas`, `GET|PUT|DELETE /api/v2/ideas/{ideaRef}`
  (delete takes `?confirmed=true`),
  `POST /api/v2/ideas/{ideaRef}/promotion/begin`,
  `POST /api/v2/ideas/{ideaRef}/promotion/finalize`.
- Promotion is the two-step protocol: `begin` persists nothing, `finalize`
  records an already-created target only with `discussionCompleted=true` and
  `confirmed=true`.
- MCP: `planner-idea-*`, `planner-idea-promotion-begin|finalize`.

### Documents and search
- `GET /api/v2/documents`, `GET /api/v2/documents/view?path=`,
  `PUT /api/v2/documents/save`, `GET /api/v2/search?q=&limit=`,
  `GET /api/v2/recommend`.
- Recommendation uses the caller's focus and return state when a registered
  session header is supplied. `?view=summary` returns a bounded text and
  structured reply for MCP. Headerless callers retain the unscoped default.
- Task metadata updates also accept a registered session header so status
  changes can refresh that caller's resume state.

### Context (session)
- `POST /api/v2/context/load` prepares a registered caller and returns the
  completed recap and context delivery. It accepts optional `maxChars` and
  `harness` fields.
- `GET /api/v2/context/project?maxChars=`, `/context/guidelines`,
  `/context/requirements?phaseRef=`, `/context/features/{featureRef}`,
  `/context/phases/{phaseRef}`, `/context/tasks/{taskRef}`.
- The task route returns and attests the full context bundle by default.
  With `?scope=task`, it attests only the task and returns the metadata
  needed to render its start-gate advisory. Read parent entities and
  requirements through their respective endpoints for separate receipts.
- Deliveries are attested against the calling session; an unregistered caller
  cannot produce a receipt.
- MCP: `planner-load` (project context + recap composition),
  `planner-project-guidelines-show` (`/context/guidelines`).

### Sessions
- `POST /api/v2/sessions` (register), `POST /api/v2/sessions/{sessionId}/heartbeat`,
  `DELETE /api/v2/sessions/{sessionId}` (end), `POST /api/v2/sessions/recover`.
- Issued sessions are bound to the server-resolved principal and planner project.
  Full project/workspace grants and audit are C4's scope; a session id is identity,
  not authorization.

## Deliberately not on `/api/v2`

These are host/adapter operations over the workspace or the agent process, not
application operations over plan data. They stay in the adapter until a later
checklist item gives them a service contract:

| MCP operation | Why it is not a v2 endpoint |
| --- | --- |
| `planner-init` | Bootstraps `.planner/` before any service or plan exists; needs a host-chosen root. |
| `planner-repair` | Storage maintenance: rebuilds derived files and repairs manifests. |
| `planner-cleanup-orphan-phases` | Destructive legacy cleanup, host-triggered and diagnostic. |
| `planner-description-freshness` | Diagnostic preview only (still available on v1 as `/description-freshness`). |
| `planner-project-context-migrate` | One-time legacy rule/decision migration with an explicit preview step. |
| `planner-authorize-bypass` / `planner-clear-bypass` | Per-process agent guard state bound to the harness session; authorization arrives with C4. |
| `planner-version` | Adapter package build metadata. |
| `planner-web` | Dashboard process lifecycle (start/stop/status) on the host. |
| `planner-disable` | Stops the MCP server process itself. |

For overview and the Markdown report, use `GET /api/v2/project/overview` and
`POST /api/v2/project/export` with optional `full` in the body.

## v1 compatibility

- `/api/v1` remains a separate read-only model API (`packages/plan-server/src/api-v1.ts`),
  mounted unconditionally in `serve.ts` before the v2 app. v2 is additive.
- `packages/plan-server/test/api-v1-contract.test.mjs` pins every v1 reply shape
  against `test/fixtures/api-v1-shapes.json`; a removed/renamed/retyped field
  fails the suite, so external programs cannot be broken silently.
- The unprefixed HTTP routes in `serve.ts` that the current Web UI uses are
  untouched; converting that client to v2 is C3, not a v1 change.
- v2 is mounted only when admission security is constructed, i.e. for a real
  service; the v1 contract does not depend on it.

## Evidence

- `packages/plan-server/test/api-v2.test.mjs` — per-family end-to-end tests over
  real HTTP and real `.planner/` fixtures, plus the frozen discovery inventory.
- `packages/plan-core/test/*` — the shared flows each family runs.
- `packages/plan-mcp/test/*` — MCP parity on texts, structured payloads and
  refusal codes after each delegation.
