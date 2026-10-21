# Agent Brain — Monaco workspace, shared analysis and project identity

Current amendment: shared-plan storage is independent of the selected code workspace. K/L must reuse the explicit binding, execution/target provenance and affected-context/bounded-cost contracts in `.planner/docs/agent-brain-shared-planner-and-execution.md` and `.planner/docs/agent-brain-impact-reconciliation-and-token-budgets.md`. The current total is 15 phases/36 tasks/29 requirements/19 decisions; earlier editor-only counts in this document are historical. Monaco/provider/project-title decisions remain in force.

**Registered and verified in F025: P125–P127 / T483–T488.** Canonical planner entities are authoritative. This is the complete implementation handover for the user-approved planning expansion of 21 October 2026. Product implementation, dependency installation, commits and release are not part of this registration.

## Canonical registration references

| Phase | Outcome | Tasks |
|---|---|---|
| P125(F025) | Project identity and browser page titles | P125(F025)/T483 |
| P126(F025) | Code workspace access and shared analysis service | P126(F025)/T484, P126(F025)/T485 |
| P127(F025) | Integrated Monaco workspace and external-editor navigation | P127(F025)/T486, P127(F025)/T487, P127(F025)/T488 |

The full feature now has 12 phases, 28 planned tasks, 21 outcome requirements, 13 single-owner decisions and 33 task dependency edges. All 229 implementation checklist items are unchecked. Title fixes are early independent reliability work; final T481/T482 completion waits for the new workspace outcomes.

## Agreed behavior

- A desktop project file explorer with editable Monaco tabs, syntax coloring, diff, safe save and opening in a preferred external editor is included.
- CodeMirror was evaluated; Monaco is the accepted choice after the user clarified that mobile editing is not a deciding criterion.
- UI and agents share one compatible analysis runtime; an editor client package does not automatically provide this reuse.
- Overview and detail browser titles must always retain the known project identity. Task format: `ProjectName - TaskID [Short task title]`.
- The existing six reliability problems, dynamic language support and variable-width F/P/T requirements remain in scope. Existing graph/provider ownership is extended rather than duplicated.

## Accepted decisions

### AD11: Use Monaco for the desktop source-code workspace

Decision: Use Monaco Editor for the integrated file explorer, editable source tabs, syntax coloring and diff. Source editing/saving is included. Mobile code editing is not a deciding acceptance requirement; preserve existing planner responsiveness and document actual limitations.

Rationale: The user selected an experience like the adjacent file explorer and clarified that mobile source editing is not a meaningful reason to prefer CodeMirror. Monaco is the resulting choice.

Implementation notes: Load Monaco/workers/language assets on demand and ship them locally; retain the lightweight existing Markdown workflow. Choose a compatible tested integration stack and versions without assuming VS Code extension compatibility. Do not install dependencies or implement product code as part of this planning update.

### AD12: Share analysis through one compatible runtime owner

Decision: Agents and the editor use the same analysis service. Reuse one compatible language-server runtime for the same project/worktree, provider/version and effective configuration; the frontend does not start a duplicate process by default.

Rationale: The user asked whether Agent Plan and the embedded editor would run two LSP servers. The agreed architecture explicitly avoids duplication merely because both consumers exist.

Implementation notes: Extend P121 contracts with broker-owned upstream sessions, atomic cross-host-process ownership/reuse, cancellation, consumer lifecycle and named document revisions/overlays. Monaco provider hooks call common APIs; an optional frontend LSP client/gateway must not independently initialize a competing server. Separate keys may require separate runtimes, and provider capabilities remain dynamic.

### AD13: Put project identity first in browser page titles

Decision: The actual project name must identify the overview and prefix entity-detail browser titles. Task detail follows ProjectName - TaskID [Short task title]; feature and phase details follow the same project-first convention.

Rationale: The user cannot distinguish projects when tabs show only Agent Plan or a task title. Both reported title failures must be corrected.

Implementation notes: Use one route-aware title owner, preserve known project context through navigation/live renames/errors, retain full variable-width refs and avoid stale cleanup restoration. The bracketed description means the short entity title, not the full Markdown task description.

## Product requirements

### BR18: Persistent project identity in browser navigation

Initialized project pages remain distinguishable by the project name in browser titles and visible navigation. The overview identifies the project; task detail uses ProjectName - TaskID [Short task title], with the same project-first convention for feature and phase details, including navigation and live renames.

### BR19: Editable source workspace connected to project knowledge

The Web UI provides a project file explorer, Monaco editing, syntax coloring, diff and revision-aware saves. Source selection and resolved links expose applicable planner context while preserving drafts, external edits and current versus historical evidence.

### BR20: One compatible analysis runtime for agents and the Web UI

Supported agent surfaces and the editor share a compatible analysis runtime for the same project/worktree, provider/version and effective configuration, with explicit source versions, capability limits and independent consumer lifecycles. Opening the editor does not by itself duplicate language-server processes.

### BR21: Open resolved source in a preferred external editor

A user can open a resolved project source location in a configured external editor with correct file and supported line/column, machine-local preferences, explicit target-machine semantics and clear handling of unsaved or unavailable files.

## Phases and complete task contracts

### J: Project identity and browser page titles

Keep the project recognizable in browser tabs and detail navigation.

Current state: packages/plan-web-ui/index.html:6 has a static Agent Plan title. RootRoute in packages/plan-web-ui/src/app/root.tsx:25 already derives a project title, while RootErrorBoundary:86 resets it. EntityDetailIdentity in packages/plan-web-ui/src/components/detail/entity-detail-identity.tsx:28 overwrites it with type/reference/title and later restores a captured prior title. The user reports an always-generic overview title and project-less detail titles; runtime reproduction is still required.

Goals:
- Keep the actual project name in overview and detail-page browser titles.
- Remove competing title effects while preserving visible page identity and live navigation.

Responsibilities:
- J1: Preserve project identity in overview and detail page titles. Reliable project-aware browser titles on overview, list and detail routes, without losing project context during navigation or updates.

