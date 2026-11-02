# F025 next-agent handoff

> Resume amendment, 2026-11-01: [accepted integration decisions](../../docs/agent-brain/decisions-2026-11-01.md) and [session registration](../../docs/agent-brain/session-registration.md) are the current contract. Heca initiates the duplex link; ordinary terminal agents stay standalone. Both UIs read/write shared room messages; Heca owns SQLite chat history, YAML policy delivery and retention. Do not start product implementation from this registration handoff alone.

Finalized on 2026-10-30. Planner registration is complete; product implementation has not started.

## State and authority

Repository: `/Users/antonio/projects/agent-plan`; branch: `feat/agent-brain`. Verify the live checkout and preserve existing dirty work. Do not create another feature or replay an old import. F025, all 16 phases and the 40 existing task identities/history are retained. The only added task is P128(F025)/T502, short ID MR7WJ, for SQLite/documents/search.

The current scope is 41 planned tasks, 33 linked requirements, 21 feature decisions, 68 acyclic task edges and 230 unchecked checklist items. F025 global priority remains 24. Read [the current map](agent-brain-plan.md) and the applicable canonical task/parents/requirements/decisions; this handoff is not operational authority.

## What changed

- Replace the old git-common-dir/JSON target with a portable descriptor and one multi-project local application service owning HOME SQLite.
- Keep all operational database access inside the server. Pi uses its adapter, other harnesses MCP; CLI/UI/Heca consume the same authorized API.
- Relational identity/state/dependencies/revisions plus flexible metadata, versioned logical documents/assets and FTS5. No live file mirror for rg; provide service search/document operations.
- Domain policy stays in TypeScript core/service. Mechanical FTS triggers do not become a stored-procedure policy engine. Driver work must preserve networking responsiveness and transaction boundaries.
- Deliver migration, consistent backup, explicit JSON/asset export/import and descriptor-based HOME restore before advanced integration work. Do not promise recovery of unexported state or code rollback from a planner DB.
- Keep phase continuity and durable approved returns; retain ready feature -> phase -> task priority. No global task queue, free agent pool or automatic interruption.
- Context receipts establish actual delivered revisions, not understanding or retention after compaction. Restore current context and inspect existing source conventions before writing.
- Separate work execution/verification from target integration/current availability. A feat/two completion is not delivered to main by merging feat/one.
- Preserve dynamic providers, revision-aware anchors, large changesets, relevant retrieval, graph evidence, safe source saves, compatible shared LSP and Monaco.
- The Web UI visual design comes from reviewed canvases. Business rules stay in APIs/core; presentation and local drafts stay in React. See [prototype evidence](../../docs/agent-brain/ui-prototypes.md).
- Heca-Pro is optional and owns orchestration/rooms/chat through its public facade. Agent Plan does not connect directly to agent-comms or models. Its native browser/layout/widget work has external owners.

## Dependency and delivery sequence

P116 -> P128 -> P130 -> P117/P118/P119, followed by execution/source/provider/graph/source-workspace/supervisor/editor outcomes and optional collaboration. The exact DAG is in canonical task dependencies; use [the map](agent-brain-plan.md) for navigation.

P128 specifically: T489 -> T502 -> T496 -> T490. Basic migration T494/T495 no longer waits for advanced target availability. T483 title correction is independent. T481 proves the standalone milestone; T482 follows it and the optional Heca UI outcome for installed/native closeout.

## Evidence and remaining work

The registration read-back verifies identity/history preservation, contracts, requirements, priorities and task/phase DAGs. All 17 F025 parent descriptions were reconciled leaf-to-root. [The registration report](../../docs/agent-brain/replan-registration.md) records limits and the unrelated historical requirement reference warning.

Descriptor schema, service bootstrap/authentication, SQLite driver/version matrix, divergent snapshot import policy and public Heca host/transport details still require explicit decisions in their owners. Heca-Pro task amendments were registered on 2026-10-31; current-service conformance T047 and native implementation remain open.

Start by reading P116(F025)/T461 and applicable project context when implementation is explicitly authorized. Use isolated fixtures and bounded checks. No task-start, product changes, real migration, service launch, dependency installation, commit, push, PR or release was performed by this replan. AGENTS.md and project Guidelines were preserved.

The [previous handoff](history/2026-10-29-before-replan-agent-brain-registration-handoff.md) is historical only.
