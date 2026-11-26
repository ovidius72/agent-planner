# Client parity: MCP, Pi, CLI and Web UI on one API

Status: inventory for P128(F025)/T490 C3. It records what each client does
today, what the versioned API offers for the same operation, and the exact
parity that must hold before a client stops opening the plan store. The API
surface itself is documented in [api-v2.md](api-v2.md).

## The three states

| State | Meaning |
| --- | --- |
| `bridged` | The adapter calls `/api/v2` over HTTP; it holds no `PlanStore`. |
| `flow-backed` | The adapter calls the same `plan-core` flow the v2 route runs, in-process, still with a local store. Behaviour is shared; transport is not. |
| `adapter-only` | Host/process operation with no plan-data route (see api-v2.md "Deliberately not on /api/v2"). |

Removing direct store access from an adapter is only allowed once every
application operation it exposes is `bridged`. `flow-backed` is the current
intermediate state: one implementation, two transports.

## MCP inventory (69 tools)

### Bridged

Ideas Inbox — the first family converted, because it needs no session:

- `planner-idea-list` → `GET /api/v2/ideas`
- `planner-idea-show` → `GET /api/v2/ideas/{ideaRef}`
- `planner-idea-create` → `POST /api/v2/ideas`
- `planner-idea-update` → `PUT /api/v2/ideas/{ideaRef}`
- `planner-idea-delete` → `DELETE /api/v2/ideas/{ideaRef}?confirmed=true`
- `planner-idea-promotion-begin` → `POST /api/v2/ideas/{ideaRef}/promotion/begin`
- `planner-idea-promotion-finalize` → `POST /api/v2/ideas/{ideaRef}/promotion/finalize`

Requirements — CRUD and scoped or unscoped reads:

- `planner-requirement-create` → `POST /api/v2/requirements`
- `planner-requirement-update` → `PUT /api/v2/requirements/{requirementId}`
- `planner-requirement-delete` → `DELETE /api/v2/requirements/{requirementId}`
- `planner-requirement-list` → `GET /api/v2/requirements` for the unscoped
  inventory, or `GET /api/v2/context/requirements?phaseRef=` for a scoped
  read under the service-issued session. MCP mirrors the returned attestations
  for its in-process lifecycle gate during the bridge transition.

Project settings and guidelines:

- `planner-project-guidelines-show` → `GET /api/v2/context/guidelines` under the service-issued session.

- `planner-project-discuss` → `PUT /api/v2/project/discuss`
- `planner-project-guidelines-update` → `PUT /api/v2/project/guidelines`
- `planner-project-language` → `PUT /api/v2/project/language`

Accepted decisions:

- `planner-accepted-decision-create` → `POST /api/v2/accepted-decisions`
- `planner-accepted-decision-update` → `PUT /api/v2/accepted-decisions/{decisionId}`
  (the no-mutable-fields check stays a pure input guard before the request)
- `planner-accepted-decision-delete` → `DELETE /api/v2/accepted-decisions/{decisionId}?targetType=&targetRef=&confirmed=true`

Features and phases (except the session-attested full reads):

- `planner-feature-list` → `GET /api/v2/features?featureRef=`
- `planner-feature-add` → `POST /api/v2/features` (renders the flow's own
  creation message, which the envelope carries)
- `planner-feature-update` → `PUT /api/v2/features/{featureRef}`
- `planner-feature-discuss` → `PUT /api/v2/features/{featureRef}/discuss`
- `planner-feature-delete` → `DELETE /api/v2/features/{featureRef}?cascade=true`
- `planner-phase-list` → `GET /api/v2/phases?featureRef=&status=`
- `planner-phase-add` → `POST /api/v2/phases`
- `planner-phase-update` → `PUT /api/v2/phases/{phaseRef}`
- `planner-phase-discuss` → `PUT /api/v2/phases/{phaseRef}/discuss`
- `planner-phase-delete` → `DELETE /api/v2/phases/{phaseRef}`

Two details keep persisted data and texts identical:

- **Provenance stays the caller's fact.** The discuss flows record a
  `contextReadyReason`. v2 accepts an optional `contextReadyReason` and the
  bridge sends the same string the in-process tool wrote
  (`Updated through planner-<entity>-discuss MCP tool.`), so a stored feature or
  phase is byte-identical whichever surface wrote it. Without one, v2 records
  its own wording.
- **Creation messages come from the flow.** `POST /features` and `POST /phases`
  return the flow's `message`, so the adapter prints it instead of rebuilding
  the sentence.

Tasks (except the session-dependent read/update/recommend):