Boundaries:
- Do not rebuild code analysis or introduce editor dependencies for this fix.

Risks:
- Root and detail effects currently compete; a cleanup can restore an obsolete title.
- The reported installed behavior may differ from current source and must be reproduced.

Acceptance:
- Two initialized projects have distinguishable browser tabs on overview and detail routes.
- A task displays e.g. My Project - T1000 [Refactor parameter handling]; F/P detail follows the same project-first rule.
- Navigation, live renames, loading/errors with known project context and effect cleanup do not drop or restore stale project identity.

Use .planner/docs/agent-brain-editor-and-project-identity.md and exact child task contracts. Existing source references are named above; revalidate before editing.

Preserve canonical planner IDs/decision ownership, phase-scoped handoffs, existing settings, atomic session ownership, warning-only no-task behavior and shared versus worktree-local runtime boundaries. Read existing source precedents and applicable Guidelines before coding. File:line entries above are navigation evidence inspected on 21 October 2026, never durable identity; source hashes are recorded in the supporting document. Verify current code before implementation. Use task checklists rather than creating tasks per step. This registration does not start implementation, install dependencies, commit or publish.

Open implementation choices:

- Choose the smallest central route-title integration that follows current React Router data patterns; exact module names are implementation choices.

#### P125(F025)/T483: Preserve project identity in overview and detail page titles

Outcome: Reliable project-aware browser titles on overview, list and detail routes, without losing project context during navigation or updates.

Existing state: packages/plan-web-ui/index.html:6 has a static Agent Plan title. RootRoute in packages/plan-web-ui/src/app/root.tsx:25 already derives a project title, while RootErrorBoundary:86 resets it. EntityDetailIdentity in packages/plan-web-ui/src/components/detail/entity-detail-identity.tsx:28 overwrites it with type/reference/title and later restores a captured prior title. The user reports an always-generic overview title and project-less detail titles; runtime reproduction is still required.

Implementation responsibility:
- Reproduce overview and direct detail navigation using current runtime/artifact fingerprints; distinguish missing metadata from competing effects and stale bundles.
- Implement one route-aware title owner using canonical project.name and resolved entity identity; remove competing child assignment/cleanup behavior.
- Use ProjectName on the overview and ProjectName - TaskID [Short task title] on task detail; use the same project-first convention for feature and phase detail and contextual list/document/source pages.
- Interpret the bracketed description as the short entity title, not the full task description; support references longer than three/four digits without truncating their identity.
- Handle deep links, reload, back/forward, detail-to-detail navigation, modals, live project/entity renames and errors/loading without restoring the previous project's title. Retain the last known correct project name where available; a pre-project bootstrap fallback must not persist after resolution.
- Preserve the existing visible AppShell project identity, accessible entity headings and settings; add focused title regressions and regenerate both tracked web-ui-dist consumers with the UI change.

Acceptance and evidence:
- Two initialized projects have distinguishable browser tabs on overview and detail routes.
- A task displays e.g. My Project - T1000 [Refactor parameter handling]; F/P detail follows the same project-first rule.
- Navigation, live renames, loading/errors with known project context and effect cleanup do not drop or restore stale project identity.

Read before editing:
- packages/plan-web-ui/index.html:6
- packages/plan-web-ui/src/app/root.tsx:25
- packages/plan-web-ui/src/components/detail/entity-detail-identity.tsx:28
- packages/plan-web-ui/src/components/layout/app-shell.tsx:118
- packages/plan-web-ui/src/app/router.tsx:51

Detailed discussion contract:
- The generic overview report is not proof that RootRoute lacks project-name code; reproduce the actual source and installed artifact path before fixing.
- Project context belongs in the browser title even when a detail heading describes a task. Keep short page identity separate from the full textual description.
- This early independent reliability fix can follow baseline A at the same phase priority; it does not wait for the code graph or Monaco.

Execution dependencies (registration aliases): none. Requirement aliases: BR18, BR15, BR16. Full design: .planner/docs/agent-brain-editor-and-project-identity.md.

Preserve canonical planner IDs/decision ownership, phase-scoped handoffs, existing settings, atomic session ownership, warning-only no-task behavior and shared versus worktree-local runtime boundaries. Read existing source precedents and applicable Guidelines before coding. File:line entries above are navigation evidence inspected on 21 October 2026, never durable identity; source hashes are recorded in the supporting document. Verify current code before implementation. Use task checklists rather than creating tasks per step. This registration does not start implementation, install dependencies, commit or publish.

Checklist:
- [ ] Reproduce overview and direct detail navigation using current runtime/artifact fingerprints; distinguish missing metadata from competing effects and stale bundles.
- [ ] Implement one route-aware title owner using canonical project.name and resolved entity identity; remove competing child assignment/cleanup behavior.
- [ ] Use ProjectName on the overview and ProjectName - TaskID [Short task title] on task detail; use the same project-first convention for feature and phase detail and contextual list/document/source pages.
- [ ] Interpret the bracketed description as the short entity title, not the full task description; support references longer than three/four digits without truncating their identity.
- [ ] Handle deep links, reload, back/forward, detail-to-detail navigation, modals, live project/entity renames and errors/loading without restoring the previous project's title. Retain the last known correct project name where available; a pre-project bootstrap fallback must not persist after resolution.
- [ ] Preserve the existing visible AppShell project identity, accessible entity headings and settings; add focused title regressions and regenerate both tracked web-ui-dist consumers with the UI change.
- [ ] Verify: Two initialized projects have distinguishable browser tabs on overview and detail routes.
- [ ] Verify: A task displays e.g. My Project - T1000 [Refactor parameter handling]; F/P detail follows the same project-first rule.
- [ ] Verify: Navigation, live renames, loading/errors with known project context and effect cleanup do not drop or restore stale project identity.

### K: Code workspace access and shared analysis service

Expose revision-aware source access and one reusable analysis runtime to agents and the Web UI.

