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

The adapter resolves the service (`reuse the live server record, else start an
embedded one`), never opens the store, and maps `PlannerApiError.code` to its
own texts and structured payloads. MCP suite unchanged at 115/115.

### Flow-backed (v2 route exists; bridge pending)

| Family | Tools | v2 route |
| --- | --- | --- |
| Features | `planner-feature-list/show/add/update/discuss/delete` | `/features` family |
| Phases | `planner-phase-list/show/add/update/discuss/delete` | `/phases` family |
| Tasks | `planner-task-list/show/add/update/discuss/move/delete`, `planner-task-checklist-add/toggle/remove`, `planner-task-dependency-add/delete` | `/tasks` family |
| Requirements | `planner-requirement-list/create/update/delete` | `/requirements` family |
| Accepted decisions | `planner-accepted-decision-create/update/delete` | `/accepted-decisions` family |
| Project settings | `planner-project-discuss`, `planner-project-guidelines-update`, `planner-project-language` | `/project/*` |
| Context reads | `planner-project-guidelines-show` | `GET /context/guidelines` (session) |
| Handoffs | `planner-handoff-list/prepare/show/write/verify/clear` | `/phases/{ref}/handoff` family |
| Lifecycle | `planner-task-start/complete/pause/reopen/switch/deviation` | `/tasks/{ref}/*`, `/deviations` (session) |
| Recovery | `planner-session-recover` | `POST /sessions/recover` (session) |
| Discovery | `planner-task-recommend` | `GET /recommend` |

Session-dependent families need the adapter's service-issued session. MCP
already derives a per-transport planner session id; the bridge registers it
once (`registerSession`) and sends `x-planner-session` on those calls.

### Adapter-only

`planner-init`, `planner-repair`, `planner-cleanup-orphan-phases`,
`planner-description-freshness`, `planner-project-context-migrate`,
`planner-export`, `planner-authorize-bypass`, `planner-clear-bypass`,
`planner-version`, `planner-web`, `planner-disable`, `planner-load`,
`planner-show`. Rationale per entry is in api-v2.md; none is a plan-data
operation, so none blocks removing direct store access.

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
