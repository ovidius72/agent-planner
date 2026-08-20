/**
 * Public-surface inventory for Agent Plan (F015 — Integration Test & Cross-Harness Verification).
 *
 * This module is the single, test-owned inventory of every public surface that
 * must be exercised by the scenario matrix (./scenario-matrix.mjs) and by the
 * API / MCP / Pi / UI runners built in P053–P059. It is pure data: no imports,
 * no side effects, no file reads. File:line references are kept as source anchors
 * (they may drift; the runner uses the stable `id`).
 *
 * Surfaces are grouped by harness boundary:
 *   - core : PlanStore methods + pure helper modules (@agent-plan/core)
 *   - api  : HTTP routes served by packages/plan-server/src/serve.ts
 *   - mcp  : MCP tools registered in packages/plan-mcp/src/index.ts
 *   - pi   : Pi extension commands/tools/hooks in packages/pi-adapter/src/index.ts
 *   - ui   : Web UI route loaders/actions + api client + key components
 */

/** @typedef {{
 *   id: string;
 *   kind: string;
 *   name: string;
 *   description: string;
 *   anchor: string;
 *   coverage?: {
 *     phase: string;   // P0xx phase that will exercise this surface (required when no scenario references it)
 *     reason: string;  // why the surface is deferred to that phase
 *   };
 * }} SurfaceEntry
 */

/**
 * PlanStore (class PlanStore, packages/plan-core/src/plan-store.ts) + core helpers.
 * @type {SurfaceEntry[]}
 */