Current state: packages/plan-server/src/serve.ts:525 exposes planner-owned Markdown document routes only; packages/plan-web-ui/src/lib/api.ts:1 consumes HTTP domain APIs. packages/plan-server/src/ws-hub.ts:1 broadcasts planner events, not source-buffer revisions. No general code workspace service is implemented.

P121/T474 owns common provider adapters and lifecycle, but does not yet implement a shared multi-consumer runtime. packages/plan-server/src/server-record.ts:1 shows existing local server discovery; its advisory record alone is not proof of atomic process ownership. MCP/Pi/server can run in different processes.

Goals:
- Provide project-scoped source reads and conflict-aware saves without broadening planner-document APIs.
- Share compatible provider processes across editor and supported agent surfaces with explicit document versions and ownership.

Responsibilities:
- K1: Add project-scoped source access and revision-safe file saves. A shared source-workspace service can enumerate, read and save user-project text files with explicit versions, conflicts and change provenance.
- K2: Share language-server processes across agents and the editor. Agents and the browser query one compatible provider runtime per project/worktree, provider/version and effective analysis configuration.

Boundaries:
- Do not recreate provider discovery/adapters owned by P121/T473-T475.
- Do not make browser-only Monaco APIs part of planner core or start the dashboard implicitly.

Risks:
- Independent MCP, Pi and Web UI hosts can each start a duplicate provider unless runtime ownership is coordinated.
- Unsaved editor buffers and external agent writes can invalidate analysis or lose work if versions are implicit.

Acceptance:
- The explorer can read and save files only in the resolved project scope; planner Markdown remains separately governed.
- Two consumers saving from the same revision cannot silently overwrite each other; conflict responses preserve both the user draft and current content.
- Successful or external saves notify consumers and invalidate dependent evidence without fabricating task attribution.
- Opening Monaco while an agent uses the same compatible workspace does not create a second language-server process; concurrent startup is covered by evidence.
- Different worktrees, providers or effective configurations are isolated and their results never cross-contaminate.
- Browser disconnect, unsaved edits, external saves and provider restart preserve explicit source versions and do not stop other consumers or advertise unsupported operations.

Use .planner/docs/agent-brain-editor-and-project-identity.md and exact child task contracts. Existing source references are named above; revalidate before editing.

Preserve canonical planner IDs/decision ownership, phase-scoped handoffs, existing settings, atomic session ownership, warning-only no-task behavior and shared versus worktree-local runtime boundaries. Read existing source precedents and applicable Guidelines before coding. File:line entries above are navigation evidence inspected on 21 October 2026, never durable identity; source hashes are recorded in the supporting document. Verify current code before implementation. Use task checklists rather than creating tasks per step. This registration does not start implementation, install dependencies, commit or publish.

Open implementation choices:

- Choose transport, runtime owner discovery and compatible reuse using existing server-record/runtime-boundary precedents; advisory records alone are not atomic exclusion.
- Define the explicit unsaved-overlay policy and resource limits for real tested providers; never silently substitute an editor buffer for disk.

#### P126(F025)/T484: Add project-scoped source access and revision-safe file saves

Outcome: A shared source-workspace service can enumerate, read and save user-project text files with explicit versions, conflicts and change provenance.

Existing state: packages/plan-server/src/serve.ts:525 exposes planner-owned Markdown document routes only; packages/plan-web-ui/src/lib/api.ts:1 consumes HTTP domain APIs. packages/plan-server/src/ws-hub.ts:1 broadcasts planner events, not source-buffer revisions. No general code workspace service is implemented.

Implementation responsibility:
- Read the existing source-access, document-path and runtime boundaries; add separate code-workspace APIs instead of widening .planner/docs routes.
- Resolve project/worktree roots and normalized relative paths; enforce root containment, explicit symlink handling, regular-text-file checks, encoding, binary/size limits and useful pagination for large trees.
- Return file content with revision/hash, language identity hints and checkout provenance; resolve durable CodeLinks via the existing E1 contract rather than treating a URL line as permanent identity.
- Implement saves with an expected revision, per-file serialization and safe replacement; reject stale saves with current/base/draft comparison rather than silently overwriting an agent or external edit.
- Observe on-disk changes and publish scoped source/version events; invalidate affected provider results, graph/context and meaning-review evidence through their owning contracts.
- Attribute UI/external edits honestly in task changesets, preserving unrelated dirty work and task/session ownership; verify APIs on isolated mkdtemp fixtures with save races, deletion and malformed/foreign paths.

Acceptance and evidence:
- The explorer can read and save files only in the resolved project scope; planner Markdown remains separately governed.
- Two consumers saving from the same revision cannot silently overwrite each other; conflict responses preserve both the user draft and current content.
- Successful or external saves notify consumers and invalidate dependent evidence without fabricating task attribution.

Read before editing:
- packages/plan-server/src/serve.ts:525
- packages/plan-server/src/ws-hub.ts:1
- packages/plan-web-ui/src/lib/api.ts:1
- packages/plan-core/docs/runtime-boundaries.md:1

Detailed discussion contract:
- Source bytes remain in the user-project filesystem; canonical planner links remain planner-owned and derived indexes are not a second source of truth.
- Saving code from the human supervisor does not imply that an agent task owns the edit, and does not grant agents a governance bypass.
- Revision checks are part of the save operation, not just an earlier client check. The implementation must document the actual external-writer race limits of its filesystem strategy.

Execution dependencies (registration aliases): F3. Requirement aliases: BR19, BR07, BR08, BR14, BR16. Full design: .planner/docs/agent-brain-editor-and-project-identity.md.

Preserve canonical planner IDs/decision ownership, phase-scoped handoffs, existing settings, atomic session ownership, warning-only no-task behavior and shared versus worktree-local runtime boundaries. Read existing source precedents and applicable Guidelines before coding. File:line entries above are navigation evidence inspected on 21 October 2026, never durable identity; source hashes are recorded in the supporting document. Verify current code before implementation. Use task checklists rather than creating tasks per step. This registration does not start implementation, install dependencies, commit or publish.

