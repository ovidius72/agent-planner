# Agent Brain improvements and fixes

Created 2026-11-12. Maintained register of corrections and improvements to address during Agent Brain development (F025).

This document preserves reported problems, expected behaviour and verification criteria. Canonical planner tasks own implementation status, priority, dependencies and completion evidence. Recording an entry does not create a task or certify a fix. Discuss and attach implementation work to the appropriate existing owner before creating another task.

| ID | Type | Subject | Existing planning context |
| --- | --- | --- | --- |
| AB-IMP-001 | Reliability improvement | Decision changes must trigger dependency-impact review. | P132(F025)/T503; foundation P128(F025)/T496. |
| AB-IMP-002 | Discovery improvement | Supply useful operating guidance from initial setup and plan progressively. | P132(F025)/T504; foundations P119(F025)/T468 and T469. |
| AB-IMP-003 | Guidance improvement | Define and consistently deliver configurable communication and conduct rules. | P132(F025)/T505; foundation P119(F025)/T468 and Project Guidelines. |
| AB-IMP-004 | Reported bug | Structured search omits empty features and phases. | P132(F025)/T506. |
| AB-IMP-005 | UI improvement | Show the project description in a collapsed accordion. | P132(F025)/T507. |
| AB-IMP-006 | Reported performance bug | Planner writes return project-wide freshness diagnostics and consume excessive tokens. | P132(F025)/T508; foundation P128(F025)/T496. |
| AB-IMP-007 | Reported scheduling bug | A session receives work from another agent's phase instead of continuing its own. | P116(F025)/T462 and P117(F025)/T463; task proposal pending. |
| AB-IMP-008 | Reported scheduling bug | A higher-priority empty phase is never suggested for task-planning discussion. | P116(F025)/T462 and P117(F025)/T463; task proposal pending. |

## AB-IMP-001 — Review affected task contracts after decision changes

**Problem.** A decision or contract can change while related tasks retain instructions based on the previous decision. Updating only the edited entity or its parent descriptions misses obsolete prerequisites and consumers.

**Expected behaviour.**

- Detect meaningful decision/contract changes, including changed applicability, supersession and dependency edits. Ordinary activity timestamps must not trigger a full semantic review.
- For a task-level change, inspect the task's prerequisites and reverse dependents. Include consumers reached through affected prerequisite contracts and follow affected dependency chains transitively; reviewing only the edited task's direct dependents is insufficient.
- For a phase-level change, start with every contained task. For a feature-level change, start with every task in its phases. Include affected prerequisites and dependents outside the changed phase or feature.
- Use old and new relationships when an edge or parent changes, so removing an edge does not hide a previously affected consumer. Deduplicate visited entities and validate graph consistency.
- Review affected descriptions, requirements, decisions, scope and acceptance criteria against the changed facts. Reconcile affected phase/feature/project context through its canonical owner.
- Record a factual update, revision-bound reviewed-unchanged evidence, or a durable pending reconciliation obligation for each affected contract. Show unresolved impact to later agents and refresh applicable context when they return to that work.
- Preserve historical completion evidence. A new decision may require an adaptation; it does not justify silently reopening completed tasks, deleting history or changing unrelated statuses.
- Enumerate impact through maintained relationship indexes and process genuine fan-out in bounded batches. Keep continuation and pending obligations complete; token budgets must not silently drop affected tasks or force an unconditional full-plan reread.

**Verification.** Cover a task change with prerequisites, sibling consumers of an affected prerequisite, and indirect dependents across features. Cover phase and feature decisions with several contained tasks, edge removal, an unchanged consumer, an already-completed historical task and interrupted review resumed by another agent. Check both impact completeness and bounded context delivery. Preserve existing lifecycle/approval policy; this entry does not introduce a new blanket command-denial rule.

**Planning reference.** P132(F025)/T503 extends P128(F025)/T496 and [the reconciliation/token-budget contract](../../.planner/docs/agent-brain-impact-reconciliation-and-token-budgets.md), rather than creating another dependency authority.

## AB-IMP-002 — Bootstrap useful discovery in an empty project

**Problem.** Initial project setup cannot rely on project-specific descriptions, rules or documents that have not been written yet. Without useful built-in guidance, agents may store conversation commentary or vague placeholders instead of discovering and describing the project.

**Expected behaviour.**