export const coreSurfaces = [
  // ── Bootstrap / project ────────────────────────────────────────────
  { id: "core.init", kind: "method", name: "PlanStore.init", description: "Create a fresh .planner/ workspace (manifest, project.json, features.json, requirements.json, gitignore).", anchor: "packages/plan-core/src/plan-store.ts:853" },
  { id: "core.ensureGitignore", kind: "method", name: "PlanStore.ensureGitignore", description: "Write .planner/.gitignore transient exclusions.", anchor: "packages/plan-core/src/plan-store.ts:948", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },
  { id: "core.exists", kind: "method", name: "PlanStore.exists", description: "True when .planner/ manifest exists.", anchor: "packages/plan-core/src/plan-store.ts:965" },
  { id: "core.loadManifest", kind: "method", name: "PlanStore.loadManifest", description: "Load manifest.json.", anchor: "packages/plan-core/src/plan-store.ts:976" },
  { id: "core.loadProject", kind: "method", name: "PlanStore.loadProject", description: "Load project.json.", anchor: "packages/plan-core/src/plan-store.ts:997" },
  { id: "core.updateProject", kind: "method", name: "PlanStore.updateProject", description: "Apply a mutator to project.json (atomic write).", anchor: "packages/plan-core/src/plan-store.ts:1764" },
  { id: "core.saveProject", kind: "method", name: "PlanStore.saveProject", description: "Persist a full project document.", anchor: "packages/plan-core/src/plan-store.ts:1788", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },
  { id: "core.allocFeatureNumber", kind: "method", name: "PlanStore.allocFeatureNumber", description: "Allocate next global feature number.", anchor: "packages/plan-core/src/plan-store.ts:1009", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },
  { id: "core.allocPhaseNumber", kind: "method", name: "PlanStore.allocPhaseNumber", description: "Allocate next global phase number.", anchor: "packages/plan-core/src/plan-store.ts:1010", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },
  { id: "core.allocTaskNumber", kind: "method", name: "PlanStore.allocTaskNumber", description: "Allocate next global task number.", anchor: "packages/plan-core/src/plan-store.ts:1011", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },

  // ── Reads ──────────────────────────────────────────────────────────
  { id: "core.loadFeatures", kind: "method", name: "PlanStore.loadFeatures", description: "Load features.json document.", anchor: "packages/plan-core/src/plan-store.ts:1096" },
  { id: "core.loadPhase", kind: "method", name: "PlanStore.loadPhase", description: "Load a single phase by id; throws when missing.", anchor: "packages/plan-core/src/plan-store.ts:1050", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },
  { id: "core.loadAllPhases", kind: "method", name: "PlanStore.loadAllPhases", description: "Load every phase file.", anchor: "packages/plan-core/src/plan-store.ts:1262", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },
  { id: "core.loadAll", kind: "method", name: "PlanStore.loadAll", description: "Load whole workspace (project + features + phases).", anchor: "packages/plan-core/src/plan-store.ts:1307", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },
  { id: "core.loadWorkspace", kind: "method", name: "PlanStore.loadWorkspace", description: "Alias of loadAll.", anchor: "packages/plan-core/src/plan-store.ts:2132", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },
  { id: "core.loadRequirements", kind: "method", name: "PlanStore.loadRequirements", description: "Load requirements.json document.", anchor: "packages/plan-core/src/plan-store.ts:1230" },
  { id: "core.linkedRequirementsForPhase", kind: "method", name: "PlanStore.linkedRequirementsForPhase", description: "Requirements whose linkedPhaseIds include the phase.", anchor: "packages/plan-core/src/plan-store.ts:1238" },
  { id: "core.loadPhaseWithRequirements", kind: "method", name: "PlanStore.loadPhaseWithRequirements", description: "Phase enriched with linkedRequirements.", anchor: "packages/plan-core/src/plan-store.ts:1243" },
  { id: "core.loadAllPhasesWithRequirements", kind: "method", name: "PlanStore.loadAllPhasesWithRequirements", description: "All phases enriched with linked requirements.", anchor: "packages/plan-core/src/plan-store.ts:1251", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },
  { id: "core.loadPhaseDisplay", kind: "method", name: "PlanStore.loadPhaseDisplay", description: "Derived parent display (status breakdown) for a phase.", anchor: "packages/plan-core/src/plan-store.ts:1290", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },
  { id: "core.loadFeatureDisplay", kind: "method", name: "PlanStore.loadFeatureDisplay", description: "Derived parent display for a feature.", anchor: "packages/plan-core/src/plan-store.ts:1299", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },
  { id: "core.loadCodebaseProfile", kind: "method", name: "PlanStore.loadCodebaseProfile", description: "Load codebase profile or null.", anchor: "packages/plan-core/src/plan-store.ts:1103", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },
  { id: "core.saveCodebaseProfile", kind: "method", name: "PlanStore.saveCodebaseProfile", description: "Persist codebase profile.", anchor: "packages/plan-core/src/plan-store.ts:1111", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },
  { id: "core.loadActivityLog", kind: "method", name: "PlanStore.loadActivityLog", description: "Load activity log entries.", anchor: "packages/plan-core/src/plan-store.ts:1186", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },
  { id: "core.appendActivity", kind: "method", name: "PlanStore.appendActivity", description: "Append an activity entry (type/ref/summary).", anchor: "packages/plan-core/src/plan-store.ts:1195", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },

  // ── Writes (atomic) ────────────────────────────────────────────────
  { id: "core.saveFeature", kind: "method", name: "PlanStore.saveFeature", description: "Persist/append a feature (atomic write).", anchor: "packages/plan-core/src/plan-store.ts:1828" },
  { id: "core.updateFeatures", kind: "method", name: "PlanStore.updateFeatures", description: "Apply a mutator to features.json.", anchor: "packages/plan-core/src/plan-store.ts:1770" },
  { id: "core.saveFeatures", kind: "method", name: "PlanStore.saveFeatures", description: "Persist a full features document.", anchor: "packages/plan-core/src/plan-store.ts:1795" },
  { id: "core.updatePhase", kind: "method", name: "PlanStore.updatePhase", description: "Apply a mutator to a phase file (atomic).", anchor: "packages/plan-core/src/plan-store.ts:1873" },
  { id: "core.savePhase", kind: "method", name: "PlanStore.savePhase", description: "Persist a phase file.", anchor: "packages/plan-core/src/plan-store.ts:1873", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },
  { id: "core.deletePhase", kind: "method", name: "PlanStore.deletePhase", description: "Delete a phase file and unlink from its feature.", anchor: "packages/plan-core/src/plan-store.ts:2120", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },
  { id: "core.updateRequirements", kind: "method", name: "PlanStore.updateRequirements", description: "Apply a mutator to requirements.json.", anchor: "packages/plan-core/src/plan-store.ts:1782" },
  { id: "core.saveRequirements", kind: "method", name: "PlanStore.saveRequirements", description: "Persist requirements document.", anchor: "packages/plan-core/src/plan-store.ts:1839" },

  // ── Sequencing / ordering ──────────────────────────────────────────
  { id: "core.ensureStructureOrdering", kind: "method", name: "PlanStore.ensureStructureOrdering", description: "Order features/phases/tasks by number/priority.", anchor: "packages/plan-core/src/plan-store.ts:673", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },
  { id: "core.rebuildContainment", kind: "method", name: "PlanStore.rebuildContainment", description: "Rebuild phase containment from task.phaseId.", anchor: "packages/plan-core/src/plan-store.ts:698" },
  { id: "core.ensureShortIdsAndPriority", kind: "method", name: "PlanStore.ensureShortIdsAndPriority", description: "Backfill missing shortIds + priorities (idempotent).", anchor: "packages/plan-core/src/plan-store.ts:1461", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },
  { id: "core.nextPriority", kind: "method", name: "PlanStore.nextPriority", description: "Next display priority for a kind within parent.", anchor: "packages/plan-core/src/plan-store.ts:1439" },
  { id: "core.assignedShortIds", kind: "method", name: "PlanStore.assignedShortIds", description: "Set of shortIds already assigned.", anchor: "packages/plan-core/src/plan-store.ts:1423", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },

  // ── Lifecycle / rollup ─────────────────────────────────────────────
  { id: "core.syncStatuses", kind: "method", name: "PlanStore.syncStatuses", description: "Derive phase+feature status from tasks; persists; returns changed refs.", anchor: "packages/plan-core/src/plan-store.ts:1685" },
  { id: "core.syncTaskStatusRollup", kind: "method", name: "PlanStore.syncTaskStatusRollup", description: "Roll one phase status up from its tasks.", anchor: "packages/plan-core/src/plan-store.ts:1696" },
  { id: "core.enableAutoSync", kind: "method", name: "PlanStore.enableAutoSync", description: "Toggle automatic status sync on writes.", anchor: "packages/plan-core/src/plan-store.ts:552", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },
  { id: "core.runBatch", kind: "method", name: "PlanStore.runBatch", description: "Suspend auto-sync/notify across a batch of writes.", anchor: "packages/plan-core/src/plan-store.ts:552", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },

  // ── Integrity / repair ─────────────────────────────────────────────
  { id: "core.validateIntegrity", kind: "method", name: "PlanStore.validateIntegrity", description: "Report duplicate/dangling phase ids + duplicate shortIds.", anchor: "packages/plan-core/src/plan-store.ts:1599" },
  { id: "core.repair", kind: "method", name: "PlanStore.repair", description: "Repair dangling refs, shortIds, containment; returns report.", anchor: "packages/plan-core/src/plan-store.ts:1553" },
  { id: "core.listOrphanPhases", kind: "method", name: "PlanStore.listOrphanPhases", description: "Phase files whose feature no longer resolves.", anchor: "packages/plan-core/src/plan-store.ts:2073" },
  { id: "core.cleanupOrphanPhases", kind: "method", name: "PlanStore.cleanupOrphanPhases", description: "Delete orphan phase files; returns found+removed.", anchor: "packages/plan-core/src/plan-store.ts:2096" },
  { id: "core.cleanupOrphanBackups", kind: "method", name: "PlanStore.cleanupOrphanBackups", description: "Remove stale .bak backups.", anchor: "packages/plan-core/src/plan-store.ts:1395", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },
  { id: "core.migratePhaseIds", kind: "method", name: "PlanStore.migratePhaseIds", description: "Legacy phase-id migration (renamed/repaired/inferred).", anchor: "packages/plan-core/src/plan-store.ts:1322", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },

  // ── Handoff (entity-scoped) ────────────────────────────────────────
  { id: "core.getPhaseHandoff", kind: "method", name: "PlanStore.getPhaseHandoff", description: "Read phase.handoff content.", anchor: "packages/plan-core/src/plan-store.ts:1901" },
  { id: "core.setPhaseHandoff", kind: "method", name: "PlanStore.setPhaseHandoff", description: "Write phase.handoff + handoffUpdatedAt.", anchor: "packages/plan-core/src/plan-store.ts:1908" },
  { id: "core.clearPhaseHandoff", kind: "method", name: "PlanStore.clearPhaseHandoff", description: "Clear phase.handoff, archive copy to .local/handoff-archive/, keep audit timestamps.", anchor: "packages/plan-core/src/plan-store.ts:1969" },
  { id: "core.markHandoffRead", kind: "method", name: "PlanStore.markHandoffRead", description: "Set phase.handoffReadAt.", anchor: "packages/plan-core/src/plan-store.ts:1925", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },
  { id: "core.listHandoffs", kind: "method", name: "PlanStore.listHandoffs", description: "Phases with non-empty handoff (composite ref, first line, updatedAt).", anchor: "packages/plan-core/src/plan-store.ts:2016" },
  { id: "core.listArchivedHandoffs", kind: "method", name: "PlanStore.listArchivedHandoffs", description: "Archived handoffs (all phase tasks done/canceled, replacement, or manual clear).", anchor: "packages/plan-core/src/plan-store.ts:2044" },
  { id: "core.cleanupStaleHandoffs", kind: "method", name: "PlanStore.cleanupStaleHandoffs", description: "Auto-archive handoffs when every phase task is done/canceled.", anchor: "packages/plan-core/src/plan-store.ts:2008" },
  { id: "core.importLegacyHandoffFile", kind: "method", name: "PlanStore.importLegacyHandoffFile", description: "One-time import of deprecated .planner/HANDOFF.md.", anchor: "packages/plan-core/src/plan-store.ts:1936", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },

  // ── Resume / guard ─────────────────────────────────────────────────
  { id: "core.loadResume", kind: "method", name: "PlanStore.loadResume", description: "Load resume focus or null.", anchor: "packages/plan-core/src/plan-store.ts:1117" },
  { id: "core.saveResume", kind: "method", name: "PlanStore.saveResume", description: "Persist resume focus.", anchor: "packages/plan-core/src/plan-store.ts:1126" },
  { id: "core.refreshResume", kind: "method", name: "PlanStore.refreshResume", description: "Rebuild resume focus from current state (notes + summary).", anchor: "packages/plan-core/src/plan-store.ts:1209" },
  { id: "core.authorizeGuardBypass", kind: "method", name: "PlanStore.authorizeGuardBypass", description: "Persist a guard bypass window.", anchor: "packages/plan-core/src/plan-store.ts:1149", coverage: { phase: "P056", reason: "covered by Pi adapter guard-bypass lifecycle scenarios (P056)" } },
  { id: "core.clearGuardBypass", kind: "method", name: "PlanStore.clearGuardBypass", description: "Revoke guard bypass.", anchor: "packages/plan-core/src/plan-store.ts:1169", coverage: { phase: "P056", reason: "covered by Pi adapter guard-bypass lifecycle scenarios (P056)" } },
  { id: "core.isGuardBypassed", kind: "method", name: "PlanStore.isGuardBypassed", description: "Whether a bypass window is active.", anchor: "packages/plan-core/src/plan-store.ts:1178", coverage: { phase: "P056", reason: "covered by Pi adapter guard-bypass lifecycle scenarios (P056)" } },

  // ── Generated views / exports ──────────────────────────────────────
  { id: "core.writeGenerated", kind: "method", name: "PlanStore.writeGenerated", description: "Regenerate markdown views under .planner/.local/generated/.", anchor: "packages/plan-core/src/plan-store.ts:2145", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },
  { id: "core.renderer", kind: "module", name: "PlanRenderer", description: "Markdown rendering of the plan (renderer.ts).", anchor: "packages/plan-core/src/renderer.ts:20", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },
  { id: "core.exportService", kind: "module", name: "ExportService", description: "Markdown export of the whole plan (export-service.ts).", anchor: "packages/plan-core/src/export-service.ts:32", coverage: { phase: "P054", reason: "covered via the API export endpoint scenarios (P054)" } },
  { id: "core.buildRecap", kind: "function", name: "buildRecap", description: "Harness-agnostic recap text (pi | mcp).", anchor: "packages/plan-core/src/recap.ts:39" },
  { id: "core.buildPhaseContextBlock", kind: "function", name: "buildPhaseContextBlock", description: "Phase context injection block.", anchor: "packages/plan-core/src/task-context.ts:17", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },
  { id: "core.packageVersion", kind: "module", name: "package-version.ts", description: "Resolve package versions from the manifests of modules actually loaded by a harness.", anchor: "packages/plan-core/src/package-version.ts", coverage: { phase: "P059", reason: "Runtime version normalization is covered by the cross-harness contract matrix (P059)." } },

  // ── Pure helpers ───────────────────────────────────────────────────
  { id: "core.naming", kind: "module", name: "naming.ts", description: "createFeatureId/PhaseId/TaskId/RequirementId, shortIds, slugs, ref formatters, isUuid, validateResolvedTarget.", anchor: "packages/plan-core/src/naming.ts" },
  { id: "core.refs", kind: "module", name: "refs.ts", description: "findPhaseByRef / findTaskByRef (composite P00x, shortId, UUID, title).", anchor: "packages/plan-core/src/refs.ts" },
  { id: "core.checklist", kind: "module", name: "checklist.ts", description: "find/add/remove/toggle checklist items with C{n} selectors.", anchor: "packages/plan-core/src/checklist.ts" },
  { id: "core.displayStatus", kind: "module", name: "display-status.ts", description: "countBreakdown / deriveParentDisplay / toWorkflowStatus / fromCanonicalStatus.", anchor: "packages/plan-core/src/display-status.ts" },
  { id: "core.schema", kind: "module", name: "schema.ts", description: "Zod schemas for Feature/Phase/Task/Project/Manifest + needsMotivation.", anchor: "packages/plan-core/src/schema.ts:149", coverage: { phase: "P053", reason: "covered by core domain validation scenarios (P053)" } },
  { id: "core.needsMotivation", kind: "function", name: "needsMotivation", description: "True when a status transition requires a motivation note.", anchor: "packages/plan-core/src/schema.ts:149" },
];