Checklist:
- [ ] Read the existing source-access, document-path and runtime boundaries; add separate code-workspace APIs instead of widening .planner/docs routes.
- [ ] Resolve project/worktree roots and normalized relative paths; enforce root containment, explicit symlink handling, regular-text-file checks, encoding, binary/size limits and useful pagination for large trees.
- [ ] Return file content with revision/hash, language identity hints and checkout provenance; resolve durable CodeLinks via the existing E1 contract rather than treating a URL line as permanent identity.
- [ ] Implement saves with an expected revision, per-file serialization and safe replacement; reject stale saves with current/base/draft comparison rather than silently overwriting an agent or external edit.
- [ ] Observe on-disk changes and publish scoped source/version events; invalidate affected provider results, graph/context and meaning-review evidence through their owning contracts.
- [ ] Attribute UI/external edits honestly in task changesets, preserving unrelated dirty work and task/session ownership; verify APIs on isolated mkdtemp fixtures with save races, deletion and malformed/foreign paths.
- [ ] Verify: The explorer can read and save files only in the resolved project scope; planner Markdown remains separately governed.
- [ ] Verify: Two consumers saving from the same revision cannot silently overwrite each other; conflict responses preserve both the user draft and current content.
- [ ] Verify: Successful or external saves notify consumers and invalidate dependent evidence without fabricating task attribution.

#### P126(F025)/T485: Share language-server processes across agents and the editor

Outcome: Agents and the browser query one compatible provider runtime per project/worktree, provider/version and effective analysis configuration.

Existing state: P121/T474 owns common provider adapters and lifecycle, but does not yet implement a shared multi-consumer runtime. packages/plan-server/src/server-record.ts:1 shows existing local server discovery; its advisory record alone is not proof of atomic process ownership. MCP/Pi/server can run in different processes.

Implementation responsibility:
- Extend P121 provider contracts with a shared analysis service; define the complete runtime key, capability negotiation, cancellation, diagnostics and source/configuration fingerprints.
- Coordinate a single compatible runtime owner across supported MCP/Pi/server hosts using an atomic startup/discovery mechanism; reuse live compatible owners and distinguish dead/incompatible owners without killing foreign embedded hosts.
- Keep one upstream LSP session under broker ownership and expose common analysis APIs to consumers. Do not connect independent frontend/backend initializations blindly to one stdio connection.
- Define document-open/change/close ownership, source revisions and explicit unsaved overlays. Agents normally query a named saved snapshot unless an overlay is explicitly requested; conflicting browser drafts never silently replace one another or the agent's analysis.
- Use bounded resources, consumer leases/reference tracking, idle cleanup, reconnect and crash recovery. Closing an editor tab must not stop a provider still used by agents; analysis lifecycle must not imply dashboard activation.
- Verify simultaneous editor and agent clients, including separate supported host processes: one process for the same key, appropriate separate processes for different keys, versioned results, unsupported capabilities and stale/partial failures.

Acceptance and evidence:
- Opening Monaco while an agent uses the same compatible workspace does not create a second language-server process; concurrent startup is covered by evidence.
- Different worktrees, providers or effective configurations are isolated and their results never cross-contaminate.
- Browser disconnect, unsaved edits, external saves and provider restart preserve explicit source versions and do not stop other consumers or advertise unsupported operations.

Read before editing:
- packages/plan-server/src/server-record.ts:1
- packages/plan-server/src/ws-hub.ts:1
- packages/plan-core/docs/runtime-boundaries.md:1
- packages/plan-mcp/src/index.ts:1
- packages/pi-adapter/src/index.ts:1

Detailed discussion contract:
- CodeMirror or Monaco is an editor/client, not a reason to start another server. The agreed design is one compatible analysis owner serving both human UI and agents.
- An editor LSP-client package does not automatically implement reuse. Prefer editor provider hooks mapped to the common broker APIs; an LSP gateway requires explicit initialization/session virtualization if selected.
- Language support remains manifest/configuration driven. Syntax coloring and semantic operations are separate capabilities, and no provider means explicit text-only/incomplete analysis rather than zero references.

Execution dependencies (registration aliases): K1, F2. Requirement aliases: BR20, BR11, BR14, BR16. Full design: .planner/docs/agent-brain-editor-and-project-identity.md.

Preserve canonical planner IDs/decision ownership, phase-scoped handoffs, existing settings, atomic session ownership, warning-only no-task behavior and shared versus worktree-local runtime boundaries. Read existing source precedents and applicable Guidelines before coding. File:line entries above are navigation evidence inspected on 21 October 2026, never durable identity; source hashes are recorded in the supporting document. Verify current code before implementation. Use task checklists rather than creating tasks per step. This registration does not start implementation, install dependencies, commit or publish.

Checklist:
- [ ] Extend P121 provider contracts with a shared analysis service; define the complete runtime key, capability negotiation, cancellation, diagnostics and source/configuration fingerprints.
- [ ] Coordinate a single compatible runtime owner across supported MCP/Pi/server hosts using an atomic startup/discovery mechanism; reuse live compatible owners and distinguish dead/incompatible owners without killing foreign embedded hosts.
- [ ] Keep one upstream LSP session under broker ownership and expose common analysis APIs to consumers. Do not connect independent frontend/backend initializations blindly to one stdio connection.
- [ ] Define document-open/change/close ownership, source revisions and explicit unsaved overlays. Agents normally query a named saved snapshot unless an overlay is explicitly requested; conflicting browser drafts never silently replace one another or the agent's analysis.
- [ ] Use bounded resources, consumer leases/reference tracking, idle cleanup, reconnect and crash recovery. Closing an editor tab must not stop a provider still used by agents; analysis lifecycle must not imply dashboard activation.
- [ ] Verify simultaneous editor and agent clients, including separate supported host processes: one process for the same key, appropriate separate processes for different keys, versioned results, unsupported capabilities and stale/partial failures.
- [ ] Verify: Opening Monaco while an agent uses the same compatible workspace does not create a second language-server process; concurrent startup is covered by evidence.
- [ ] Verify: Different worktrees, providers or effective configurations are isolated and their results never cross-contaminate.
- [ ] Verify: Browser disconnect, unsaved edits, external saves and provider restart preserve explicit source versions and do not stop other consumers or advertise unsupported operations.

