# Agent Plan Platform and Agent Brain evolution

## Product

Agent Plan is a harness-independent project planning and memory platform. It maintains project context, requirements, single-owner Accepted Decisions, features, phases, tasks, checklists and phase handoffs. Pi uses its adapter; other supported harnesses use MCP. A Web UI gives the human supervisor visibility and editing tools.

Agent Brain is the planned evolution in F025, in this repository. It first makes existing workflows reliable, then adds source-aware memory, code/rationale relationships, relevant context retrieval and verification evidence. Heca-Pro remains an optional collaboration runtime.

## Current implementation and accepted target

| Area | Current inspected implementation | Accepted target direction |
| --- | --- | --- |
| Persistence | JSON under `.planner/`; clients can construct PlanStore directly. | SQLite under the user's HOME; one application service owns all operational access. |
| Project discovery | cwd/.planner and AGENT_PLAN_ROOT. | Versioned project descriptor plus registered repository/workspace identity. |
| Clients | Pi adapter, stdio MCP, CLI and Web UI with existing domain behavior. | Preserve operation parity through the application API; no client database access. |
| Public API | Versioned read-only v1 and entity-changed events. | Compatible read surface plus complete versioned command/document/search APIs. |
| Realtime | Hono/Node service and WebSocket. | Project-scoped snapshots/events, bounded replay and explicit reconnect gaps. |
| Documents and skills | Planner documents and managed/custom skills in `.planner`. | Planner documents in DB logical folders; installed bootstrap and API-delivered project guidance. |
| Source intelligence | F025 contracts describe the extension. | Revision-aware code links, changesets, decisions, dynamic providers and derived graph. |
| Editor | F025 source/Monaco work is planned. | Revision-safe source access and one compatible analysis runtime shared by agents/editor. |
| Heca | Separate Heca-Pro product and integration plans. | Shared planner API, optional public collaboration API and initial planner WebView in Heca. |

The target is not a claim that the installed product has migrated. Existing commands and setup instructions in README describe the current product until their implementation changes.

## Functional requirements

- Initialize or load an existing project, including empty/non-Git folders and undecided languages.
- Preserve entity UUIDs/short IDs, variable-width numeric references, hierarchy, history and derived parent status.
- Maintain requirements separately from implementation guidelines and agent operating rules.
- Support discussion, lifecycle, pauses, nested returns, explicit recovery and explainable ready-work selection.
- Deliver required context completely, reuse only valid available context, and restore after supported context-loss events.
- Require source precedent analysis and record actual conformity review; reading alone is not proof of compliance.
- Reconcile affected parents and real dependency consumers with bounded deltas and explicit pending obligations.
- Link tasks and decisions to historical/current code evidence without treating file:line as permanent identity.
- Preserve source workspace, task execution, verified revision and target integration as separate concepts.
- Provide full standalone planning, source/editor and verification-evidence capabilities without Heca.
- Migrate legacy planner entities/documents/custom guidance without loss; provide independent backup and explicit portable export/import.

## Architecture and ownership

Frontend: React + TypeScript, Vite. Local application service: Hono on Node.js. Validation: Zod. Realtime: WebSocket. Package manager: pnpm workspace monorepo. SQLite is the selected target persistence engine; the driver/build matrix remains an implementation choice. There is no separate database server.

- `plan-core`: harness-independent models, domain policies and validated operations.
- `plan-server`: service lifecycle, complete API, authentication, events and exclusive database ownership.
- `plan-mcp`: MCP tool bridge to the service.
- `pi-adapter`: Pi-native integration using the same application operations.
- `agent-plan`: CLI/bootstrap and human commands.
- `plan-web-ui`: supervisor UI and optional Heca collaboration consumer.

Exact internal storage modules and proposed endpoint names are specified as recommendations, not pre-approved package creation. Reuse existing ownership and precedents during implementation.

## Planning and scheduling

Canonical planner entities remain the operational work register. The documentation package records architecture and completed F025 registration, with Heca-Pro amendments registered on 2026-10-31; it is not a parallel task board.

Keep the existing priority model for this amendment: owned work and valid pending returns, then ready feature -> phase -> task. Preserve phase continuity and deliberate recoverable interruptions. The discussed global task queue/free pooling model is not adopted.

Higher task priority inside a lower-priority feature does not create global precedence. Use the correct feature owner and real prerequisites; review parent priority and cycles. Preserve completed historical contracts when adding adaptations.

## Recovery and boundaries

The project descriptor identifies the planner and optional export source. Credentials and absolute database paths stay local. Export/import can publish versioned logical data through a private Git transport without touching the code checkout. It does not provide team-wide atomic ownership across independent computers. Network-authoritative planning is deferred.

A separate autonomous AgentTest product, automatic Git publishing on ordinary mutations, model-specific domain logic, mandatory graph/embedding services and a fixed supported-language list are outside this approved scope.

The redesigned Web UI follows reviewed prototype canvases. Business rules stay in core/application APIs and remain consistent across MCP, Pi, CLI, Web UI and Heca clients; the UI owns presentation, navigation and local drafts. See [prototype provenance](docs/agent-brain/ui-prototypes.md).

## Detailed specifications

Start with [the design package](docs/agent-brain/README.md), then [architecture](docs/agent-brain/architecture.md), [communication](docs/agent-brain/heca-protocol.md) and [reconciliation](docs/agent-brain/reconciliation.md). Heca-Pro owns its [workflow and integration specification](../heca-pro/docs/agent-brain-integration.md) in the sibling repository.

The initial foundation proposal is retained as [historical context](docs/history/project-foundation.md). It is not the target persistence or identity contract. `AGENTS.md` remains the current governance file and is changed only by a separate explicit request.