/**
 * HTTP API routes (packages/plan-server/src/serve.ts — createApiApp).
 * @type {SurfaceEntry[]}
 */
export const apiSurfaces = [
  { id: "api.health", kind: "route", name: "GET /api/health", description: "Server liveness + plan root.", anchor: "packages/plan-server/src/serve.ts:914" },
  { id: "api.uiConfig", kind: "route", name: "GET /api/ui-config", description: "UI runtime config (shortcuts, server urls).", anchor: "packages/plan-server/src/serve.ts:915", coverage: { phase: "P054", reason: "covered by HTTP server integration scenarios (P054)" } },
  { id: "api.internalNotify", kind: "route", name: "POST /api/internal/notify", description: "Cross-process live-update ping.", anchor: "packages/plan-server/src/serve.ts:170", coverage: { phase: "P054", reason: "covered by HTTP server integration scenarios (P054)" } },
  { id: "api.export", kind: "route", name: "GET /api/export?full=", description: "Markdown export (writes EXPORT.md).", anchor: "packages/plan-server/src/serve.ts:190", coverage: { phase: "P054", reason: "covered by HTTP server integration scenarios (P054)" } },
  { id: "api.getProject", kind: "route", name: "GET /api/project", description: "Project document + planRoot/projectRoot.", anchor: "packages/plan-server/src/serve.ts:202" },
  { id: "api.updateProject", kind: "route", name: "PUT /api/project", description: "Replace project document.", anchor: "packages/plan-server/src/serve.ts:211" },
  { id: "api.getRequirements", kind: "route", name: "GET /api/requirements", description: "Requirements document.", anchor: "packages/plan-server/src/serve.ts:221", coverage: { phase: "P054", reason: "covered by HTTP server integration scenarios (P054)" } },
  { id: "api.createRequirement", kind: "route", name: "POST /api/requirements", description: "Create requirement (201).", anchor: "packages/plan-server/src/serve.ts:223" },
  { id: "api.updateRequirement", kind: "route", name: "PUT /api/requirements/:id", description: "Update requirement; 404 when missing.", anchor: "packages/plan-server/src/serve.ts:232" },
  { id: "api.deleteRequirement", kind: "route", name: "DELETE /api/requirements/:id", description: "Delete requirement; 404 when missing.", anchor: "packages/plan-server/src/serve.ts:250", coverage: { phase: "P054", reason: "covered by HTTP server integration scenarios (P054)" } },
  { id: "api.getFeatures", kind: "route", name: "GET /api/features", description: "All features.", anchor: "packages/plan-server/src/serve.ts:266" },
  { id: "api.createFeature", kind: "route", name: "POST /api/features", description: "Create feature; 400 when name missing.", anchor: "packages/plan-server/src/serve.ts:268" },
  { id: "api.getFeature", kind: "route", name: "GET /api/features/:id", description: "Single feature; 404 when missing.", anchor: "packages/plan-server/src/serve.ts:310" },
  { id: "api.updateFeature", kind: "route", name: "PUT /api/features/:id", description: "Update feature; 400 id mismatch / governance gate.", anchor: "packages/plan-server/src/serve.ts:318" },
  { id: "api.deleteFeature", kind: "route", name: "DELETE /api/features/:id", description: "Delete feature.", anchor: "packages/plan-server/src/serve.ts:343", coverage: { phase: "P054", reason: "covered by HTTP server integration scenarios (P054)" } },
  { id: "api.getPhases", kind: "route", name: "GET /api/phases?featureId=", description: "All phases (optionally filtered by feature) with linked requirements.", anchor: "packages/plan-server/src/serve.ts:357" },
  { id: "api.createPhase", kind: "route", name: "POST /api/phases", description: "Create phase; 400 missing title/featureId.", anchor: "packages/plan-server/src/serve.ts:364" },
  { id: "api.getPhase", kind: "route", name: "GET /api/phases/:id", description: "Phase with linked requirements; 404 when missing.", anchor: "packages/plan-server/src/serve.ts:452" },
  { id: "api.updatePhase", kind: "route", name: "PUT /api/phases/:id", description: "Update phase; governance gate on status.", anchor: "packages/plan-server/src/serve.ts:462" },
  { id: "api.deletePhase", kind: "route", name: "DELETE /api/phases/:id", description: "Delete phase + unlink from feature.", anchor: "packages/plan-server/src/serve.ts:484", coverage: { phase: "P054", reason: "covered by HTTP server integration scenarios (P054)" } },
  { id: "api.createTask", kind: "route", name: "POST /api/phases/:phaseId/tasks", description: "Create task; 400 missing title/phase.", anchor: "packages/plan-server/src/serve.ts:505" },
  { id: "api.getActiveTasks", kind: "route", name: "GET /api/tasks/active", description: "In-progress tasks with composite numbers.", anchor: "packages/plan-server/src/serve.ts:574", coverage: { phase: "P054", reason: "covered by HTTP server integration scenarios (P054)" } },
  { id: "api.getTaskFocus", kind: "route", name: "GET /api/tasks/focus", description: "Active and paused task summaries with pending-resume checkpoints.", anchor: "packages/plan-server/src/serve.ts:640", coverage: { phase: "P059", reason: "Suspension focus feed (F005/P066); registered in F015 cross-harness inventory, scenario deferred to P059." } },
  { id: "api.getTask", kind: "route", name: "GET /api/tasks/:id", description: "Single task; 404 when missing.", anchor: "packages/plan-server/src/serve.ts:607" },
  { id: "api.updateTask", kind: "route", name: "PUT /api/tasks/:id", description: "Update task; motivation + governance gates.", anchor: "packages/plan-server/src/serve.ts:617" },
  { id: "api.deleteTask", kind: "route", name: "DELETE /api/tasks/:id", description: "Delete task.", anchor: "packages/plan-server/src/serve.ts:701", coverage: { phase: "P054", reason: "covered by HTTP server integration scenarios (P054)" } },
  { id: "api.integrity", kind: "route", name: "GET /api/integrity", description: "Integrity report.", anchor: "packages/plan-server/src/serve.ts:723" },
  { id: "api.repair", kind: "route", name: "POST /api/repair", description: "Run repair.", anchor: "packages/plan-server/src/serve.ts:728" },
  { id: "api.reorder", kind: "route", name: "POST /api/reorder", description: "Reorder feature/phase/task by priority midpoint insert.", anchor: "packages/plan-server/src/serve.ts:737" },
  { id: "api.render", kind: "route", name: "POST /api/render", description: "Regenerate generated views.", anchor: "packages/plan-server/src/serve.ts:853", coverage: { phase: "P054", reason: "covered by HTTP server integration scenarios (P054)" } },
  { id: "api.listHandoffs", kind: "route", name: "GET /api/handoffs", description: "Pending entity-scoped handoffs.", anchor: "packages/plan-server/src/serve.ts:860" },
  { id: "api.listHandoffsArchive", kind: "route", name: "GET /api/handoffs/archive", description: "Archived handoffs.", anchor: "packages/plan-server/src/serve.ts:865" },
  { id: "api.getPhaseHandoff", kind: "route", name: "GET /api/phases/:id/handoff", description: "Phase handoff content + updatedAt.", anchor: "packages/plan-server/src/serve.ts:870", coverage: { phase: "P054", reason: "covered by HTTP server integration scenarios (P054)" } },
  { id: "api.setPhaseHandoff", kind: "route", name: "PUT /api/phases/:id/handoff", description: "Write handoff; empty content clears.", anchor: "packages/plan-server/src/serve.ts:879" },
  { id: "api.clearPhaseHandoff", kind: "route", name: "DELETE /api/phases/:id/handoff", description: "Clear handoff (archives).", anchor: "packages/plan-server/src/serve.ts:901" },
  { id: "api.busy", kind: "route", name: "GET/other when isBusy", description: "503 on reads / 409 on mutations while plan busy.", anchor: "packages/plan-server/src/serve.ts:156", coverage: { phase: "P054", reason: "covered by HTTP server integration scenarios (P054)" } },
  { id: "api.spa", kind: "route", name: "GET /* static", description: "SPA static serving with index.html fallback.", anchor: "packages/plan-server/src/serve.ts:962" },
  { id: "api.ws", kind: "route", name: "WS /ws", description: "WebSocket hub: connected/ping-pong/file-changed/plan-rendered events.", anchor: "packages/plan-server/src/ws-hub.ts:24", coverage: { phase: "P054", reason: "covered by HTTP server integration scenarios (P054)" } },
];

