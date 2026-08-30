# Planner runtime boundaries: shared vs worktree-local

This document defines the boundary between **canonical, shared, mergeable
planner state** and **volatile, worktree-local runtime/session state** in
`@agent-plan/core`. It is the authoritative reference for the invariants that
the Pi adapter, the MCP server, the plan server, and the Web UI must rely on
when reading or writing planner data.

The driving requirement (P069/F005): when the same planner is consumed from
multiple git worktrees, branches, or cloned folders, work on one
feature/phase must not create *avoidable* conflicts for another worktree, while
canonical planner data (features, phases, tasks, requirements) stays shared and
mergeable.

## Principle

> Canonical planner data lives in `.planner/` and is shared + mergeable.
> Volatile runtime/session state lives in `.planner/.local/` and is
> worktree-local, git-ignored, and never merged.

Two worktrees that share the same canonical `.planner/` but have **separate
`.local/`** directories therefore share planning data without sharing runtime
state. This is exactly what Git worktrees already provide for the working
tree; the planner mirrors that split for its own state.

## Shared, mergeable state (`.planner/`)

| Path | Holds | Why shared |
| --- | --- | --- |
| `manifest.json` | Global id → ref index (features/phases/tasks) | Single source of composite/shortId resolution across the whole project |
| `project.json` | Name, goal, description, scope, decisions, `globalRules`, `workflowRules`, `acceptedDecisions`, languages, `technologies`, `tools`, and the monotonic counters `nextFeatureNumber` / `nextPhaseNumber` / `nextTaskNumber` | Canonical project metadata + the global numbering sequence; must be identical in every worktree or numbering collides |
| `features/<id>.json` | Feature documents | Canonical work data |
| `phases/<id>.json` | Phase documents (with their tasks) | Canonical work data |
| `tasks/<id>.json` | Task documents | Canonical work data |
| `requirements.json` | Top-level requirements | Canonical work data |
| `ideas.json` | Top-level Ideas Inbox, its independent `nextIdeaNumber`, and promotion links | Canonical discovery history; intentionally excluded from work status derivation and selection |
| `handoffs/` | Active, entity-scoped phase handoffs | Canonical (a handoff is a first-class planner entity) |
| `rules.json` | Static extension-rule strings (no timestamps) | Canonical, identical across worktrees; timestamp-free so it never drifts |

**`project.json` is intentionally free of runtime state.** The
`workDeviations` field is always `[]` / absent on disk: runtime deviations are
stored in `.local/deviations.json` (see below) and only *merged into a read
view* by `loadProject()`. `saveProject()` strips `workDeviations` so shared
`project.json` stays stable across worktrees (T299).

## Worktree-local state (`.planner/.local/`, git-ignored)

| Path | Holds | Why local |
| --- | --- | --- |
| `deviations.json` | Ordered history of approved temporary-work deviations; the active entries form the resumable stack and the `resume-required` markers | Pure runtime/session state — must not be shared or it would force one worktree's "resume X" onto another |
| `resume.json` | Per-session resume focus + machine-local guard-bypass flag | Per-session, machine-specific; never meaningful to another worktree |
| `activity.json` | Local activity context (recent actions) | Volatile session bookkeeping |
| `timestamp.json` | `touchTimestamp` audit stamp | Local write-cache timestamp |
| `generated/` | Generated output (e.g. codebase maps) | Derived/transient, regenerable |
| `backups/` | Atomic-write `.bak` crash-recovery copies | Transient safety copies |
| `tmp/` | Scratch space | Transient |
| `handoff-archive/` | Archived handoffs (auto-archived on terminal-phase completion) | Local history; keeps active `handoffs/` clean |

## Invariants (adapters & UI rely on these)

1. **Canonical status is the sole source of truth.** A task's/phase's/feature's
   `status` lives in its canonical file. Resume markers are *derived*, never
   persisted into canonical files.
2. **`loadProject().workDeviations` is a merged read-view.** It combines the
   (empty) canonical `workDeviations` with `.local/deviations.json`. Writers
   MUST go through `addWorkDeviation` / `setWorkDeviationState` /
   `pruneObsoleteWorkDeviations` (which read/write `.local`), never through
   `saveProject`/`updateProject`. `saveProject` strips `workDeviations` by
   design.
3. **`resume-required` is derived at read time.** `getTaskFocus().pendingResume`
   is computed from `loadProject().workDeviations` filtered to
   `state === "resume-required"` whose `resumeTaskId` still matches a task in
   `planned` / `waiting` / `in-progress`. A `resume-required` deviation whose
   target task is `done` is correctly excluded (the resume is moot).
4. **Counters stay shared.** `nextFeatureNumber` / `nextPhaseNumber` /
   `nextTaskNumber` live in `project.json`; the independent `nextIdeaNumber`
   lives in `ideas.json`. All are monotonically increasing, never-reused
   sequences, with the cross-worktree allocation registry preventing local
   clone collisions. Localizing canonical counters would cause numbering
   collisions — do not move them to `.local`.
5. **`resume.json` / `activity.json` are machine-local.** They may differ per
   worktree/session with no conflict. Treat them as ephemeral session hints.
6. **Handoff archive is local.** Terminal-phase auto-archive writes to
   `.local/handoff-archive/`, so active `handoffs/` stays canonical and
   conflict-free.
7. **Read-view merge is the integration contract.** Every harness surfaces
   resume awareness via the *same* `loadProject()` + `getTaskFocus()` read path
   (`recap.ts` `buildRecap` for Pi/MCP, `serve.ts` `/tasks/focus` for the Web
   UI, `task-selection.ts` `recommendNextTask` for the guard). No harness
   invents its own resume source.
8. **Proposing resume is advisory, not blocking.** Every recap/task-entry flow
   proposes outstanding resume-required work explicitly (T296) but honors an
   explicit start of a different task. The proposal is standardized via
   `buildResumeRequiredProposal` so Pi, MCP, and Web UI present it identically.

## Cross-worktree isolation

Cloning the canonical `.planner/` into a second worktree while *excluding*
`.local/` yields a second planner whose runtime state is empty and independent.
Each worktree then owns its own `deviations.json` / `resume.json` /
`activity.json` without affecting the other, while sharing all canonical
features/phases/tasks/requirements/ideas. This is covered by the T297 isolation test
(`resume-protocol-isolation.test.mjs`).

## Open items / known couplings

- **`webPort` (in `project.json`)** is shared by convenience. Two worktrees
  each running their own planner/Web UI server may want different ports; this
  is *not* a merge-conflict source (ports are not merged) but a known minor
  coupling. It can be localized later if per-worktree port preferences are
  needed.
- **Entity `createdAt` / `updatedAt`** timestamps are part of canonical data
  and are shared. Concurrent edits to the same canonical entity from different
  worktrees can still conflict — that is inherent to shared canonical data, not
  runtime state, and is out of scope for this boundary.