- Make canonical planner documentation and a portable operating skill available from initialization, before a project description or custom rules exist. Deliver usable instructions through the supported bootstrap/MCP/Pi/API paths; a link to a missing project file or an undiscoverable DB-only skill is insufficient.
- Explain how to collect the project's purpose, intended users, outcomes, scope, constraints, requirements, decisions and applicable conventions. An empty folder or an undecided programming language remains valid.
- Write project descriptions as clear statements of the product and the information actually established. Do not populate canonical descriptions with conversational filler such as "We are still deciding", attributed meeting notes such as "Person X asked for this; verify later", or invented answers used to fill blanks.
- Preserve genuine uncertainty as explicit, actionable discovery questions in the appropriate field. Do not present an unanswered question as an accepted fact or hide it behind boilerplate.
- Allow features and phases to emerge during discovery. A useful initial plan may contain features/phases and no tasks.
- Discuss implementation tasks in detail with the grill-me workflow when the relevant feature or phase is prepared for execution. Respect explicit user requests for earlier task planning, reuse existing capability owners and avoid speculative task proliferation.
- Keep generic operating guidance available independently of project-specific rules, while preserving user customizations and meaningful context restoration.

**Verification.** Initialize through supported agent entry points with no repository description, project rules, source files or selected language. Verify that the agent receives actionable operating guidance, produces a factual project description, retains precise open questions, and can establish features/phases without automatically generating tasks. Later feature/phase discovery must produce discussed, proportionate tasks with current parent context.

**Planning reference.** P132(F025)/T504 builds on P119(F025)/T468 for portable guidance and P119(F025)/T469 for proportionate planning. Coordinate initialization/API delivery with the existing service owners.

## AB-IMP-003 — Define communication and conduct preferences

**Problem.** Agents need explicit guidance about how to communicate and conduct discovery/work, including before a project has custom guidelines.

**Expected behaviour.**

- Support communication preferences such as brevity, explanation depth and formal or informal tone as separate configurable choices. Do not assume that a short response must omit necessary reasoning or that an explanatory response must be verbose.
- Offer these preferences during discovery and allow later updates. Store project-wide conduct in canonical Project Guidelines, with user defaults providing a starting point. Keep product operating rules in the canonical planner guide/rules, rather than duplicating them in AGENTS.md.
- Apply explicit instructions in the current conversation, then applicable project preferences, then user defaults and product defaults. Preferences cannot grant permissions or erase factual uncertainty.
- Deliver effective guidance consistently across supported harnesses at initial setup/load and after relevant changes or context loss. Reuse unchanged guidance when valid without repeatedly transmitting the entire project.
- Keep canonical project content factual and task-focused; communication preferences do not justify fabricated certainty, conversation transcripts in product descriptions or suppression of relevant blockers.

**Verification.** Exercise concise, formal and explanatory configurations, a project override, a direct user instruction, a mid-session change and context restoration in MCP/Pi integrations. Verify that style changes preserve necessary facts, operating guidance and existing authorization rules.

**Planning reference.** P132(F025)/T505 builds on P119(F025)/T468 and canonical Project Guidelines. Detailed settings/UI choices belong to their implementation discussion.

## AB-IMP-004 — Find empty features and phases through structured search

**Reported behaviour.** The Web UI's elastic-input search does not return empty phases/features. This prevents users from finding valid entities while progressively building a plan.

**Expected behaviour.**

- Match feature and phase entities independently of the presence of descendant tasks. Support a feature with no phases, a phase with no tasks and a feature whose phases are all empty.
- Preserve supported entity identifiers, names/free-text and structured feature/phase filters. An independently matching parent must not require a fabricated matching task to appear.
- Keep suggestions and result matching consistent with supported fields, including applicable feature/phase titles. Retain existing task matching and respect explicit status/scope filters.
- Preserve entity navigation, project scope and correct zero-task counts while displaying the matching parent.

**Inspection points.** In [use-dashboard-tree.ts](../../packages/plan-web-ui/src/hooks/use-dashboard-tree.ts), matching feature/phase IDs are currently collected inside iteration over tasks through `matchTask`. In [search-bar.tsx](../../packages/plan-web-ui/src/components/dashboard/search-bar.tsx), title suggestions currently come from task titles. Review these together with [task-search.ts](../../packages/plan-web-ui/src/lib/task-search.ts) and the existing tree visibility rules. These are source inspection findings; capture a minimal UI reproduction and verify the final behaviour when implementing the fix.

