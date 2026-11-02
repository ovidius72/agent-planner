# Web UI prototype provenance and implementation boundary

> Gap found on 2026-11-02: the prototypes contain no Heca room, member or chat screens, and Settings still describes `.planner` in the repository. Before T500 the design intake must cover project -> rooms -> group chat, `@` autocomplete with model and F/P/T, member live labels, undelivered/uncertain receipts, the unavailable state and the Release action (see [decisions](decisions.md)).

Reviewed access: 2026-10-30. These are user-supplied design references. The user explicitly stated that the interface will be redesigned from the canvases and business logic will be concentrated in APIs/internal modules.

## References and observed evidence

| Reference | Verified access/content | Limit |
| --- | --- | --- |
| [Agent Plan — Dashboard artifact](https://claude.ai/artifact/LkFamcAA6Fkbo6pjkQipih#play-15dd8cd198dd) | Opened in the authenticated browser. Rendered dashboard inspected visually and through its accessibility tree: active/parked work, next action, project goal/details, feature navigator, nested phase/task tree, structured search, expand/collapse/reset and light theme. Navigation contains Resume, Planner, Requirements, Ideas, Handoff, Agents & targets, Map, Code, Checks, Analytics, To evaluate and Settings. | Only the rendered dashboard and navigation were inspected. The full set of canvas artboards and all linked destinations were not traversed. Labels explicitly call the data illustrative. |
| [Claude Code design session](https://claude.ai/code/cshk_01EzQnyTdf7DatKzt2AhHhrSKZYXvF9EP2C5EtgNPUn2Xg) | Opened and read the visible session history. It discusses edits to Main.dc.html, a published v96 prototype, structured search/filter layout, mobile hide/reopen behavior and subsequent requested corrections. | This is a session history, not a verified complete source export or frozen approved design. Later corrections appear after the publication note; do not assume the artifact includes every requested change. A claimed sync to another branch was not verified locally. |

The plain web reader could not access these URLs; authenticated browser access succeeded after explicit user authorization. No prompts, publishing, sharing changes or source modifications were sent to Claude. A browser interaction failure prevented opening the canvas overview; it does not establish missing artboards.

## Required design intake

Before implementing an affected screen, identify the reviewed artboard/version, capture or export the required source/design states, and resolve any discrepancy between published artifact and later corrections. Record that revision with the implementation acceptance evidence. Do not silently treat a mutable URL, old screenshot, mock success badge or assistant statement in the design session as a final product requirement.

Use the prototypes as the visual/layout starting point. The current production UI is architectural/source precedent, not a requirement to preserve its appearance. Retain suitable React/TypeScript/router/accessibility building blocks. The task contracts remain the behavior authority; proposed visuals cannot create unsupported runtime actions.

## API and presentation boundary

| Core/application service | Web UI |
| --- | --- |
| Priority/eligibility, hierarchy/dependencies, canonical rules/decisions, permissions, current evidence interpretation, ownership and lifecycle transitions. | Navigation, layout, theme, expand/collapse, focus, responsive presentation and unsaved drafts. |
| Validated query/search/document/context results, revisions, capability availability and structured command/error receipts. | Render supplied results, expose actual supported actions, retain input, handle loading/stale/denied/conflict states and submit commands. |
| Planner events and the authorized Heca collaboration facade. | Refresh projections from events; show source, freshness and destination without inventing another policy or room store. |

Structured search syntax/meaning and access filtering need a documented API contract. The frontend can render tokens and validation hints; it must not implement a divergent domain filter engine. Purely visual filtering/expansion is local state where it does not change domain results.

The same business behavior must be reachable through MCP, Pi, CLI, Web UI and approved Heca consumers. Backend responses must be meaningful without a browser.

## Existing owners

- P118/T465-T466: resume results and complete bounded context.
- P123/T479-T480: graph navigation and supervisor controls, including standalone Checks.
- P125/T483: project identity in browser titles, including all detail pages.
- P126/T484-T485 and P127/T486-T488: source APIs, shared analysis, Monaco and external opening.
- P131/T497-T500: optional Heca capability binding, events, chat/actions and collaboration UI.

The prototype-driven visual redesign has not been exhaustively inventoried across all artboards. Existing task contracts include the agreed design/API boundary; a full new screen/theme/navigation migration should be scoped against the complete reviewed canvas before claiming F025 covers every visual detail. No duplicate editor/API task is introduced by this document.