### L: Integrated Monaco workspace and external-editor navigation

Provide editable project files, semantic navigation and code-to-planner context in the desktop Web UI.

Current state: packages/plan-web-ui/src/app/router.tsx:51 defines planner routes, packages/plan-web-ui/src/routes/doc-viewer.route.tsx:1 provides a Markdown textarea, and packages/plan-web-ui/package.json:1 has no code editor dependency. T385 deliberately kept the Markdown baseline lightweight; the new source-code workspace is a separately loaded capability.

P123/T479 owns graph and reverse code-to-rationale navigation, P120 owns anchors/history, P122 owns projections/retrieval, and K2 owns provider sessions. This task binds those existing contracts to the editor; it does not recreate any of them.

The current Web UI has no discovered preferred-editor launcher. packages/plan-server/src/serve.ts:1564 exposes existing UI configuration and AppShell receives local server context; runtime settings must stay local rather than becoming shared project policy.

Goals:
- Provide a file explorer, Monaco editing, diff and safe saves integrated with planner identity.
- Use shared analysis and canonical code links for semantic navigation, and open the selected file in a preferred external editor.

Responsibilities:
- L1: Build a lazy-loaded Monaco file explorer and editable workspace. A desktop code workspace provides a project file tree, file tabs, Monaco editing, syntax coloring, change comparison and conflict-aware saving.
- L2: Connect Monaco navigation to shared analysis and planner rationale. Selecting code exposes verified semantic navigation and relevant prior tasks, decisions, rules and evidence beside the current or historical source.
- L3: Open source locations in the preferred external editor. A user can open the current file or resolved symbol in a locally configured external editor, including line/column when supported.

Boundaries:
- Do not introduce a second planner, debugger, terminal, extension marketplace or general autonomous IDE platform.
- Mobile code editing is not an acceptance gate for choosing Monaco; preserve existing planner responsiveness and document actual source-view limits.

Risks:
- Editor workers/assets or mixed Monaco integration versions can fail in freshly packaged/offline deployments.
- A browser-local editor opener and a server-host launch target are different machines in LAN/remote use.

Acceptance:
- A user opens project files from the tree, edits, compares and saves them; navigation or external edits do not discard drafts silently.
- The same code workspace supports newly configured language assets without a core language whitelist; syntax availability is distinct from LSP readiness.
- Monaco works from freshly packed local artifacts with correctly resolved workers/assets, and opening ordinary planner pages does not eagerly load the code editor.
- Definition/reference navigation and context panels reuse the same provider and canonical identities seen by agents.
- The worked T002/T010/T020 case is navigable from both planner and code without inventing missing rationale.
- Unavailable/stale/partial analysis is explicit; historical source and draft context cannot be mistaken for current verified results.
- A configured editor opens the correct project/worktree file at the resolved location; launch arguments preserve literal paths.
- Preferences remain machine-local and the user can configure a compatible editor without changing core.
- Remote/LAN use and unsaved drafts never silently open or present the wrong machine/file version as current.

Use .planner/docs/agent-brain-editor-and-project-identity.md and exact child task contracts. Existing source references are named above; revalidate before editing.

Preserve canonical planner IDs/decision ownership, phase-scoped handoffs, existing settings, atomic session ownership, warning-only no-task behavior and shared versus worktree-local runtime boundaries. Read existing source precedents and applicable Guidelines before coding. File:line entries above are navigation evidence inspected on 21 October 2026, never durable identity; source hashes are recorded in the supporting document. Verify current code before implementation. Use task checklists rather than creating tasks per step. This registration does not start implementation, install dependencies, commit or publish.

Open implementation choices:

- Select compatible pinned Monaco/integration versions and measure bundle/runtime impact; React wrapper is optional and no dependency is approved for installation by this planning task.
- Choose the existing UI-aligned explorer/pane/tab layout and accessible keyboard contract before implementation; preserve current routes and settings.

#### P127(F025)/T486: Build a lazy-loaded Monaco file explorer and editable workspace

Outcome: A desktop code workspace provides a project file tree, file tabs, Monaco editing, syntax coloring, change comparison and conflict-aware saving.

Existing state: packages/plan-web-ui/src/app/router.tsx:51 defines planner routes, packages/plan-web-ui/src/routes/doc-viewer.route.tsx:1 provides a Markdown textarea, and packages/plan-web-ui/package.json:1 has no code editor dependency. T385 deliberately kept the Markdown baseline lightweight; the new source-code workspace is a separately loaded capability.

Implementation responsibility:
- Use Monaco Editor as the selected source-code component; resolve compatible ESM/worker/React integration versions and measure startup, memory and bundle cost before choosing any optional wrapper.
- Lazy-load the workspace, editor workers and needed language assets; ship assets locally in both tracked Web UI bundles rather than depending on a public CDN or assuming VS Code extensions can be installed.
- Implement the explorer, keyboard-accessible tabs/panes, file opening, search within a document, dirty indicators, explicit save/discard and safe close/navigation behavior using current routing/UI patterns.
- Bind models to project/worktree/file identity with versioned saved baselines; preserve separate drafts, undo history and selections across supported tab navigation, and dispose unused models/listeners deliberately.
- Connect K1 file APIs for saving and external-change notices; show base/draft/current conflicts and use the Monaco diff view without silently losing unsaved work.
- Load syntax support from an extensible language/asset registry independently of semantic providers; show explicit plain-text mode if a grammar/tokenizer is unavailable.
- Keep the Markdown document editor and existing planner pages lightweight; apply J1 project-first titles to source routes, regenerate both web-ui-dist consumers and verify fresh packaged desktop loading.

