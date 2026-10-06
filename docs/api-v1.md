# Agent Plan API v1

A read-only HTTP API and a live event for programs that follow a planner from outside
(dashboards, other agent tools). It is separate from the web UI's own routes, which change
whenever the UI does. This one is promised not to.

Writing to the planner is not part of this API. Agents write with the MCP tools; people edit in
the web UI.

## The promise

The current version is `1`. It is in every reply as `apiVersion`.

- **Adding** a field, a route, a query parameter or an event kind does **not** change the version.
  Ignore fields you do not know.
- **Removing or renaming** a field, changing its type, or changing what it means needs a new
  version. The old version keeps working beside the new one (`/api/v1` stays when `/api/v2`
  arrives).
- A test (`packages/plan-server/test/api-v1-contract.test.mjs`) pins the shape of every reply
  below and fails the build if one changes.

The types live in `@agent-plan/core` (`packages/plan-core/src/api-v1.ts`): `ApiV1Task`,
`ApiV1Phase`, and so on.

## Start a server

```bash
agent-plan serve --root /path/to/project/.planner --port 0 --json
# {"url":"http://127.0.0.1:53211","localUrl":"...","lanUrl":null,"host":"127.0.0.1","port":53211,"root":"..."}
```

Base URL: `<url>/api/v1`. `GET <url>/health` answers
`{ "status": "ok", "root": "...", "apiVersion": "1", "pid": 123, "version": "0.4.1" }`, so a client can check it is
talking to the right server (same `root`, expected `apiVersion`).

### Find a server that is already running

Every server writes `<planner folder>/.local/server.json` while it runs:

```json
{ "kind": "standalone", "pid": 123, "url": "http://127.0.0.1:53211", "localUrl": "...", "lanUrl": null,
  "host": "127.0.0.1", "port": 53211, "root": "/path/.planner", "startedAt": "...", "version": "0.4.1", "apiVersion": "1" }
```

The record is live only if `pid` exists and `GET <localUrl>/health` answers with the same `root`; otherwise ignore it.
Rather than reading it yourself, run `agent-plan serve --reuse --json` (prints the running server's address, or starts
one) and `agent-plan stop` (stops a `standalone` server; never an `embedded` one).

## Replies

Success: `{ "apiVersion": "1", "data": <view or list of views> }`

Error: `{ "apiVersion": "1", "error": { "code": "NOT_FOUND", "message": "Task not found: T9999" } }`

| Status | `error.code` | When |
|---|---|---|
| 404 | `NOT_FOUND` | unknown reference, unknown route, or a filter that names something that does not exist |
| 405 | `METHOD_NOT_ALLOWED` | anything but GET (reply has `Allow: GET`). Nothing is changed. |
| 503 | `PLAN_BUSY` | an agent is writing the planner files. Retry shortly. |
| 500 | `INTERNAL` | unexpected failure |

Lists return every item (no paging). Add `?compact=true` to drop the long text fields
(`description`, `content`, `guidelines`, `decision`, `rationale`, `implementationNotes`) and keep
identity, status and references.

## References

Every entity has a `ref` (for example `F001`, `P002(F001)`, `P002(F001)/T005`, `I004`). A single
entity is fetched by any of:

- its `ref` (URL-encoded or not: `/tasks/P002(F001)/T005` works),
- its `ref` without the feature (`P002`, `P002/T005`),
- for a task, the bare number `T005` (task numbers are unique in a project),
- its `shortId` (5 characters),
- its `id` (UUID).

Titles are never matched: a stable API does not guess.

Links between entities (`featureRef`, `phaseRef`, `taskRefs`, `dependsOn`) are refs. A dependency
that no longer resolves is kept as the id it was stored with.

## Routes