**Verification.** Search for each empty-entity case by supported reference and name, including structured feature/phase queries. Compare suggestion selection with the resulting tree, clear the query, apply relevant status filters, and repeat with a normal task-bearing branch. Empty entities must remain discoverable without incorrect task matches or regression of existing filters.

**Planning reference.** P132(F025)/T506 owns this correction, reusing the existing dashboard/search responsibilities.

## AB-IMP-005 — Collapse the project description in the Web UI

**Problem.** A long project description takes too much space in the Web UI and makes the rest of the project harder to scan.

**Expected behaviour.** Show the project description in an accordion that is collapsed initially. The user can expand it to read the complete formatted description and collapse it again. Preserve the project name and access to the description, use accessible accordion semantics and keyboard interaction, and handle a missing or empty description without showing an empty control. Follow the reviewed Agent Brain UI design and reuse the project's appropriate existing components.

**Inspection point.** The current project description is rendered in [app-shell.tsx](../../packages/plan-web-ui/src/components/layout/app-shell.tsx). Review the actual layout and component conventions when implementing the redesigned UI.

**Verification.** With a long description, confirm the initial collapsed state, expand and collapse by pointer and keyboard, and verify the full formatted text remains readable. Check the empty-description state and navigation between projects.

**Planning reference.** P132(F025)/T507 owns this improvement and follows the existing F025 UI design contracts.

## AB-IMP-006 — Bound diagnostics returned by planner writes

**Reported behaviour.** An agent reports that planner task/phase updates return extensive checks for unrelated phases, consuming thousands of tokens. Reproduce and measure the report using isolated fixtures.

**Source inspection.** Description and description-reference updates in the MCP task/phase handlers call `previewDescriptionReconciliation`, then include its complete project-wide `descriptionFreshness` result in mutation extras even though `staleParentRefs` is filtered to the owning parents. `PlanStore.previewDescriptionReconciliation` loads the complete workspace, and the shared mutation reply leaves extras untrimmed. Inspect [MCP handlers](../../packages/plan-mcp/src/index.ts), [freshness calculation](../../packages/plan-core/src/description-freshness.ts), [PlanStore](../../packages/plan-core/src/plan-store.ts), [mutation replies](../../packages/plan-core/src/mutation-reply.ts), and the equivalent [Pi adapter](../../packages/pi-adapter/src/index.ts) paths. This specifically establishes the source path for description updates; measure other write types separately.

**Expected behaviour.** A successful task/phase description-only update returns a brief confirmation of the persisted write and entity reference. If the change affects a dependency of the requesting agent's current activity, add only a concise account of that relevant dependency, what changed and why it matters. Do not echo the description or include unrelated freshness diagnostics, previews or pending lists in either output channel. Where relevance is uncertain, retain the obligation for retrieval or the next context refresh without inventing an impact. Confirmation proves persistence, not semantic reconciliation. Keep affected-parent/dependency checks and unresolved obligations in the reconciliation system, with details and bounded continuation available on explicit request. Failed writes return errors. Preserve essential warnings, lost-checklist-tick and resume-required notices for other operations, including combined updates with side effects. A separate explicitly requested project-wide audit remains available. Reuse T496's shared reconciliation authority and T503's decision-impact coverage.

**Open implementation discussion.** A change may affect another agent working in a different phase. Determine whether, when and how that agent should be notified, including relevance, attribution, offline/recovery behavior, privacy and token cost. The transport and notification policy are not decided.

**Verification.** Compare fixed equivalent task and phase description updates on small and large isolated plans while increasing unrelated phases and stale parents. Verify confirmation alone when the agent's current activity is unaffected; add only the relevant dependency-change details when it is affected. Evaluate another affected agent in a different phase, unrelated sessions and unknown relevance against the notification design agreed during implementation. Failures return errors and actual obligations remain available on request. Measure backend work, runtime and complete MCP/Pi response bytes/tokens, including any duplication between text and structured content. Confirm unchanged non-description/combined writes, full on-demand audit, real cross-feature dependencies and retained essential notices. Report actual measurements and compatibility implications.

**Planning reference.** P132(F025)/T508 depends on P128(F025)/T496. P124(F025)/T481 includes its standalone closeout evidence.