Acceptance and evidence:
- A user opens project files from the tree, edits, compares and saves them; navigation or external edits do not discard drafts silently.
- The same code workspace supports newly configured language assets without a core language whitelist; syntax availability is distinct from LSP readiness.
- Monaco works from freshly packed local artifacts with correctly resolved workers/assets, and opening ordinary planner pages does not eagerly load the code editor.

Read before editing:
- packages/plan-web-ui/src/app/router.tsx:51
- packages/plan-web-ui/src/routes/doc-viewer.route.tsx:1
- packages/plan-web-ui/src/components/layout/app-shell.tsx:118
- packages/plan-web-ui/package.json:1
- scripts/copy-web-ui.sh:1

Detailed discussion contract:
- The user chose the file-explorer/edit/highlight/open-external experience. Source editing and saving are included, not deferred behind a read-only-only first delivery.
- Monaco is selected for the desktop workflow after the user clarified that mobile code editing should not determine the editor choice. CodeMirror was evaluated, not accepted as the implementation choice.
- Do not mix incompatible Monaco wrappers and LSP stacks. No client-side language server is started by default; semantic operations use K2. Exact dependency versions are implementation choices verified against current primary docs and the installed bundle.

Execution dependencies (registration aliases): K1, J1, H2. Requirement aliases: BR19, BR18, BR11, BR15, BR16. Full design: .planner/docs/agent-brain-editor-and-project-identity.md.

Preserve canonical planner IDs/decision ownership, phase-scoped handoffs, existing settings, atomic session ownership, warning-only no-task behavior and shared versus worktree-local runtime boundaries. Read existing source precedents and applicable Guidelines before coding. File:line entries above are navigation evidence inspected on 21 October 2026, never durable identity; source hashes are recorded in the supporting document. Verify current code before implementation. Use task checklists rather than creating tasks per step. This registration does not start implementation, install dependencies, commit or publish.

Checklist:
- [ ] Use Monaco Editor as the selected source-code component; resolve compatible ESM/worker/React integration versions and measure startup, memory and bundle cost before choosing any optional wrapper.
- [ ] Lazy-load the workspace, editor workers and needed language assets; ship assets locally in both tracked Web UI bundles rather than depending on a public CDN or assuming VS Code extensions can be installed.
- [ ] Implement the explorer, keyboard-accessible tabs/panes, file opening, search within a document, dirty indicators, explicit save/discard and safe close/navigation behavior using current routing/UI patterns.
- [ ] Bind models to project/worktree/file identity with versioned saved baselines; preserve separate drafts, undo history and selections across supported tab navigation, and dispose unused models/listeners deliberately.
- [ ] Connect K1 file APIs for saving and external-change notices; show base/draft/current conflicts and use the Monaco diff view without silently losing unsaved work.
- [ ] Load syntax support from an extensible language/asset registry independently of semantic providers; show explicit plain-text mode if a grammar/tokenizer is unavailable.
- [ ] Keep the Markdown document editor and existing planner pages lightweight; apply J1 project-first titles to source routes, regenerate both web-ui-dist consumers and verify fresh packaged desktop loading.
- [ ] Verify: A user opens project files from the tree, edits, compares and saves them; navigation or external edits do not discard drafts silently.
- [ ] Verify: The same code workspace supports newly configured language assets without a core language whitelist; syntax availability is distinct from LSP readiness.
- [ ] Verify: Monaco works from freshly packed local artifacts with correctly resolved workers/assets, and opening ordinary planner pages does not eagerly load the code editor.

#### P127(F025)/T487: Connect Monaco navigation to shared analysis and planner rationale

Outcome: Selecting code exposes verified semantic navigation and relevant prior tasks, decisions, rules and evidence beside the current or historical source.

Existing state: P123/T479 owns graph and reverse code-to-rationale navigation, P120 owns anchors/history, P122 owns projections/retrieval, and K2 owns provider sessions. This task binds those existing contracts to the editor; it does not recreate any of them.

Implementation responsibility:
- Register Monaco provider hooks for available hover, definitions, references, signatures and diagnostics through K2 APIs; gate each operation on verified capability and document version.
- Resolve graph/task/decision CodeLinks through E1 when opening the editor; display ambiguous or stale candidates instead of assuming old file:line locations remain valid.
- Connect the editor selection and source range to the graph/context API and T479 inspection surface, exposing prior tasks, accepted decisions, requirements/rules and verification provenance.
- Support the T002/T010/T020 case: current signature, prior parameter purpose and the recorded slim/functional constraint appear through the shared code target even when tasks lack direct links.
- Keep current disk, unsaved draft and historical baseline contexts visibly distinct; do not query a live provider on old text and present the response as historical evidence.
- Verify degraded/no-provider operation, coordinate conversion, cancellation, large-reference pagination and stale-result rejection; preserve existing graph/hierarchy routes and accessible focus behavior.

Acceptance and evidence:
- Definition/reference navigation and context panels reuse the same provider and canonical identities seen by agents.
- The worked T002/T010/T020 case is navigable from both planner and code without inventing missing rationale.
- Unavailable/stale/partial analysis is explicit; historical source and draft context cannot be mistaken for current verified results.

Read before editing:
- packages/plan-web-ui/src/routes/task-detail/route.tsx:108
- packages/plan-core/src/api-v1.ts:343
- packages/plan-server/src/entity-events.ts:1
- packages/plan-server/src/serve.ts:185

Detailed discussion contract:
- The differentiator is code plus project intent: LSP contributes technical results while approved decisions and conventions come from canonical planner knowledge.
- T479 remains the owner of graph inspection; this task owns editor bindings and cross-navigation. A selected code region can be shown with relevant evidence without asserting that the model understood the whole project.

Execution dependencies (registration aliases): L1, K2, H1. Requirement aliases: BR19, BR20, BR07, BR09, BR12, BR13, BR14, BR15. Full design: .planner/docs/agent-brain-editor-and-project-identity.md.