| Route | Returns | Query |
|---|---|---|
| `GET /api/v1` | `{ apiVersion, links }` | |
| `GET /api/v1/project` | project | |
| `GET /api/v1/features` | features | `status`, `compact` |
| `GET /api/v1/features/{ref}` | one feature | |
| `GET /api/v1/phases` | phases | `feature` (ref), `status`, `compact` |
| `GET /api/v1/phases/{ref}` | one phase | |
| `GET /api/v1/tasks` | tasks | `phase` (ref), `status`, `compact` |
| `GET /api/v1/tasks/{ref}` | one task | |
| `GET /api/v1/decisions` | accepted decisions of every owner | `owner` (`project` or a ref), `compact` |
| `GET /api/v1/handoffs` | active handoffs | `compact` |
| `GET /api/v1/handoffs/{phaseRef}` | the active handoff of a phase | |
| `GET /api/v1/ideas` | ideas | `compact` |
| `GET /api/v1/ideas/{ref}` | one idea | |

## Views

Timestamps are ISO 8601 strings; an unset timestamp is `""`.

**project** — `name`, `description`, `goal`, `guidelines` (the Project Guidelines text),
`guidelinesUpdatedAt`, `scope[]`, `outOfScope[]`, `technologies[]`, `tools[]`, `contentLanguage`,
`chatLanguage`.

**feature** — `id`, `ref`, `shortId`, `number`, `name`, `description`, `status`, `priority`,
`startDate`, `endDate`, `workDone`, `workRemaining`, `phaseRefs[]`, `dependsOn[]` (feature refs),
`createdAt`, `updatedAt`.

**phase** — `id`, `ref`, `shortId`, `number`, `featureRef` (or `null`), `title`, `summary`,
`description`, `status`, `priority`, `goals[]`, `dependsOn[]` (phase refs), `taskRefs[]`,
`hasHandoff`, `createdAt`, `updatedAt`.

**task** — `id`, `ref`, `shortId`, `number`, `phaseRef`, `featureRef` (or `null`), `title`,
`description`, `status`, `priority`, `checklist[]` (`{ id, number, title, checked }`),
`dependsOn[]` (task refs), `pause` (`{ reason, resumeLocation, pausedAt }` or `null`),
`startedAt`, `completedAt`, `createdAt`, `updatedAt`.

**decision** — `id`, `ref` (`<owner ref or "project">#<id>`, unique), `title`, `decision`,
`rationale`, `implementationNotes`, `acceptedAt`, `owner` (`{ kind: "project"|"feature"|"phase"|"task", ref }`;
`ref` is `null` for the project).

**handoff** — `phaseRef`, `content`, `updatedAt`, `resumeReady`, `resumeReadyAt`. Only phases
that are not finished (`done`, `canceled`, `rejected`) have an active handoff.

**idea** — `id`, `ref`, `shortId`, `number`, `title`, `description`, `promotion`
(`{ targetType, targetRef, promotedAt }` or `null`), `createdAt`, `updatedAt`.

`status` values: `planned`, `in-progress`, `done`, `blocked`, `canceled`, `rejected`, `deferred`,
`waiting`; phases also `draft` and `discovery`. A feature's and a phase's status is derived from
its children.

## Live changes: `entity-changed`

Connect a WebSocket to `<url>/ws`. When anything in the planner changes, including a write made by
another process (an agent's MCP server), the server sends one message per changed entity:

```json
{ "type": "entity-changed",
  "data": { "apiVersion": "1", "kind": "task", "ref": "P002(F001)/T005", "id": "…",
            "op": "updated", "parents": { "featureRef": "F001", "phaseRef": "P002(F001)" } } }
```

- `kind`: `project`, `feature`, `phase`, `task`, `decision`, `handoff`, `idea`.
- `op`: `created`, `updated`, `deleted`. A deleted entity keeps the `ref` it had.
- The message says what changed, not the new content. Fetch that one entity from the API.
- Changes are found by comparing the views above, so a change to something the views do not
  show (for example a task's internal notes) produces no event.
- One entity is reported once per burst: changes that land within about 100 ms are combined.
- A task change can also report its phase or feature, when their own view changed (status,
  `updatedAt`).
- Events are a hint that keeps your view fresh, not a guarantee: the operating system can drop file notifications under heavy load. Fetch again after you reconnect, and now and then if you need certainty.
- On connect you receive `{ "type": "connected" }`. Send `{ "type": "ping" }` to get `pong`.
- The socket also carries older messages (`file-changed`, `phases-updated`, …) used by the web UI.
  They are not part of this contract; use `entity-changed`.
