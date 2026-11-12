# Agent Brain improvements and fixes

Created 2026-11-12. Maintained register of corrections and improvements to address during Agent Brain development (F025).

This document preserves reported problems, expected behaviour and verification criteria. Canonical planner tasks own implementation status, priority, dependencies and completion evidence. Recording an entry does not create a task or certify a fix. Discuss and attach implementation work to the appropriate existing owner before creating another task.

| ID | Type | Subject | Existing planning context |
| --- | --- | --- | --- |
| AB-IMP-001 | Reliability improvement | Decision changes must trigger dependency-impact review. | P128(F025)/T496 and the existing reconciliation contract. |
| AB-IMP-002 | Discovery improvement | Supply useful operating guidance from initial setup and plan progressively. | P119(F025)/T468 and T469; initialization/client delivery contracts. |
| AB-IMP-003 | Guidance improvement | Define and consistently deliver configurable communication and conduct rules. | P119(F025)/T468 and canonical Project Guidelines. |
| AB-IMP-004 | Reported bug | Structured search omits empty features and phases. | Dashboard/search integration; select the implementation owner during phase discovery. |

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

**Planning reference.** Extend P128(F025)/T496 and [the reconciliation/token-budget contract](../../.planner/docs/agent-brain-impact-reconciliation-and-token-budgets.md), rather than creating another dependency authority.

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

**Planning reference.** P119(F025)/T468 owns portable guidance and P119(F025)/T469 owns proportionate planning. Coordinate initialization/API delivery with the existing service owners; this register does not move their responsibilities.

## AB-IMP-003 — Define communication and conduct preferences

**Problem.** Agents need explicit guidance about how to communicate and conduct discovery/work, including before a project has custom guidelines.

**Expected behaviour.**

- Support communication preferences such as brevity, explanation depth and formal or informal tone as separate configurable choices. Do not assume that a short response must omit necessary reasoning or that an explanatory response must be verbose.
- Offer these preferences during discovery and allow later updates. Store project-wide conduct in canonical Project Guidelines, with user defaults providing a starting point. Keep product operating rules in the canonical planner guide/rules, rather than duplicating them in AGENTS.md.
- Apply explicit instructions in the current conversation, then applicable project preferences, then user defaults and product defaults. Preferences cannot grant permissions or erase factual uncertainty.
- Deliver effective guidance consistently across supported harnesses at initial setup/load and after relevant changes or context loss. Reuse unchanged guidance when valid without repeatedly transmitting the entire project.
- Keep canonical project content factual and task-focused; communication preferences do not justify fabricated certainty, conversation transcripts in product descriptions or suppression of relevant blockers.

**Verification.** Exercise concise, formal and explanatory configurations, a project override, a direct user instruction, a mid-session change and context restoration in MCP/Pi integrations. Verify that style changes preserve necessary facts, operating guidance and existing authorization rules.

**Planning reference.** P119(F025)/T468 and canonical Project Guidelines. Detailed settings/UI choices belong to their implementation discussion.

## AB-IMP-004 — Find empty features and phases through structured search

**Reported behaviour.** The Web UI's elastic-input search does not return empty phases/features. This prevents users from finding valid entities while progressively building a plan.

**Expected behaviour.**

- Match feature and phase entities independently of the presence of descendant tasks. Support a feature with no phases, a phase with no tasks and a feature whose phases are all empty.
- Preserve supported entity identifiers, names/free-text and structured feature/phase filters. An independently matching parent must not require a fabricated matching task to appear.
- Keep suggestions and result matching consistent with supported fields, including applicable feature/phase titles. Retain existing task matching and respect explicit status/scope filters.
- Preserve entity navigation, project scope and correct zero-task counts while displaying the matching parent.

**Inspection points.** In [use-dashboard-tree.ts](../../packages/plan-web-ui/src/hooks/use-dashboard-tree.ts), matching feature/phase IDs are currently collected inside iteration over tasks through `matchTask`. In [search-bar.tsx](../../packages/plan-web-ui/src/components/dashboard/search-bar.tsx), title suggestions currently come from task titles. Review these together with [task-search.ts](../../packages/plan-web-ui/src/lib/task-search.ts) and the existing tree visibility rules. These are source inspection findings; capture a minimal UI reproduction and verify the final behaviour when implementing the fix.

**Verification.** Search for each empty-entity case by supported reference and name, including structured feature/phase queries. Compare suggestion selection with the resulting tree, clear the query, apply relevant status filters, and repeat with a normal task-bearing branch. Empty entities must remain discoverable without incorrect task matches or regression of existing filters.

**Planning reference.** Confirm the implementation owner during phase discovery after checking existing F025 dashboard/search responsibilities.

## Maintaining this register

1. Append a stable entry ID for each newly discovered bug or improvement. Keep prior IDs and useful resolution history.
2. Record the concrete problem, expected behaviour, verification criteria and relevant modules/contracts. Label a user report, source inspection and reproduced behaviour accurately.
3. Check existing entries and canonical owners before adding duplicate work. Link an implementation task when its scope is discussed; keep task status and priorities in the planner.
4. When decisions change, review related entries and affected canonical contracts using AB-IMP-001. Update this document with the agreed correction rather than leaving contradictory instructions.
5. When resolved, retain the entry and add the owning task, actual verification evidence and release/revision when known. Recording a fix or passing an unrelated test does not establish resolution.