Preserve canonical planner IDs/decision ownership, phase-scoped handoffs, existing settings, atomic session ownership, warning-only no-task behavior and shared versus worktree-local runtime boundaries. Read existing source precedents and applicable Guidelines before coding. File:line entries above are navigation evidence inspected on 21 October 2026, never durable identity; source hashes are recorded in the supporting document. Verify current code before implementation. Use task checklists rather than creating tasks per step. This registration does not start implementation, install dependencies, commit or publish.

Checklist:
- [ ] Register Monaco provider hooks for available hover, definitions, references, signatures and diagnostics through K2 APIs; gate each operation on verified capability and document version.
- [ ] Resolve graph/task/decision CodeLinks through E1 when opening the editor; display ambiguous or stale candidates instead of assuming old file:line locations remain valid.
- [ ] Connect the editor selection and source range to the graph/context API and T479 inspection surface, exposing prior tasks, accepted decisions, requirements/rules and verification provenance.
- [ ] Support the T002/T010/T020 case: current signature, prior parameter purpose and the recorded slim/functional constraint appear through the shared code target even when tasks lack direct links.
- [ ] Keep current disk, unsaved draft and historical baseline contexts visibly distinct; do not query a live provider on old text and present the response as historical evidence.
- [ ] Verify degraded/no-provider operation, coordinate conversion, cancellation, large-reference pagination and stale-result rejection; preserve existing graph/hierarchy routes and accessible focus behavior.
- [ ] Verify: Definition/reference navigation and context panels reuse the same provider and canonical identities seen by agents.
- [ ] Verify: The worked T002/T010/T020 case is navigable from both planner and code without inventing missing rationale.
- [ ] Verify: Unavailable/stale/partial analysis is explicit; historical source and draft context cannot be mistaken for current verified results.

#### P127(F025)/T488: Open source locations in the preferred external editor

Outcome: A user can open the current file or resolved symbol in a locally configured external editor, including line/column when supported.

Existing state: The current Web UI has no discovered preferred-editor launcher. packages/plan-server/src/serve.ts:1564 exposes existing UI configuration and AppShell receives local server context; runtime settings must stay local rather than becoming shared project policy.

Implementation responsibility:
- Add a local user/machine editor preference and extensible launcher definitions with executable/argument templates or supported URI mechanisms; do not restrict the product to a fixed editor list.
- Resolve the current CodeLink/file/worktree and location before launch; pass structured arguments through a validated launcher without evaluating browser-provided shell commands.
- Provide Open in preferred editor from the workspace and relevant source links, with actionable missing-launcher or unsupported-position diagnostics.
- Make the target machine explicit: a server-host launcher opens on that host, while browser-device opening requires an explicitly supported local handler and path mapping; never claim a remote path is automatically local.
- Detect dirty editor drafts before opening the disk file and make save/open behavior explicit; observe later external edits through K1 without silently overwriting the browser draft.
- Verify path escaping, spaces, Unicode, long refs resolved to locations, unsupported OS/editor configuration and host mismatch with stubbed launchers in temporary fixtures; retain project identity and current human controls.

Acceptance and evidence:
- A configured editor opens the correct project/worktree file at the resolved location; launch arguments preserve literal paths.
- Preferences remain machine-local and the user can configure a compatible editor without changing core.
- Remote/LAN use and unsaved drafts never silently open or present the wrong machine/file version as current.

Read before editing:
- packages/plan-server/src/serve.ts:1564
- packages/plan-server/src/server-record.ts:1
- packages/plan-web-ui/src/lib/api.ts:1
- packages/plan-core/docs/runtime-boundaries.md:1

Detailed discussion contract:
- Opening an editor is an explicit human action. An editor preference is not a project-wide Accepted Decision and must not leak machine-specific paths into canonical configuration.
- File:line is a launch position only; durable source identity is resolved before constructing the launch request. This planning task does not install or launch any editor.

Execution dependencies (registration aliases): L1. Requirement aliases: BR21, BR07, BR18, BR16. Full design: .planner/docs/agent-brain-editor-and-project-identity.md.

Preserve canonical planner IDs/decision ownership, phase-scoped handoffs, existing settings, atomic session ownership, warning-only no-task behavior and shared versus worktree-local runtime boundaries. Read existing source precedents and applicable Guidelines before coding. File:line entries above are navigation evidence inspected on 21 October 2026, never durable identity; source hashes are recorded in the supporting document. Verify current code before implementation. Use task checklists rather than creating tasks per step. This registration does not start implementation, install dependencies, commit or publish.

Checklist:
- [ ] Add a local user/machine editor preference and extensible launcher definitions with executable/argument templates or supported URI mechanisms; do not restrict the product to a fixed editor list.
- [ ] Resolve the current CodeLink/file/worktree and location before launch; pass structured arguments through a validated launcher without evaluating browser-provided shell commands.
- [ ] Provide Open in preferred editor from the workspace and relevant source links, with actionable missing-launcher or unsupported-position diagnostics.
- [ ] Make the target machine explicit: a server-host launcher opens on that host, while browser-device opening requires an explicitly supported local handler and path mapping; never claim a remote path is automatically local.
- [ ] Detect dirty editor drafts before opening the disk file and make save/open behavior explicit; observe later external edits through K1 without silently overwriting the browser draft.
- [ ] Verify path escaping, spaces, Unicode, long refs resolved to locations, unsupported OS/editor configuration and host mismatch with stubbed launchers in temporary fixtures; retain project identity and current human controls.
- [ ] Verify: A configured editor opens the correct project/worktree file at the resolved location; launch arguments preserve literal paths.
- [ ] Verify: Preferences remain machine-local and the user can configure a compatible editor without changing core.
- [ ] Verify: Remote/LAN use and unsaved drafts never silently open or present the wrong machine/file version as current.

## Ownership and execution boundaries

