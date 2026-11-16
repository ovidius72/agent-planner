# Agent Brain delivery roadmap

This document describes implementation order, not live task status. The Agent Plan planner remains the work register. See [the design package](docs/agent-brain/README.md) and [reconciliation matrix](docs/agent-brain/reconciliation.md).

## 1. Registered plan and remaining contract decisions

- Approve descriptor, service bootstrap/authentication, public Heca transport and recovery conflict contracts.
- The initial F025 registration recorded 16 phases and 41 planned tasks; P132 subsequently added eight project-use improvements. See [the report](docs/agent-brain/replan-registration.md) for the dated registration and the [live execution map](.planner/docs/agent-brain-plan.md) for current scope. Heca-Pro owner amendments were registered on 2026-10-31.
- Keep correctly completed work as history; allocate only coherent missing adaptation outcomes.
- Review effective feature/phase/task priority and real prerequisites. Do not introduce the discussed global task queue.

## 2. Identity, database and application API

- T489 separates project, repository, workspace, caller and execution identities and defines descriptor resolution.
- T502 supplies schema, documents/FTS, transactions, driver isolation and crash boundaries. The foundation is T489 -> T502 -> T496 -> T490.
- T496 supplies bounded mutation-impact reconciliation; preserve its ordering with T489/T490.
- T490 supplies one compatible application service per user, multi-project routing, command API and client parity.
- Retain read API compatibility and explicit errors for unavailable/incompatible authority. Do not create fallback planners in worktrees.

## 3. First usable migration and recovery

- Adapt T494/T495 for legacy imports including documents and custom skills, consistent backups and explicit export/import.
- Stage, preview, validate and activate with recovery after interruption.
- Support descriptor-based restore after HOME loss up to the last complete exported revision.
- T494/T495 now follow the service foundation without waiting for advanced target integration; basic migration/restore belongs in the first usable DB release.
- Keep remote divergence explicit; shared network planning remains deferred.

## 4. Reliable work and context

- T461-T469 cover the six reported failures, one explainable selection contract, complete context restoration, phase continuity/returns and duplicate-task prevention.
- Preserve exact caller identity, atomic claims and independent return chains.
- Convert MCP/Pi/CLI/UI to API-only operation; bootstrap skills must keep all currently supported operations reachable.
- Demonstrate bounded payload/context cost on fixed comparable flows without omitting required information.

## 5. Source memory, graph and editor

- T470-T480 own snapshot-bound code links, changesets, decisions, provider setup, graph/context and supervisor navigation.
- T483 remains the independent project-title correction.
- T484-T488 own source access, safe concurrent saves, shared compatible LSP, Monaco and external editor opening.
- T491-T493 own attributable executions, target integration and revision-aware availability.
- Implement the redesigned Web UI from reviewed prototypes; core/application APIs retain business policy, and React retains presentation/drafts.
- Dynamic provider coverage and text-only fallback remain supported; no fixed language whitelist.

## 6. Heca-Pro connection and collaboration

- Reconcile Heca-Pro T032/T039/T040 for descriptor/global-service following and worker startup contracts.
- Preserve its existing YAML, helper, authorization and orchestration owners.
- Heca-Pro T043-T046 supply public collaboration conformance; Agent Plan T497-T500 consume it.
- Reuse generic open-Heca browser/content support for the initial planner overlay. Native planner components remain a later API consumer.
- Implement snapshots/events, attributed chat and authorized actions with real supported-host evidence; standalone Agent Plan remains usable.

## 7. Closeout

P132 covers the eight documented project-use improvements before closeout, building on the existing selector, reconciliation and portable-guidance owners where applicable.

T481 first establishes the standalone milestone; T482 follows it and the optional collaboration UI for freshly packed installed-artifact/native closeout. Verify crash/retry/reconnect, old clients, source conflicts, dynamic providers, long IDs and the dev-a/dev-b partial-integration scenario. Native UI and mesh acceptance require their actual runtimes.

Run focused checks while implementing. Use the canonical final gate at closeout, preserving measured evidence and explicit remaining blockers. A documentation review is not a release or permission to migrate a real user project.

The initial scaffold roadmap is retained as [historical context](docs/history/roadmap-foundation.md). Release and branch governance remain in `AGENTS.md` and README; this roadmap does not change them.