/**
 * MCP tools (packages/plan-mcp/src/index.ts).
 * @type {SurfaceEntry[]}
 */
export const mcpSurfaces = [
  { id: "mcp.version", kind: "tool", name: "planner-version", description: "Report the loaded MCP and core package versions without requiring a planner workspace.", anchor: "packages/plan-mcp/src/index.ts:164", coverage: { phase: "P059", reason: "Version parity across Claude and Codex uses the cross-harness contract matrix (P059)." } },
  { id: "mcp.init", kind: "tool", name: "planner-init", description: "Initialize .planner/ in AGENT_PLAN_ROOT or cwd.", anchor: "packages/plan-mcp/src/index.ts:205" },
  { id: "mcp.show", kind: "tool", name: "planner-show", description: "Overview recap of the plan.", anchor: "packages/plan-mcp/src/index.ts:223", coverage: { phase: "P055", reason: "covered by MCP adapter scenarios (P055)" } },
  { id: "mcp.repair", kind: "tool", name: "planner-repair", description: "Repair plan integrity.", anchor: "packages/plan-mcp/src/index.ts:263", coverage: { phase: "P055", reason: "covered by MCP adapter scenarios (P055)" } },
  { id: "mcp.cleanupOrphanPhases", kind: "tool", name: "planner-cleanup-orphan-phases", description: "List/delete orphan phase files.", anchor: "packages/plan-mcp/src/index.ts:271" },
  { id: "mcp.export", kind: "tool", name: "planner-export", description: "Markdown export.", anchor: "packages/plan-mcp/src/index.ts:168", coverage: { phase: "P055", reason: "covered by MCP adapter scenarios (P055)" } },
  { id: "mcp.authorizeBypass", kind: "tool", name: "planner-authorize-bypass", description: "Guard bypass window.", anchor: "packages/plan-mcp/src/index.ts:185", coverage: { phase: "P055", reason: "covered by MCP adapter scenarios (P055)" } },
  { id: "mcp.clearBypass", kind: "tool", name: "planner-clear-bypass", description: "Revoke guard bypass.", anchor: "packages/plan-mcp/src/index.ts:197", coverage: { phase: "P055", reason: "covered by MCP adapter scenarios (P055)" } },
  { id: "mcp.projectLanguage", kind: "tool", name: "planner-project-language", description: "Persist language preferences.", anchor: "packages/plan-mcp/src/index.ts:297", coverage: { phase: "P055", reason: "covered by MCP adapter scenarios (P055)" } },
  { id: "mcp.projectDiscuss", kind: "tool", name: "planner-project-discuss", description: "Project discovery.", anchor: "packages/plan-mcp/src/index.ts:312", coverage: { phase: "P055", reason: "covered by MCP adapter scenarios (P055)" } },
  { id: "mcp.featureList", kind: "tool", name: "planner-feature-list", description: "Compact feature list.", anchor: "packages/plan-mcp/src/index.ts:337", coverage: { phase: "P055", reason: "covered by MCP adapter scenarios (P055)" } },
  { id: "mcp.phaseList", kind: "tool", name: "planner-phase-list", description: "Compact phase list.", anchor: "packages/plan-mcp/src/index.ts:353", coverage: { phase: "P055", reason: "covered by MCP adapter scenarios (P055)" } },
  { id: "mcp.taskList", kind: "tool", name: "planner-task-list", description: "Compact task list.", anchor: "packages/plan-mcp/src/index.ts:374", coverage: { phase: "P055", reason: "covered by MCP adapter scenarios (P055)" } },
  { id: "mcp.featureAdd", kind: "tool", name: "planner-feature-add", description: "Create feature (validates name).", anchor: "packages/plan-mcp/src/index.ts:401" },
  { id: "mcp.featureShow", kind: "tool", name: "planner-feature-show", description: "Feature detail.", anchor: "packages/plan-mcp/src/index.ts:444" },
  { id: "mcp.featureDiscuss", kind: "tool", name: "planner-feature-discuss", description: "Persist feature discovery.", anchor: "packages/plan-mcp/src/index.ts:458", coverage: { phase: "P055", reason: "covered by MCP adapter scenarios (P055)" } },
  { id: "mcp.featureUpdate", kind: "tool", name: "planner-feature-update", description: "Update feature fields.", anchor: "packages/plan-mcp/src/index.ts:490", coverage: { phase: "P055", reason: "covered by MCP adapter scenarios (P055)" } },
  { id: "mcp.featureDelete", kind: "tool", name: "planner-feature-delete", description: "Delete feature.", anchor: "packages/plan-mcp/src/index.ts:527", coverage: { phase: "P055", reason: "covered by MCP adapter scenarios (P055)" } },
  { id: "mcp.phaseAdd", kind: "tool", name: "planner-phase-add", description: "Create phase under a feature.", anchor: "packages/plan-mcp/src/index.ts:556" },
  { id: "mcp.phaseShow", kind: "tool", name: "planner-phase-show", description: "Phase detail + linked requirements.", anchor: "packages/plan-mcp/src/index.ts:630" },
  { id: "mcp.phaseDiscuss", kind: "tool", name: "planner-phase-discuss", description: "Persist phase discovery.", anchor: "packages/plan-mcp/src/index.ts:647", coverage: { phase: "P055", reason: "covered by MCP adapter scenarios (P055)" } },
  { id: "mcp.phaseUpdate", kind: "tool", name: "planner-phase-update", description: "Update phase fields.", anchor: "packages/plan-mcp/src/index.ts:682", coverage: { phase: "P055", reason: "covered by MCP adapter scenarios (P055)" } },
  { id: "mcp.phaseDelete", kind: "tool", name: "planner-phase-delete", description: "Delete phase.", anchor: "packages/plan-mcp/src/index.ts:709", coverage: { phase: "P055", reason: "covered by MCP adapter scenarios (P055)" } },
  { id: "mcp.taskAdd", kind: "tool", name: "planner-task-add", description: "Create task (validates title/phase).", anchor: "packages/plan-mcp/src/index.ts:725" },
  { id: "mcp.taskShow", kind: "tool", name: "planner-task-show", description: "Task detail + statusLog.", anchor: "packages/plan-mcp/src/index.ts:787" },
  { id: "mcp.taskDiscuss", kind: "tool", name: "planner-task-discuss", description: "Persist task discovery.", anchor: "packages/plan-mcp/src/index.ts:801", coverage: { phase: "P055", reason: "covered by MCP adapter scenarios (P055)" } },
  { id: "mcp.taskUpdate", kind: "tool", name: "planner-task-update", description: "Update task fields/status (motivation gate).", anchor: "packages/plan-mcp/src/index.ts:829" },
  { id: "mcp.taskChecklistToggle", kind: "tool", name: "planner-task-checklist-toggle", description: "Toggle checklist item.", anchor: "packages/plan-mcp/src/index.ts:887" },
  { id: "mcp.taskChecklistAdd", kind: "tool", name: "planner-task-checklist-add", description: "Add checklist item.", anchor: "packages/plan-mcp/src/index.ts:915" },
  { id: "mcp.taskChecklistRemove", kind: "tool", name: "planner-task-checklist-remove", description: "Remove checklist item.", anchor: "packages/plan-mcp/src/index.ts:941" },
  { id: "mcp.taskDelete", kind: "tool", name: "planner-task-delete", description: "Delete task.", anchor: "packages/plan-mcp/src/index.ts:967", coverage: { phase: "P055", reason: "covered by MCP adapter scenarios (P055)" } },
  { id: "mcp.taskStart", kind: "tool", name: "planner-task-start", description: "Start task (sets startedAt).", anchor: "packages/plan-mcp/src/index.ts:985" },
  { id: "mcp.taskComplete", kind: "tool", name: "planner-task-complete", description: "Complete task (sets completedAt; checklist advisory).", anchor: "packages/plan-mcp/src/index.ts:1037" },
  { id: "mcp.handoffList", kind: "tool", name: "planner-handoff-list", description: "Pending handoffs.", anchor: "packages/plan-mcp/src/index.ts:1082" },
  { id: "mcp.handoffShow", kind: "tool", name: "planner-handoff-show", description: "Read phase handoff.", anchor: "packages/plan-mcp/src/index.ts:1092" },
  { id: "mcp.handoffWrite", kind: "tool", name: "planner-handoff-write", description: "Write entity-scoped handoff (title required).", anchor: "packages/plan-mcp/src/index.ts:1104" },
  { id: "mcp.handoffPrepare", kind: "tool", name: "planner-handoff-prepare", description: "Prepare contract: identify target phase, get user confirmation, then write.", anchor: "packages/plan-mcp/src/index.ts:1139" },
  { id: "mcp.handoffClear", kind: "tool", name: "planner-handoff-clear", description: "Clear/archive handoff.", anchor: "packages/plan-mcp/src/index.ts:1149" },
  { id: "mcp.web", kind: "tool", name: "planner-web", description: "Start/stop/status in-process web dashboard.", anchor: "packages/plan-mcp/src/index.ts:1160" },
  { id: "mcp.load", kind: "tool", name: "planner-load", description: "Start web + recap (harness mcp).", anchor: "packages/plan-mcp/src/index.ts:1199" },
  { id: "mcp.disable", kind: "tool", name: "planner-disable", description: "MCP no-op disable.", anchor: "packages/plan-mcp/src/index.ts:1209", coverage: { phase: "P055", reason: "covered by MCP adapter scenarios (P055)" } },
];