- T474/T475 continue to own dynamic provider adapters and provider conformance. K2 extends their contracts with shared runtime ownership and consumer/document lifecycle.
- T479 continues to own graph inspection and reverse rationale navigation. L2 owns editor bindings to those contracts.
- T481/T482 remain the final verification and installed-artifact/documentation owners. They must wait for the new editor completion tasks.
- J can follow baseline A without depending on semantic analysis. K follows provider setup; L follows K and the existing supervisor UI work. Priorities and validated task edges, not numerical phase order, govern execution.
- Existing T385 Markdown textarea and its lightweight rationale stay intact; the Monaco source workspace is separately loaded.

## Source inspection and provenance

The following positions are dated navigation evidence, not permanent anchors. Re-read the named modules against the current worktree before implementation. No product behavior was tested in this registration.

| Source | SHA-256 |
|---|---|
| packages/pi-adapter/src/index.ts:1 | 167ac3fd6b7f4294e47f7c5c9815a585b35abcb7d78ce60f3d712abc03dd0da0 |
| packages/plan-core/docs/runtime-boundaries.md:1 | cd4157af1cd51b5157c8cd70defc6dbdca6d84b71688298d05fa1c3aec6aaf1a |
| packages/plan-core/src/api-v1.ts:343 | d26d55905771d106fda58a6d637dbb1a333bc3d22d11c97bb0f13e278f316c9e |
| packages/plan-mcp/src/index.ts:1 | 9758764c28657590fa9dfbd8aea40b6009ca04f9031487c8161524483a7c6179 |
| packages/plan-server/src/entity-events.ts:1 | 4701eceee5efc585779697e1baa52d4711be44689c42dd1291b3509cb3ae68ff |
| packages/plan-server/src/serve.ts:1564 | 683ad4cb8d6205323af8b0ddd5ec7e12e8e5f44425f4624101f9c5c87234d8be |
| packages/plan-server/src/serve.ts:185 | 683ad4cb8d6205323af8b0ddd5ec7e12e8e5f44425f4624101f9c5c87234d8be |
| packages/plan-server/src/serve.ts:525 | 683ad4cb8d6205323af8b0ddd5ec7e12e8e5f44425f4624101f9c5c87234d8be |
| packages/plan-server/src/server-record.ts:1 | 462f5450ed3b7c4c0a256cc41178908020dcbfe5a0d38d82034e282a504a660d |
| packages/plan-server/src/ws-hub.ts:1 | 60c83b95d41550f4fd043c23330279a60dc2c3c187a045172f18dbc3416bd7a8 |
| packages/plan-web-ui/index.html:6 | d6790572807201cf16a9dc2025d21d6f9c153f589df89c136980ece571fc3b5a |
| packages/plan-web-ui/package.json:1 | f2d89810108cf6f23acfe70280bfe63a238daea8dc9180cc9ca15d0561c282b5 |
| packages/plan-web-ui/src/app/root.tsx:25 | 228853a5341286c4e65939e3d98dc64beae149532076c5e30c87bda1bfc2437c |
| packages/plan-web-ui/src/app/router.tsx:51 | 5e558ddd71a6b871955137e6bdb3c956b8c1ce81123e526b3942872c1492b3ef |
| packages/plan-web-ui/src/components/detail/entity-detail-identity.tsx:28 | bc0b8a296acb42b6e7fc511425c8925cbb7197034dfb28877461062a4ca9b643 |
| packages/plan-web-ui/src/components/layout/app-shell.tsx:118 | c896123bac339d9c625fd2b5b1876b171fd33ef7eb5cb87a6a0a892997cad21e |
| packages/plan-web-ui/src/lib/api.ts:1 | b8b79604a5f540a36f38834a10c3058d99020fb6e74d970953c32f64169d5147 |
| packages/plan-web-ui/src/routes/doc-viewer.route.tsx:1 | e22f9ee0c8b1accd773a942bdd8b0387c0bfe575f6dd7621699ff9fdabb97e35 |
| packages/plan-web-ui/src/routes/task-detail/route.tsx:108 | 623bdf0a6fe8a74851d59e3b6c5a9c5139962d89aa7c1fa240faa1af61ef47b1 |
| scripts/copy-web-ui.sh:1 | aff87cb8729154bd04d473d2de73b99dbf5f285700d91b5d1db8e14cdf7e5ec5 |

## Package research and implementation choices

- Monaco Editor: https://github.com/microsoft/monaco-editor — use its supported public API and locally shipped ESM workers/assets; the library is not the complete VS Code application.
- Optional React wrappers or TypeFox integrations must use a compatible tested version matrix: https://github.com/TypeFox/monaco-languageclient . They are candidates, not a mandate to add every package.
- The common broker can serve Monaco provider hooks directly. Do not install a frontend LSP client merely to duplicate a server already used by agents.
- Select versions, measure actual bundle/memory/latency and verify fresh packed-artifact behavior in the owning implementation tasks. No hypothetical package-size estimate is acceptance evidence.

## Verification expectations

- Project titles: two projects; direct and client navigation; back/forward; live rename; effect cleanup; known-context error/loading; long refs.
- Workspace: isolated files, literal paths, root/symlink boundaries, binary/large text handling, two-client save conflicts and external edits.
- Broker: simultaneous editor and agent consumers, supported separate host processes, one compatible provider process, distinct keys, restart/reconnect and explicit saved/draft versions.
- Editor: local/offline worker loading from freshly packed assets, tabs/drafts/undo/diff, new language metadata, graph/context navigation and external opener target-machine semantics.
- Use the canonical bounded verification runner where it supports the affected scope. Run the final full gate only at the prescribed phase/feature close; no product tests or installed verification have been performed by this planning update.

## Planning verification

Canonical records were read back through public feature/phase/task/requirement tools and checked against persisted state. The verification report is `.planner/docs/agent-brain-editor-expansion-verification.json`. This confirms registration and dependency integrity only; no product code, dependency installation, editor launch or product tests were performed.