- `planner-task-list` → `GET /api/v2/tasks?featureRef=&phaseRef=&status=`
- `planner-task-add` → `POST /api/v2/phases/{phaseRef}/tasks` (renders the
  flow's creation message)
- `planner-task-discuss` → `PUT /api/v2/tasks/{taskRef}/discuss`
- `planner-task-dependency-add` → `POST /api/v2/tasks/{taskRef}/dependencies`
- `planner-task-dependency-delete` → `DELETE /api/v2/tasks/{taskRef}/dependencies?dependsOn=&confirmed=true`
- `planner-task-move` → `POST /api/v2/tasks/move` (prints the flow's move
  summary, which the envelope carries alongside the structured moves)
- `planner-task-checklist-add` → `POST /api/v2/tasks/{taskRef}/checklist`
- `planner-task-checklist-toggle` → `POST /api/v2/tasks/{taskRef}/checklist/toggle`
- `planner-task-checklist-remove` → `DELETE /api/v2/tasks/{taskRef}/checklist?item=`
- `planner-task-delete` → `DELETE /api/v2/tasks/{taskRef}?confirmed=true`

The checklist mutations and task creation return the flow's `message`, and the
dependency replies return the persisted `task`, so the adapter prints and
renders without a second read.

Handoffs:

- `planner-handoff-list` → `GET /api/v2/handoffs?page=&pageSize=`
- `planner-handoff-prepare` → `GET /api/v2/phases/{phaseRef}/handoff/prepare`
  (an already-known `supportingDocuments` manifest travels as a JSON query
  value; the no-phaseRef guidance text stays adapter-local)
- `planner-handoff-show` → `GET /api/v2/phases/{phaseRef}/handoff`
- `planner-handoff-write` → `POST /api/v2/phases/{phaseRef}/handoff`
- `planner-handoff-verify` → `POST /api/v2/phases/{phaseRef}/handoff/verify`
- `planner-handoff-clear` → `DELETE /api/v2/phases/{phaseRef}/handoff`

Prepare and show print the flow's `message`. The adapter rebuilds the typed
handoff error from `details.failureKind` (`refusal` / `contract` / `validation`)
plus the code and the remaining details, so `handoffRefusalResult` and
`handoffContractFailureReply` stay the single renderers for both transports.
The write's `nextActions` are adapter action labels, not flow output, so they
stay in the adapter.

Feature, phase and task detail reads use the v2 entity routes for compact
output and the registered context routes for full output. Task reads use
`?scope=task` so the task receipt leaves parent and requirement reads
outstanding. MCP preserves its readiness advisory and mirrors delivered
entity receipts while its lifecycle tools still run in-process.

The target is resolved by the service, not the adapter: a 404
`ACCEPTED_DECISION_TARGET_NOT_FOUND` carries the resolver's message, and the
409 `ACCEPTED_DECISION_DELETE_NOT_CONFIRMED` carries `targetType`, the resolved
`targetRef`, `decisionId` and `confirmRequired`, so the adapter's confirmation
reply is byte-identical to the in-process one. Other refusals carry the
store's errorCode plus `details`, which the adapter rebuilds into the pinned
`acceptedDecisionMutationFailureReply` rendering.

The adapter resolves the service (`reuse the live server record, else start an
embedded one`), never opens the store, and maps `PlannerApiError.code` to its
own texts and structured payloads. The MCP suite stays at 115/115; the only
assertions changed were the two that asserted the old per-process web server
status, now that application calls run through the shared service.

`planner-task-update` uses `PUT /api/v2/tasks/{ref}` under the registered
session. The service updates metadata and refreshes that session's resume
state inside one write batch. `planner-task-recommend` uses
`GET /api/v2/recommend?view=summary` with the same session so the existing
bounded text and structured reply retain caller-specific focus and returns.

Task start, completion, pause, switch, reopen, deviation and session recovery
use their registered v2 operations. The service refreshes focus in the same
write batch. MCP renews its service-issued session every 30 seconds while the transport
is open. It also writes a legacy process-liveness marker when claiming work.
Task ownership is still governed by the legacy rules until shared execution
leases and workspace registration replace them.

Planner load, overview, export and all entity lists also use v2. Pi's
discovery lists and report export and CLI report export use the same
root-scoped service. The Pi Ideas Inbox tools and `/planner idea` command use
the v2 routes for reads, edits, deletion and promotion. The Web UI uses
the same routes for idea list, create, update and confirmed delete. Requirement
CRUD also uses v2 and keeps the original optimistic update check.
In registered descriptor workspaces, CLI `serve` resolves the project and
workspace against the user-scoped SQLite service. MCP and Pi use the same
authority for explicit load, discovery, task context and lifecycle. The
browser at `/board/{projectId}/{workspaceId}` reads the registered project and
subscribes to its event stream. MCP, Pi and the browser create and edit
features, phases and tasks through the registered entity commands. The
registered service also handles discussion, Project Guidelines, requirements,
accepted decisions, checklist mutations, dependency edits, task moves, description freshness,
and session-scoped recommendations and approved deviations. The browser can read and save a scoped
document using its loaded revision and release an idle or abandoned execution
claim. Ideas CRUD and promotion, handoff preparation/write/verification/archive,
and MCP/CLI/board exports also use the registered service. MCP, Pi tools, Pi native
commands and the browser use registered entity deletion. Feature deletion
unlinks phases unless cascade is selected. The service refuses deletion when
it would lose a dependency, execution checkpoint, deviation or handoff.
The registered Work Tree reorders siblings through the scoped entity command.
Native Pi entity and checklist commands, Ideas Inbox, language and Project Guidelines settings, and handoff reads and archival use the same operations as their tools. The native handoff archive command asks for confirmation.
Several legacy maintenance and host entry points still need migration.

### Adapter-only

`planner-init`, `planner-repair`, `planner-cleanup-orphan-phases`,
`planner-project-context-migrate`,
`planner-authorize-bypass`, `planner-clear-bypass`,
`planner-version`, `planner-web`, and `planner-disable`. Legacy maintenance
and guard paths retain their existing adapter/store access.

## Approval parity

An approval is a product decision the host obtains from the user; the API also
enforces the destructive subset mechanically. A bridge may translate an
already-obtained approval into the API flag, but must never invent one.

| Tool | Tool input | API requirement | Bridge duty |
| --- | --- | --- | --- |
| `planner-idea-delete` | `confirmed` | `?confirmed=true` | pass through; map 409 to confirmation text |
| `planner-task-dependency-delete` | `confirmed` | `?confirmed=true` | pass through |
| `planner-accepted-decision-delete` | `confirmed` | `?confirmed=true` | pass through |
| `planner-task-delete` | none | `?confirmed=true` | send `confirmed=true` only after the host's approval turn; a 409 means approval was missing |
| `planner-feature-delete` | optional `cascade` | `?cascade=true` | pass through; no confirmation gate on either side |
| `planner-phase-delete`, `planner-requirement-delete`, `planner-handoff-clear` | none | none | conversational approval only; no flag to translate |
| `planner-handoff-write` | `confirmed`, `expectedHandoffUpdatedAt`, reconciliation fields | same body fields | pass through unchanged |
| `planner-session-recover` | `confirmed` | body `confirmed` | pass through |
| `planner-task-switch` | resume context (snake_case) | same fields (camelCase accepted too) | map names; never synthesize resume text |
| `planner-task-start` | task only | session + context receipts | register the session; relay `nextActions` on denial |

## Service failures versus refusals

The shared client separates the two by status, so no adapter re-derives the
distinction:

- **4xx → `PlannerApiError`** — a domain refusal the adapter maps to its own
  text and `errorCode`.
- **5xx → `PlannerServiceFailure`** — the service could not complete the call
  (failed persistence/verification, or a transient `PLAN_WRITER_BUSY` writer
  lock). It is not a `PlannerApiError`, so every existing adapter catch that
  rethrows unknown errors keeps propagating it as a tool error, exactly as a
  thrown store error did before the call moved to HTTP.

A related consequence of routing application writes through the service: any
application call starts (or reuses) the service for the plan root, so
`planner-web status` can report it running before `planner-web start` was
called. That is the intended single-authority behaviour, not a leak.

## Refusal parity

- The `code` is defined once in `plan-core` and returned by v2 in
  `error.code`. Adapters map codes and render their own sentences; no adapter
  re-derives a domain decision from a message string.
- MCP keeps its pinned texts and structured payloads (flags such as
  `created`, `deleted`, `updated`, `promoted`, `started`, `persisted`, and
  `errorCode` on failures). Those are client contract, not API contract.
- A missing entity is `404` on v2; MCP renders `not found` text. A refused
  state is `409`; invalid input is `422`; a missing JSON body is
  `400 INVALID_BODY`; a failed persistence verification is `500`.

## Removal conditions (per adapter)

Before an adapter stops opening the plan store:

1. every application tool it exposes is listed as `bridged`;
2. the adapter registers a service session and reuses a live service instead of
   starting a private store;
3. its tool texts, structured payloads and refusal codes still pass the
   existing suite unchanged (or with reviewed edits);
4. adapter-only operations keep working without a store, or are explicitly
   documented as requiring one.

Pi, CLI and Web UI follow the same inventory. The Web UI currently uses the
unprefixed routes in `serve.ts`; those are not v2 and converting them is part
of this checklist item, not a v1 change.
