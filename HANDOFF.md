# Handoff — agent-plan development

Created at: 2026-06-29T00:00:00.000Z
Updated at: 2026-06-29T00:00:00.000Z
Reason: end of long work session, context compacting

## Current focus
- Project: `agent-plan` — modular project-scoped planning platform
- Repo: `/Users/antonio/projects/agent-plan` (pnpm workspace monorepo)
- Phase: dashboard Work Tree UX + status rollup integrity + handoff system
- Task: handoff system + phase ID migration feature-scoped — DONE (built, not yet runtime-validated)

## What was being done
This session delivered four major pieces of work on the agent-plan platform:

1. **Status rollup auto-sync**: added `PlanStore.enableAutoSync()` + `maybeAutoSync()` so every
   `saveProject/saveFeatures/savePhase` triggers `syncStatuses()`. The pi-adapter enables autoSync.
   Also added `maybeHealStatuses()` self-heal on session_start, requirePlan, before_agent_start, and
   server bootstrap — so stale/legacy persisted statuses get recomputed on open. Fixed the rollup
   logic itself: `planned` tasks no longer count as "active", so a phase with all-planned tasks stays
   `planned` instead of becoming `in-progress` (this was the Integration Testing bug).

2. **Dashboard Work Tree overhaul** (`packages/plan-web-ui/src/routes/dashboard/route.tsx`):
   - removed "Feature distribution" and "Current activities" sections
   - Work Tree is the primary view: collapsible feature → phase → task with explicit chevron toggles
     (click chevron = expand, click title = navigate)
   - filters: feature/phase/task status chips, Hide done, Hide planned, Only active branches
   - persistence via localStorage: showAllFeatures, treeOpenMode, expanded feature/phase ids, all filters
   - animated pulsing dot on features/phases/tasks with in-progress children
   - feature ordering by feature id number (not active-first, which wrongly promoted Final Polish)
   - "active" definition tightened: only in-progress/discovery phase or in-progress task counts
   - new "Latest completed tasks" section (top 3, by completedAt with updatedAt fallback)
   - task lifecycle timestamps `startedAt`/`completedAt` added to schema + valued on create/update
     in server, adapter tool, and adapter interactive command

3. **Handoff system** (`.planner/HANDOFF.md` canonical):
   - core: `PlanStore.handoffExists/loadHandoff/saveHandoff/deleteHandoff`
   - server: `GET/DELETE /api/handoff`
   - UI: Handoff button in header (visible only if file exists) + `/handoff` page
   - adapter: auto-write on session_before_switch / session_before_compact / session_shutdown;
     auto-read + inject into system prompt on before_agent_start; notify on session_start
   - commands/tools: `/planner handoff prepare|show|write|clear`, `planner-handoff` flat alias,
     `plan_get_handoff` / `plan_write_handoff` / `plan_delete_handoff` tools
   - `/planner handoff prepare` instructs the agent to write a full structured handoff

4. **Phase ID modeling fix** (architectural, reported by tester):
   - phase IDs were local-numbered in a global namespace → collisions + dangling refs
   - `createPhaseId(featureId, number, slug)` now produces feature-scoped ids:
     `feature-005-ui-menus-audio-phase-02-main-menu-pause-menu-settings`
   - schema regexes made permissive (accept legacy + feature-scoped)
   - `PlanStore.migratePhaseIds()` infers missing featureId from refs, renames files, updates
     task.phaseId, repairs feature.phaseIds (replace legacy refs, drop dangling)
   - `PlanStore.validateIntegrity()` reports duplicate + dangling phase ids
   - `syncStatuses()` runs migratePhaseIds() first → auto-migration on self-heal
   - all 3 callers updated (server, adapter tool, adapter interactive) with local feature number
   - validated on agent-plan-test2: 4 phases renamed, 12 dangling refs pruned, integrity clean

## Files touched
- `packages/plan-core/src/schema.ts` — governance fields on Feature/Phase, task startedAt/completedAt, permissive regexes
- `packages/plan-core/src/plan-store.ts` — autoSync, self-heal, migratePhaseIds, validateIntegrity, handoff methods, syncStatuses rollup fix
- `packages/plan-core/src/naming.ts` — createPhaseId(featureId,...), isLegacyPhaseId
- `packages/plan-server/src/serve.ts` — governance gates, task lifecycle dates, handoff endpoints, local phase number
- `packages/pi-adapter/src/index.ts` — autoSync enable, self-heal, handoff auto hooks + tools + commands, phase create feature-scoped, applyTaskLifecycleDates
- `packages/plan-web-ui/src/routes/dashboard/route.tsx` — full Work Tree rewrite, filters, persistence, latest completed tasks
- `packages/plan-web-ui/src/app/root.tsx`, `components/layout/top-nav.tsx`, `app-shell.tsx` — handoff button
- `packages/plan-web-ui/src/routes/handoff.route.tsx` — NEW handoff page
- `packages/plan-web-ui/src/lib/api.ts`, `lib/types.ts` — handoff API/types, task lifecycle fields

## Blockers
- **Full Pi restart required** to load new plan-core/plan-server/pi-adapter dist. `/planner-web stop/start`
  is NOT enough (adapter statically imports @agent-plan/server/serve; Node caches it for the Pi process).
- Runtime validation of everything built this session is blocked until that restart happens.

## Next steps
1. Perform a full Pi restart
2. Have the tester (subagent-chat-019f1576 in /Users/antonio/projects/agent-plan-test2) run post-restart checks:
   - A. status rollup coherence (feature/phase/task derived correctly)
   - B. phase ID migration visible (feature-scoped ids in UI + files)
   - C. handoff auto-write on compact/switch/shutdown + auto-read on start + header button + /handoff page
   - D. `/planner handoff prepare` instructs the agent correctly
3. UI polish: add a delete button on the /handoff page; add a "cleanup orphan phases" command
4. Add a dedicated `feature discuss` flow (governance metadata is set but no interactive discuss command exists for features, only phases)
5. Clean legacy Italian workflow rules still stored in existing .planner/project.json files (agent-plan-test2)
6. Improve `readJson`/PlanStoreError diagnostics to surface schema validation cause instead of only "read failed: <path>"
7. Decide whether the project short description needs an editor now that `project discuss` no longer asks for it

## Recent decisions
- Tasks may proceed without a dedicated discuss; features and phases must be discussed unless the agent has full context (then an explicit contextReady bypass is allowed)
- Feature/phase in-progress is hard-gated server-side on governance readiness (discussedAt OR contextReady+reason)
- Phase IDs are feature-scoped; local ordinal lives only in `phase.number`
- Handoff canonical path is `.planner/HANDOFF.md`, never `.pi/`
- Work Tree replaces Feature distribution + Current activities as the dashboard primary view
- `show active only` means only features with in-progress phase/task (not just planned)

## Reminder
- When the work is fully resumed and this handoff is no longer needed, delete `HANDOFF.md`.
- All built changes need a full Pi restart before they take effect in the running extension.