## AB-IMP-007 — Session-aware next work and phase continuity

**Reported behaviour.** Two agents work concurrently: dev-1 has P001/T001–T003, dev-2 has P002/T004–T006. Once dev-2 completes T004, the planner recommends T002 from dev-1's phase because it has higher priority. The expected next step for dev-2 is T005 in its own assigned/current phase, subject to eligibility and ownership.

**Expected outcome.** Carry the requesting planner session identity and its current/assigned phase through completion and recommendation, so one session's focus is not mistaken for another's. Explain the candidate, exclusions, current phase and any ownership/dependency condition. Maintain individual task ownership; phase continuity does not itself create an exclusive phase lock. Do not infer a session from another agent or silently transfer ownership. Missing, ambiguous or expired session/focus needs an explicit recovery/clarification path.

**Decision to discuss.** The existing T462/T463 contract gives globally ready feature → phase → task priority after active work and returns. This report requests continuity in an agent's assigned phase, even when another phase has higher-priority work. Agree the exact precedence, assignment lifetime, behavior when the phase is blocked/empty/completed, and user-approved deviations before altering the existing decision. In particular, do not generalize the example into an exclusive phase lock or a global pool without agreement.

**Source inspection.** `recommendNextTask` already accepts `sessionId` and `currentPhaseId`; the MCP recommendation call passes a `plannerSessionId` and persisted focus. Inspect [task-selection.ts](../../packages/plan-core/src/task-selection.ts), [MCP](../../packages/plan-mcp/src/index.ts), completion/recap and Pi paths, and the actual installed runtime. The report does not establish that the ID is always absent, nor identify which propagation, focus or priority rule caused the observed recommendation. Reproduce on isolated fixtures before attributing the cause.

**Verification.** Reproduce the exact two-session example, including the result immediately after T004 completion on each supported surface. Check that dev-1 and dev-2 retain separate focus, neither claims the other's active task, a blocked or completed phase and a missing session are explained, and a restart/compaction follows the agreed recovery rules. Check the agreed interaction with global priorities, explicit user deviations and pending returns; recommendations are not reservations.

**Proposed task.** Add a dedicated P132 verification/adaptation task that builds on the shared selector owned by T462/T463. Define cross-session phase continuity and propagate caller context through every recommendation path; do not duplicate the selector. Task creation and priority are not yet registered by this report.

## AB-IMP-008 — Recommend discussion for a higher-priority empty phase

**Reported behaviour.** P001 has priority 1 but no tasks; P002 has priority 2 and contains tasks. A task-only recommendation skips P001 indefinitely even though it requires discussion to prepare its tasks.

**Expected outcome.** Treat a legitimately empty phase as a possible phase-level next action: discuss/prepare P001, rather than creating a fake task or claiming that a real task is ready. Include its feature/phase identity, priority and reason in the recommendation. Preserve the distinction between a phase awaiting planning, a phase intentionally left empty, a phase whose tasks are terminal and a blocked or otherwise ineligible phase; the precise eligibility signal and ordering need discussion.

**Verification.** With P001 empty and P002 containing ready work, surface the phase-planning action at the agreed point in the precedence order. Test a deliberately empty/excluded phase, phase containing only terminal tasks, blocked phase, multiple sessions and completed preparation; do not endlessly recommend preparation after the phase has been deliberately resolved. No task is created implicitly.

**Proposed task.** Add a P132 task for the phase-level planning recommendation and its MCP/Pi/CLI/UI presentation, using the shared T462/T463 contract and T465 resume projection. Agree how phase intent and session/priority precedence are represented before implementation. Task creation and priority are not yet registered by this report.

## Maintaining this register

1. Append a stable entry ID for each newly discovered bug or improvement. Keep prior IDs and useful resolution history.
2. Record the concrete problem, expected behaviour, verification criteria and relevant modules/contracts. Label a user report, source inspection and reproduced behaviour accurately.
3. Check existing entries and canonical owners before adding duplicate work. Link an implementation task when its scope is discussed; keep task status and priorities in the planner.
4. When decisions change, review related entries and affected canonical contracts using AB-IMP-001. Update this document with the agreed correction rather than leaving contradictory instructions.
5. When resolved, retain the entry and add the owning task, actual verification evidence and release/revision when known. Recording a fix or passing an unrelated test does not establish resolution.
