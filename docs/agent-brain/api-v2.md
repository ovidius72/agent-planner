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

## Sessions

`POST /api/v2/sessions` issues the `sessionId`; the service — never the client —
chooses it. Every operation marked *session* below requires the
`x-planner-session` header naming a registered, unended session. Context reads
and task lifecycle need it because they record receipts and ownership against
the receiving session.

## Families

### Handoffs
- `GET /api/v2/handoffs?page=&pageSize=` — paged handoff archive.
- `GET /api/v2/phases/{phaseRef}/handoff/prepare` — prepare payload.
- `GET /api/v2/phases/{phaseRef}/handoff` — pending handoff.
- `POST /api/v2/phases/{phaseRef}/handoff` — write/replace a handoff.
- `POST /api/v2/phases/{phaseRef}/handoff/verify` — verify against disk.
- `DELETE /api/v2/phases/{phaseRef}/handoff` — clear.
- MCP: `planner-handoff-list`, `planner-handoff-prepare`, `planner-handoff-show`,
  `planner-handoff-write`, `planner-handoff-verify`, `planner-handoff-clear`.

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
- MCP: `planner-task-recommend`; documents/search are read by adapters that
  surface them.

### Context (session)
- `GET /api/v2/context/project?maxChars=`, `/context/guidelines`,
  `/context/requirements?phaseRef=`, `/context/features/{featureRef}`,
  `/context/phases/{phaseRef}`, `/context/tasks/{taskRef}`.
- Deliveries are attested against the calling session; an unregistered caller
  cannot produce a receipt.
- MCP: `planner-load` (project context + recap composition),
  `planner-project-guidelines-show` (`/context/guidelines`).

### Sessions
- `POST /api/v2/sessions` (register), `POST /api/v2/sessions/{sessionId}/heartbeat`,
  `DELETE /api/v2/sessions/{sessionId}` (end), `POST /api/v2/sessions/recover`.
- Principal authentication and grants are C4's scope; a session id is identity,
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
| `planner-export` | Writes a multi-file artifact to a caller-chosen host directory. |
| `planner-authorize-bypass` / `planner-clear-bypass` | Per-process agent guard state bound to the harness session; authorization arrives with C4. |
| `planner-version` | Adapter package build metadata. |
| `planner-web` | Dashboard process lifecycle (start/stop/status) on the host. |
| `planner-disable` | Stops the MCP server process itself. |
| `planner-load` | Composite host operation: session preparation, recap, skill-file sync and dashboard start; its domain reads are the v2 context and list routes. |
| `planner-show` | Recap/overview presentation composed from v2 list and read data (project, features, tasks). |

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