/**
 * Pi adapter (packages/pi-adapter/src/index.ts).
 * @type {SurfaceEntry[]}
 */
export const piSurfaces = [
  { id: "pi.command", kind: "command", name: "/planner <subcommand>", description: "Hierarchical command: init/show/version/repair/cleanup-orphans/project <discuss|language>/feature <add|show|discuss|update|delete|list>/phase <add|show|discuss|update|delete|list>/task <add|show|discuss|update|delete|list|start|complete|checklist <toggle|add|remove>>/handoff <list|show|write|clear|prepare>/bypass/clear-bypass/load/stop|disable/web <status>.", anchor: "packages/pi-adapter/src/index.ts:2424", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.sessionStart", kind: "hook", name: "session_start", description: "Restore state, autocomplete, planner gating (disabled until /planner load), proactive handoff notice.", anchor: "packages/pi-adapter/src/index.ts:805", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.sessionBeforeSwitch", kind: "hook", name: "session_before_switch", description: "Write project handoff before switching session.", anchor: "packages/pi-adapter/src/index.ts:896", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.sessionBeforeCompact", kind: "hook", name: "session_before_compact", description: "Write project handoff before compact.", anchor: "packages/pi-adapter/src/index.ts:905", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.sessionShutdown", kind: "hook", name: "session_shutdown", description: "Write handoff + stop web server + reset state.", anchor: "packages/pi-adapter/src/index.ts:915", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.messageEnd", kind: "hook", name: "message_end", description: "Resume summary after load trigger.", anchor: "packages/pi-adapter/src/index.ts:927", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.toolCall", kind: "hook", name: "tool_call", description: "Task-complete reminder tracking (editedThisTurn).", anchor: "packages/pi-adapter/src/index.ts:959", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.turnStart", kind: "hook", name: "turn_start", description: "Context block build/injection.", anchor: "packages/pi-adapter/src/index.ts:1014", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.toolResult", kind: "hook", name: "tool_result", description: "Heal status roots on mutation tool results.", anchor: "packages/pi-adapter/src/index.ts:1021", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.tool.projectSetLanguage", kind: "tool", name: "project_set_language_preferences", description: "Persist language prefs.", anchor: "packages/pi-adapter/src/index.ts:2456", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.tool.planInit", kind: "tool", name: "plan_init", description: "Initialize planner.", anchor: "packages/pi-adapter/src/index.ts:2489" },
  { id: "pi.tool.projectUpdate", kind: "tool", name: "project_update", description: "Update project metadata.", anchor: "packages/pi-adapter/src/index.ts:2546" },
  { id: "pi.tool.requirementList", kind: "tool", name: "requirement_list", description: "List requirements.", anchor: "packages/pi-adapter/src/index.ts:2580", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.tool.requirementCreate", kind: "tool", name: "requirement_create", description: "Create requirement.", anchor: "packages/pi-adapter/src/index.ts:2596" },
  { id: "pi.tool.requirementUpdate", kind: "tool", name: "requirement_update", description: "Update requirement.", anchor: "packages/pi-adapter/src/index.ts:2628", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.tool.requirementDelete", kind: "tool", name: "requirement_delete", description: "Delete requirement.", anchor: "packages/pi-adapter/src/index.ts:2656", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.tool.planGet", kind: "tool", name: "plan_get", description: "Full plan read.", anchor: "packages/pi-adapter/src/index.ts:2677", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.tool.planRender", kind: "tool", name: "plan_render", description: "Regenerate markdown views.", anchor: "packages/pi-adapter/src/index.ts:2693", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.tool.planRepair", kind: "tool", name: "plan_repair", description: "Repair integrity.", anchor: "packages/pi-adapter/src/index.ts:2706", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.tool.planCleanupOrphans", kind: "tool", name: "plan_cleanup_orphan_phases", description: "Cleanup orphan phases.", anchor: "packages/pi-adapter/src/index.ts:2730" },
  { id: "pi.tool.planGetHandoff", kind: "tool", name: "plan_get_handoff", description: "DEPRECATED → handoff list.", anchor: "packages/pi-adapter/src/index.ts:2760", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.tool.planWriteHandoff", kind: "tool", name: "plan_write_handoff", description: "DEPRECATED → handoff write.", anchor: "packages/pi-adapter/src/index.ts:2775", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.tool.planDeleteHandoff", kind: "tool", name: "plan_delete_handoff", description: "DEPRECATED → handoff clear.", anchor: "packages/pi-adapter/src/index.ts:2818", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.tool.handoffList", kind: "tool", name: "handoff_list", description: "Pending handoffs.", anchor: "packages/pi-adapter/src/index.ts:2863" },
  { id: "pi.tool.handoffShow", kind: "tool", name: "handoff_show", description: "Read phase handoff.", anchor: "packages/pi-adapter/src/index.ts:2878" },
  { id: "pi.tool.handoffWrite", kind: "tool", name: "handoff_write", description: "Write phase handoff.", anchor: "packages/pi-adapter/src/index.ts:2894" },
  { id: "pi.tool.handoffClear", kind: "tool", name: "handoff_clear", description: "Clear phase handoff.", anchor: "packages/pi-adapter/src/index.ts:2942" },
  { id: "pi.tool.planAuthorizeBypass", kind: "tool", name: "plan_authorize_bypass", description: "Guard bypass.", anchor: "packages/pi-adapter/src/index.ts:2957", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.tool.planClearBypass", kind: "tool", name: "plan_clear_bypass", description: "Clear bypass.", anchor: "packages/pi-adapter/src/index.ts:2973", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.tool.featureList", kind: "tool", name: "feature_list", description: "Compact feature list.", anchor: "packages/pi-adapter/src/index.ts:2988", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.tool.featureGet", kind: "tool", name: "feature_get", description: "Feature detail.", anchor: "packages/pi-adapter/src/index.ts:3009" },
  { id: "pi.tool.featureCreate", kind: "tool", name: "feature_create", description: "Create feature.", anchor: "packages/pi-adapter/src/index.ts:3030" },
  { id: "pi.tool.featureDiscuss", kind: "tool", name: "feature_discuss", description: "Feature discovery.", anchor: "packages/pi-adapter/src/index.ts:3080", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.tool.featureUpdate", kind: "tool", name: "feature_update", description: "Update feature.", anchor: "packages/pi-adapter/src/index.ts:3118", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.tool.featureDelete", kind: "tool", name: "feature_delete", description: "Delete feature.", anchor: "packages/pi-adapter/src/index.ts:3189", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.tool.phaseList", kind: "tool", name: "phase_list", description: "Compact phase list.", anchor: "packages/pi-adapter/src/index.ts:3227", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.tool.phaseGet", kind: "tool", name: "phase_get", description: "Phase detail.", anchor: "packages/pi-adapter/src/index.ts:3256" },
  { id: "pi.tool.phaseCreate", kind: "tool", name: "phase_create", description: "Create phase.", anchor: "packages/pi-adapter/src/index.ts:3280" },
  { id: "pi.tool.phaseUpdate", kind: "tool", name: "phase_update", description: "Update phase.", anchor: "packages/pi-adapter/src/index.ts:3345", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.tool.phaseDelete", kind: "tool", name: "phase_delete", description: "Delete phase.", anchor: "packages/pi-adapter/src/index.ts:3431", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.tool.taskList", kind: "tool", name: "task_list", description: "Compact task list.", anchor: "packages/pi-adapter/src/index.ts:3469", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.tool.taskGet", kind: "tool", name: "task_get", description: "Task detail.", anchor: "packages/pi-adapter/src/index.ts:3506" },
  { id: "pi.tool.taskCreate", kind: "tool", name: "task_create", description: "Create task.", anchor: "packages/pi-adapter/src/index.ts:3527" },
  { id: "pi.tool.taskUpdate", kind: "tool", name: "task_update", description: "Update task.", anchor: "packages/pi-adapter/src/index.ts:3599" },
  { id: "pi.tool.taskDelete", kind: "tool", name: "task_delete", description: "Delete task.", anchor: "packages/pi-adapter/src/index.ts:3679", coverage: { phase: "P056", reason: "covered by Pi adapter scenarios (P056)" } },
  { id: "pi.tool.taskPause", kind: "tool", name: "task_pause", description: "Pause task with a resume checkpoint.", anchor: "packages/pi-adapter/src/index.ts:3930", coverage: { phase: "P059", reason: "Suspension pause tool (F005/P066); registered in F015 cross-harness inventory, scenario deferred to P059." } },
  { id: "pi.tool.taskSwitch", kind: "tool", name: "task_switch", description: "Switch temporary focus with a return target.", anchor: "packages/pi-adapter/src/index.ts:3975", coverage: { phase: "P059", reason: "Suspension switch tool (F005/P066); registered in F015 cross-harness inventory, scenario deferred to P059." } },
  { id: "pi.tool.taskStart", kind: "tool", name: "task_start", description: "Start task.", anchor: "packages/pi-adapter/src/index.ts:4100" },
  { id: "pi.tool.taskComplete", kind: "tool", name: "task_complete", description: "Complete task.", anchor: "packages/pi-adapter/src/index.ts:3741" },
  { id: "pi.tool.taskChecklistToggle", kind: "tool", name: "task_checklist_toggle", description: "Toggle checklist item.", anchor: "packages/pi-adapter/src/index.ts:3787" },
  { id: "pi.tool.taskChecklistAdd", kind: "tool", name: "task_checklist_add", description: "Add checklist item.", anchor: "packages/pi-adapter/src/index.ts:3820" },
  { id: "pi.tool.taskChecklistRemove", kind: "tool", name: "task_checklist_remove", description: "Remove checklist item.", anchor: "packages/pi-adapter/src/index.ts:3851" },
  { id: "pi.tool.plannerWeb", kind: "tool", name: "planner-web", description: "Start/stop/status dashboard.", anchor: "packages/pi-adapter/src/index.ts:3887" },
  { id: "pi.tool.plannerLoad", kind: "tool", name: "planner-load", description: "Enable planner + web + resume trigger.", anchor: "packages/pi-adapter/src/index.ts:3924" },
  { id: "pi.tool.plannerStop", kind: "tool", name: "planner-stop", description: "Disable planner + stop web.", anchor: "packages/pi-adapter/src/index.ts:3943" },
];

/**
 * Web UI (packages/plan-web-ui).
 * @type {SurfaceEntry[]}
 */
export const uiSurfaces = [
  { id: "ui.apiClient", kind: "module", name: "lib/api.ts", description: "HTTP client used by all loaders/actions (getProject, getFeatures, createFeature, …, listHandoffs, listArchivedHandoffs, setPhaseHandoff, clearPhaseHandoff, repairPlan, reorder).", anchor: "packages/plan-web-ui/src/lib/api.ts", coverage: { phase: "P057", reason: "covered by Web UI harness scenarios (P057)" } },
  { id: "ui.loader.dashboard", kind: "loader", name: "dashboard loader", description: "features + phases + activeTasks.", anchor: "packages/plan-web-ui/src/routes/dashboard/loader.ts" },
  { id: "ui.loader.features", kind: "loader", name: "features loader", description: "features + phases.", anchor: "packages/plan-web-ui/src/routes/features/loader.ts", coverage: { phase: "P057", reason: "covered by Web UI harness scenarios (P057)" } },
  { id: "ui.loader.featureDetail", kind: "loader", name: "feature-detail loader", description: "feature + its phases; 400 when featureId missing.", anchor: "packages/plan-web-ui/src/routes/feature-detail/loader.ts", coverage: { phase: "P057", reason: "covered by Web UI harness scenarios (P057)" } },
  { id: "ui.loader.phaseDetail", kind: "loader", name: "phase-detail loader", description: "feature + phase + linkedRequirements.", anchor: "packages/plan-web-ui/src/routes/phase-detail/loader.ts", coverage: { phase: "P057", reason: "covered by Web UI harness scenarios (P057)" } },
  { id: "ui.loader.taskDetail", kind: "loader", name: "task-detail loader", description: "feature + phase + task.", anchor: "packages/plan-web-ui/src/routes/task-detail/loader.ts", coverage: { phase: "P057", reason: "covered by Web UI harness scenarios (P057)" } },
  { id: "ui.loader.requirements", kind: "loader", name: "requirements loader", description: "requirements + phases.", anchor: "packages/plan-web-ui/src/routes/requirements/loader.ts", coverage: { phase: "P057", reason: "covered by Web UI harness scenarios (P057)" } },
  { id: "ui.action.featureCreate", kind: "action", name: "feature-create action", description: "POST createFeature from FormData → redirect /features.", anchor: "packages/plan-web-ui/src/routes/feature-create.action.ts" },
  { id: "ui.action.featureEdit", kind: "action", name: "feature-edit action", description: "PUT updateFeature.", anchor: "packages/plan-web-ui/src/routes/feature-edit.action.ts", coverage: { phase: "P057", reason: "covered by Web UI harness scenarios (P057)" } },
  { id: "ui.action.featureDelete", kind: "action", name: "feature-delete action", description: "DELETE feature.", anchor: "packages/plan-web-ui/src/routes/feature-delete.action.ts", coverage: { phase: "P057", reason: "covered by Web UI harness scenarios (P057)" } },
  { id: "ui.action.featureStatus", kind: "action", name: "feature-status action", description: "PUT feature status.", anchor: "packages/plan-web-ui/src/routes/feature-status.action.ts", coverage: { phase: "P057", reason: "covered by Web UI harness scenarios (P057)" } },
  { id: "ui.action.phaseCreate", kind: "action", name: "phase-create action", description: "POST createPhase → redirect feature detail.", anchor: "packages/plan-web-ui/src/routes/phase-create.action.ts" },
  { id: "ui.action.phaseEdit", kind: "action", name: "phase-edit action", description: "PUT updatePhase.", anchor: "packages/plan-web-ui/src/routes/phase-edit.action.ts", coverage: { phase: "P057", reason: "covered by Web UI harness scenarios (P057)" } },
  { id: "ui.action.phaseDelete", kind: "action", name: "phase-delete action", description: "DELETE phase.", anchor: "packages/plan-web-ui/src/routes/phase-delete.action.ts", coverage: { phase: "P057", reason: "covered by Web UI harness scenarios (P057)" } },
  { id: "ui.action.phaseStatus", kind: "action", name: "phase-status action", description: "PUT phase status.", anchor: "packages/plan-web-ui/src/routes/phase-status.action.ts", coverage: { phase: "P057", reason: "covered by Web UI harness scenarios (P057)" } },
  { id: "ui.action.taskCreate", kind: "action", name: "task-create action", description: "POST createTask with checklist support.", anchor: "packages/plan-web-ui/src/routes/task-create.action.ts" },
  { id: "ui.action.taskEdit", kind: "action", name: "task-edit action", description: "PUT updateTask.", anchor: "packages/plan-web-ui/src/routes/task-edit.action.ts", coverage: { phase: "P057", reason: "covered by Web UI harness scenarios (P057)" } },
  { id: "ui.action.taskDelete", kind: "action", name: "task-delete action", description: "DELETE task.", anchor: "packages/plan-web-ui/src/routes/task-delete.action.ts", coverage: { phase: "P057", reason: "covered by Web UI harness scenarios (P057)" } },
  { id: "ui.action.taskStatus", kind: "action", name: "task-status action", description: "PUT task status.", anchor: "packages/plan-web-ui/src/routes/task-status.action.ts" },
  { id: "ui.action.taskChecklistToggle", kind: "action", name: "task-checklist-toggle action", description: "Toggle checklist item.", anchor: "packages/plan-web-ui/src/routes/task-checklist-toggle.action.ts", coverage: { phase: "P057", reason: "covered by Web UI harness scenarios (P057)" } },
  { id: "ui.action.requirementCreate", kind: "action", name: "requirement-create action", description: "POST createRequirement (linkedPhaseIds).", anchor: "packages/plan-web-ui/src/routes/requirement-create.action.ts" },
  { id: "ui.action.requirementEdit", kind: "action", name: "requirement-edit action", description: "PUT updateRequirement.", anchor: "packages/plan-web-ui/src/routes/requirement-edit.action.ts", coverage: { phase: "P057", reason: "covered by Web UI harness scenarios (P057)" } },
  { id: "ui.action.requirementDelete", kind: "action", name: "requirement-delete action", description: "DELETE requirement.", anchor: "packages/plan-web-ui/src/routes/requirement-delete.action.ts", coverage: { phase: "P057", reason: "covered by Web UI harness scenarios (P057)" } },
  { id: "ui.action.projectEdit", kind: "action", name: "project-edit action", description: "PUT updateProject.", anchor: "packages/plan-web-ui/src/routes/project-edit.action.ts", coverage: { phase: "P057", reason: "covered by Web UI harness scenarios (P057)" } },
  { id: "ui.route.handoff", kind: "route", name: "route /handoff", description: "Handoff list + show.", anchor: "packages/plan-web-ui/src/routes/handoff.route.tsx", coverage: { phase: "P058", reason: "covered by Playwright handoff e2e scenarios (P058)" } },
  { id: "ui.route.handoffArchive", kind: "route", name: "route /handoff/archive", description: "Archived handoffs view.", anchor: "packages/plan-web-ui/src/routes/handoff-archive.route.tsx" },
  { id: "ui.component.workTree", kind: "component", name: "dashboard work-tree", description: "Feature/phase/task tree with status badges.", anchor: "packages/plan-web-ui/src/components/dashboard/work-tree.tsx" },
  { id: "ui.component.statCards", kind: "component", name: "dashboard stat-cards", description: "Progress stat cards.", anchor: "packages/plan-web-ui/src/components/dashboard/stat-cards.tsx" },
  { id: "ui.component.sortable", kind: "component", name: "dashboard sortable", description: "Drag-and-drop reorder (dnd-kit).", anchor: "packages/plan-web-ui/src/components/dashboard/sortable.tsx", coverage: { phase: "P058", reason: "covered by Playwright dashboard e2e scenarios (P058)" } },
  { id: "ui.component.statusStepper", kind: "component", name: "status-card-stepper", description: "Task/phase status stepper.", anchor: "packages/plan-web-ui/src/components/ui/status-card-stepper.tsx" },
  { id: "ui.component.statusHistory", kind: "component", name: "status-history-accordion", description: "StatusLog accordion.", anchor: "packages/plan-web-ui/src/components/ui/status-history-accordion.tsx", coverage: { phase: "P057", reason: "covered by Web UI harness scenarios (P057)" } },
  { id: "ui.component.linkedPhaseSelector", kind: "component", name: "linked-phase-selector", description: "Requirements → phases multi-select.", anchor: "packages/plan-web-ui/src/components/requirements/linked-phase-selector.tsx" },
  { id: "ui.component.badges", kind: "component", name: "badges", description: "Entity ref badges (F/P/T composite).", anchor: "packages/plan-web-ui/src/components/ui/badges.tsx", coverage: { phase: "P057", reason: "covered by Web UI harness scenarios (P057)" } },
  { id: "ui.lib.taskSearch", kind: "lib", name: "lib/task-search.ts", description: "Client-side task search/filter.", anchor: "packages/plan-web-ui/src/lib/task-search.ts", coverage: { phase: "P057", reason: "covered by Web UI harness scenarios (P057)" } },
  { id: "ui.lib.dashboardTree", kind: "lib", name: "lib/dashboard-tree.ts", description: "Tree building from features/phases/tasks.", anchor: "packages/plan-web-ui/src/lib/dashboard-tree.ts", coverage: { phase: "P058", reason: "covered by Playwright dashboard e2e scenarios (P058)" } },
  { id: "ui.lib.liveSync", kind: "lib", name: "app/live-sync.tsx", description: "WebSocket live sync hook.", anchor: "packages/plan-web-ui/src/app/live-sync.tsx", coverage: { phase: "P058", reason: "covered by Playwright live-sync e2e scenarios (P058)" } },
];

/** All surfaces grouped by harness. */
export const surfacesByHarness = {
  core: coreSurfaces,
  api: apiSurfaces,
  mcp: mcpSurfaces,
  pi: piSurfaces,
  ui: uiSurfaces,
};

/** Flat lookup: id → entry. */
export const surfaceById = new Map(
  [...coreSurfaces, ...apiSurfaces, ...mcpSurfaces, ...piSurfaces, ...uiSurfaces].map((entry) => [entry.id, entry]),
);

export function surfaceCount() {
  return surfaceById.size;
}
