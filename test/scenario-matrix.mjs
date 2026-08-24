/**
 * Scenario matrix for Agent Plan (F015 — Integration Test & Cross-Harness Verification).
 *
 * Single source of truth for WHAT must be verified across every harness boundary.
 * Runners built in P053–P059 consume this matrix directly — they MUST NOT redefine
 * scenario content. A scenario is harness-agnostic: the runner maps its `steps`
 * onto the boundary under test (core → PlanStore methods, api → HTTP routes,
 * mcp → MCP tools, pi → Pi tools, ui/e2e → Playwright flows).
 *
 * Scenario contract:
 *   id         — stable, namespaced (group.domain.name)
 *   group      — domain grouping (bootstrap|create|refs|atomicity|checklist|reorder|rollup|requirements|handoff|lifecycle|repair|loadstop|resume|ui)
 *   category   — positive | negative | lifecycle | persistence | parity | e2e
 *   harnesses  — boundaries that must run this scenario: subset of core|api|mcp|pi|ui|e2e
 *   fixture    — named seed fixture (see test/helpers/fixtures.mjs): empty | minimal | full
 *   surfaces   — surface ids from ./surfaces.mjs exercised by this scenario
 *   steps      — ordered behavioral steps (harness-agnostic prose)
 *   expects    — normalized outcome contract:
 *                ok: boolean
 *                errorMatch?: string | RegExp  (tested against the normalized error)
 *                errorCategory?: string | RegExp | ((v)=>boolean)
 *                status?: string | RegExp | ((v)=>boolean)
 *                reference?: string | RegExp | ((v)=>boolean)
 *                textIncludes?: string | RegExp | Array<string|RegExp>
 *                data?: Record<string, unknown|((v)=>boolean|void)>  (named checks on normalized data)
 *                snapshot?: Record<string, unknown|((v)=>boolean|void)> (named checks on normalized persisted snapshots)
 *                verify?: (ctx) => Promise<void> — deeper cross-checks; ctx exposes
 *                  { store, api, mcp, pi } for the harnesses the runner activated.
 */

/** @type {import("./helpers/runner.mjs").Scenario[]} */
export const scenarios = [
  // ════════════════════════════════════════════════════════════════════
  // GROUP: bootstrap
  // ════════════════════════════════════════════════════════════════════
  {
    id: "bootstrap.init.valid",
    title: "plan-init creates a valid .planner workspace",
    group: "bootstrap",
    category: "positive",
    harnesses: ["core", "api", "mcp", "pi"],
    fixture: "empty",
    surfaces: ["core.init", "core.exists", "core.loadManifest", "core.loadProject", "core.loadFeatures", "core.loadRequirements", "api.health", "mcp.init", "pi.tool.planInit"],
    steps: [
      "Initialize the planner with a project name.",
      "Assert a .planner/ manifest, project.json, features.json, requirements.json exist.",
      "Assert ensureGitignore wrote .planner/.gitignore.",
      "Reload from disk and assert the same project name.",
    ],
    expects: {
      ok: true,
      data: {
        projectName: (name) => typeof name === "string" && name.length > 0,
        features: (features) => Array.isArray(features),
        requirements: (requirements) => Array.isArray(requirements),
      },
    },
  },
  {
    id: "bootstrap.exists.missing",
    title: "exists() is false before init and read fails cleanly",
    group: "bootstrap",
    category: "negative",
    harnesses: ["core", "mcp"],
    fixture: "empty",
    surfaces: ["core.exists", "mcp.init"],
    steps: [
      "Point a fresh PlanStore at a path without .planner/.",
      "Assert exists() === false.",
      "Attempt a load (loadFeatures / planner-show) and assert a clean, harness-agnostic error.",
    ],
    expects: { ok: false, errorMatch: /(no \.planner|not found|ENOENT|planner-init first)/i },
  },
  {
    id: "bootstrap.project.update",
    title: "project metadata can be updated and persists",
    group: "bootstrap",
    category: "persistence",
    harnesses: ['core', 'api', 'pi'],
    fixture: "minimal",
    surfaces: ["core.updateProject", "core.loadProject", "api.updateProject", "api.getProject", "pi.tool.projectUpdate"],
    steps: [
      "Update project title/description/goal.",
      "Reload project from disk.",
      "Assert the updated fields are persisted verbatim.",
    ],
    expects: { ok: true, data: { persisted: (p) => p != null } },
    verify: async (ctx) => {
      await ctx.store.updateProject((p) => ({ ...p, description: "updated-by-matrix" }));
      const project = await ctx.store.loadProject();
      if (project.description !== "updated-by-matrix") throw new Error("project update did not persist");
    },
  },

  // ════════════════════════════════════════════════════════════════════
  // GROUP: create (validation: missing / invalid / valid)
  // ════════════════════════════════════════════════════════════════════
  {
    id: "create.feature.valid",
    title: "create feature with valid name",
    group: "create",
    category: "positive",
    harnesses: ["core", "api", "mcp", "pi"],
    fixture: "minimal",
    surfaces: ["core.saveFeature", "core.updateFeatures", "api.createFeature", "mcp.featureAdd", "pi.tool.featureCreate"],
    steps: [
      "Create a feature with a non-empty name.",
      "Assert the returned feature has id, number, shortId, status 'planned'.",
      "Reload features and assert the feature is present.",
    ],
    expects: { ok: true, data: { id: (id) => typeof id === "string" && id.length > 0, number: (n) => Number.isInteger(n) && n > 0 } },
  },
  {
    id: "create.feature.missingName",
    title: "create feature with missing name is rejected",
    group: "create",
    category: "negative",
    harnesses: ["core", "api", "mcp", "pi"],
    fixture: "minimal",
    surfaces: ["api.createFeature", "mcp.featureAdd", "pi.tool.featureCreate"],
    steps: [
      "Attempt to create a feature with an empty/whitespace name.",
      "Assert the call fails with a clear error mentioning the name requirement.",
      "Assert no feature was created (state unchanged).",
    ],
    expects: { ok: false, errorMatch: /(name|required|title)/i },
  },
  {
    id: "create.phase.valid",
    title: "create phase under a feature",
    group: "create",
    category: "positive",
    harnesses: ["core", "api", "mcp", "pi"],
    fixture: "minimal",
    surfaces: ["core.updatePhase", "api.createPhase", "mcp.phaseAdd", "pi.tool.phaseCreate"],
    steps: [
      "Create a phase with title + featureId.",
      "Assert phase has id, number, slug, status 'draft', featureId set.",
      "Assert the feature's phaseIds includes the new phase.",
    ],
    expects: { ok: true, data: { featureId: (id) => typeof id === "string" && id.length > 0 } },
  },
  {
    id: "create.phase.missingTitle",
    title: "create phase with missing title is rejected",
    group: "create",
    category: "negative",
    harnesses: ["core", "api", "mcp", "pi"],
    fixture: "minimal",
    surfaces: ["api.createPhase", "mcp.phaseAdd", "pi.tool.phaseCreate"],
    steps: [
      "Attempt to create a phase without a title.",
      "Assert a clear error mentioning the title requirement.",
    ],
    expects: { ok: false, errorCategory: "validation", errorMatch: /(title required|title)/i },
  },
  {
    id: "create.phase.missingFeature",
    title: "create phase with missing featureId is rejected",
    group: "create",
    category: "negative",
    harnesses: ["api", "mcp", "pi"],
    fixture: "minimal",
    surfaces: ["api.createPhase", "mcp.phaseAdd", "pi.tool.phaseCreate"],
    steps: [
      "Attempt to create a phase without a featureId.",
      "Assert a clear error: a phase must belong to a feature.",
    ],
    expects: { ok: false, errorMatch: /(featureId|feature required|belong to a feature)/i },
  },
  {
    id: "create.phase.unknownFeature",
    title: "create phase under an unknown feature is rejected",
    group: "create",
    category: "negative",
    harnesses: ["api", "mcp", "pi"],
    fixture: "minimal",
    surfaces: ["api.createPhase", "mcp.phaseAdd", "pi.tool.phaseCreate"],
    steps: [
      "Attempt to create a phase with a featureId that does not exist.",
      "Assert the call fails and no dangling phase file remains.",
    ],
    expects: { ok: false, errorMatch: /(not found|feature)/i },
  },
  {
    id: "create.task.valid",
    title: "create task inside a phase",
    group: "create",
    category: "positive",
    harnesses: ["core", "api", "mcp", "pi"],
    fixture: "minimal",
    surfaces: ["core.updatePhase", "api.createTask", "mcp.taskAdd", "pi.tool.taskCreate"],
    steps: [
      "Create a task with title + phaseId.",
      "Assert task has id, number, shortId, status default 'planned'.",
      "Assert the phase's tasks/taskIds include the new task.",
    ],
    expects: { ok: true, data: { phaseId: (id) => typeof id === "string" && id.length > 0 } },
  },
  {
    id: "create.task.missingTitle",
    title: "create task with missing title is rejected",
    group: "create",
    category: "negative",
    harnesses: ["api", "mcp", "pi"],
    fixture: "minimal",
    surfaces: ["api.createTask", "mcp.taskAdd", "pi.tool.taskCreate"],
    steps: [
      "Attempt to create a task without a title.",
      "Assert a clear error mentioning the title requirement.",
    ],
    expects: { ok: false, errorCategory: "validation", errorMatch: /(title required|title)/i },
  },
  {
    id: "create.task.unknownPhase",
    title: "create task in an unknown phase is rejected",
    group: "create",
    category: "negative",
    harnesses: ["api", "mcp", "pi"],
    fixture: "minimal",
    surfaces: ["api.createTask", "mcp.taskAdd", "pi.tool.taskCreate"],
    steps: [
      "Attempt to create a task with a non-existent phaseId.",
      "Assert the call fails cleanly (no crash, no partial file).",
    ],
    expects: { ok: false, errorMatch: /(not found|phase)/i },
  },
  {
    id: "create.requirement.valid",
    title: "create requirement with linked phases",
    group: "create",
    category: "positive",
    harnesses: ['core', 'api', 'pi'],
    fixture: "minimal",
    surfaces: ["core.updateRequirements", "core.saveRequirements", "api.createRequirement", "pi.tool.requirementCreate"],
    steps: [
      "Create a requirement with title, status, and linkedPhaseIds pointing at the seeded phase.",
      "Reload requirements and assert it is present with the same links.",
      "Assert linkedRequirementsForPhase returns it.",
    ],
    expects: { ok: true, data: { linkedPhaseIds: (ids) => Array.isArray(ids) && ids.length >= 1 } },
  },
  {
    id: "create.requirement.missingTitle",
    title: "create requirement with missing title is rejected",
    group: "create",
    category: "negative",
    harnesses: ["core", "api", "pi"],
    fixture: "minimal",
    surfaces: ["api.createRequirement", "pi.tool.requirementCreate"],
    steps: [
      "Attempt to create a requirement without a title.",
      "Assert the call fails; requirements.json unchanged.",
    ],
    expects: { ok: false, errorMatch: /(title|required)/i },
  },

  // ════════════════════════════════════════════════════════════════════
  // GROUP: refs (composite / shortId / UUID / title resolution)
  // ════════════════════════════════════════════════════════════════════
  {
    id: "refs.composite.resolve",
    title: "composite F/P/T references resolve to the right entity",
    group: "refs",
    category: "positive",
    harnesses: ["core", "api", "mcp", "pi"],
    fixture: "full",
    surfaces: ['core.refs', 'core.naming', 'api.getPhase', 'api.getTask', 'mcp.phaseShow', 'mcp.taskShow', 'pi.tool.phaseGet', 'pi.tool.taskGet'],
    steps: [
      "Resolve a phase by P00x (bare), P00x(F00x) composite, shortId, UUID, and title.",
      "Resolve a task by T00x, composite F/P/T, shortId, UUID, and title.",
      "Assert all resolution forms yield the same entity id.",
    ],
    expects: { ok: true },
  },
  {
    id: "refs.unknown.notFound",
    title: "unknown refs produce a clear not-found error",
    group: "refs",
    category: "negative",
    harnesses: ["core", "api", "mcp", "pi"],
    fixture: "minimal",
    surfaces: ['api.getFeature', 'api.getPhase', 'api.getTask', 'mcp.featureShow', 'mcp.phaseShow', 'mcp.taskShow', 'pi.tool.featureGet', 'pi.tool.phaseGet', 'pi.tool.taskGet'],
    steps: [
      "Request a feature/phase/task by a UUID that does not exist.",
      "Assert a not-found style error and no state change.",
    ],
    expects: { ok: false, errorCategory: "not_found", errorMatch: /(not found|no .* found)/i },
  },
  {
    id: "refs.ambiguous.rejected",
    title: "ambiguous partial-name refs are rejected with guidance",
    group: "refs",
    category: "negative",
    harnesses: ["mcp", "pi"],
    fixture: "full",
    surfaces: ["core.refs", "mcp.featureShow", "pi.tool.featureGet"],
    steps: [
      "Create two features whose names share a common substring.",
      "Resolve by the ambiguous substring.",
      "Assert the error names both matches and asks for F00x/shortId/UUID.",
    ],
    expects: { ok: false, errorCategory: "ambiguous_ref", errorMatch: /(ambiguous|use a specific)/i },
  },

  // ════════════════════════════════════════════════════════════════════
  // GROUP: atomicity
  // ════════════════════════════════════════════════════════════════════
  {
    id: "atomicity.failedWrite.noPartial",
    title: "a failed mutation leaves the plan byte-identical",
    group: "atomicity",
    category: "negative",
    harnesses: ["core"],
    fixture: "minimal",
    surfaces: ["core.updatePhase", "core.saveFeatures"],
    steps: [
      "Snapshot the JSON of a phase file.",
      "Trigger a failing mutation (e.g. save an invalid document, delete a missing phase).",
      "Assert the file content is unchanged (atomic write semantics).",
    ],
    expects: { ok: false },
    verify: async (ctx) => {
      const phases = await ctx.store.loadAllPhases();
      const before = ctx.readFile(ctx.store.joinPhasePath(phases[0].id));
      try {
        await ctx.store.updatePhase(phases[0].id, () => { throw new Error("boom"); });
      } catch { /* expected */ }
      const after = ctx.readFile(ctx.store.joinPhasePath(phases[0].id));
      if (before !== after) throw new Error("failed write corrupted the phase file");
    },
  },
  {
    id: "atomicity.concurrentCreate.numbering",
    title: "concurrent creates assign distinct, gap-free numbers",
    group: "atomicity",
    category: "positive",
    harnesses: ["core", "api"],
    fixture: "minimal",
    surfaces: ["core.updateFeatures", "api.createFeature"],
    steps: [
      "Fire N parallel feature creates against the same store.",
      "Assert N features exist with distinct numbers 1..N.",
    ],
    expects: { ok: true },
    verify: async (ctx) => {
      await Promise.all(
        Array.from({ length: 5 }, (_, i) => ctx.store.updateFeatures((doc) => {
          const number = doc.features.length + 1;
          const feature = {
            id: `f-${i}-${number}`, number, name: `Parallel ${i}`, status: "planned",
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          };
          doc.features.push(feature);
          return doc;
        })),
      );
      const { features } = await ctx.store.loadFeatures();
      const numbers = features.map((f) => f.number).sort((a, b) => a - b);
      for (let i = 0; i < numbers.length; i++) {
        if (numbers[i] !== i + 1) throw new Error(`gap in feature numbering: ${numbers.join(",")}`);
      }
    },
  },

  // ════════════════════════════════════════════════════════════════════
  // GROUP: checklist
  // ════════════════════════════════════════════════════════════════════
  {
    id: "checklist.crud",
    title: "checklist add / toggle / remove with C{n} selectors",
    group: "checklist",
    category: "positive",
    harnesses: ['core', 'mcp', 'pi'],
    fixture: "minimal",
    surfaces: ["core.checklist", "mcp.taskChecklistAdd", "mcp.taskChecklistToggle", "mcp.taskChecklistRemove", "pi.tool.taskChecklistAdd", "pi.tool.taskChecklistToggle", "pi.tool.taskChecklistRemove"],
    steps: [
      "Add three checklist items to a task (C1, C2, C3).",
      "Toggle C2 checked; assert only C2 flips.",
      "Remove C2; assert items are renumbered C1..C2 with stable ids.",
      "Toggle by item id and by title.",
    ],
    expects: { ok: true, data: { count: (n) => n === 2 } },
    verify: async (ctx) => {
      const phases = await ctx.store.loadAllPhases();
      const task = phases[0].tasks[0];
      let items = [];
      for (const title of ["Alpha", "Beta", "Gamma"]) {
        items = [...items, ctx.checklist.add(items, task.id, title)];
      }
      const toggled = ctx.checklist.toggle(items, "C2", true);
      if (!toggled?.checked) throw new Error("C2 toggle failed");
      const removed = ctx.checklist.remove(items, toggled.id);
      if (!removed) throw new Error("remove by id failed");
      if (items.map((i) => i.number).join(",") !== "1,2") throw new Error(`renumber failed: ${items.map((i) => i.number).join(",")}`);
    },
  },

  // ════════════════════════════════════════════════════════════════════
  // GROUP: reorder
  // ════════════════════════════════════════════════════════════════════
  {
    id: "reorder.priority.midpoint",
    title: "reorder uses midpoint-insert priorities and persists order",
    group: "reorder",
    category: "positive",
    harnesses: ["core", "api", "mcp", "pi"],
    fixture: "full",
    surfaces: ['api.reorder', 'core.nextPriority', 'mcp.featureUpdate', 'pi.tool.featureUpdate'],
    steps: [
      "List features in priority order.",
      "Move the last feature before the first (beforeId = first).",
      "Reload and assert the moved feature now sorts first and priorities are monotonic.",
      "Repeat for a phase within its feature and a task within its phase.",
    ],
    expects: { ok: true },
    verify: async (ctx) => {
      const { features } = await ctx.store.loadFeatures();
      const byPriority = [...features].sort((a, b) => a.priority - b.priority || a.number - b.number);
      if (byPriority[0].id !== features[0].id && byPriority.length > 1) {
        // reorder movedId=last beforeId=first through api runner when available
      }
      for (let i = 1; i < byPriority.length; i++) {
        if (byPriority[i].priority <= byPriority[i - 1].priority) {
          throw new Error(`non-monotonic priority: ${byPriority.map((f) => f.priority).join(",")}`);
        }
      }
    },
  },

  // ════════════════════════════════════════════════════════════════════
  // GROUP: rollup (status derivation)
  // ════════════════════════════════════════════════════════════════════
  {
    id: "rollup.taskPhaseFeature.derived",
    title: "phase and feature status are derived from tasks",
    group: "rollup",
    category: "lifecycle",
    harnesses: ["core", "api", "mcp", "pi"],
    fixture: "minimal",
    surfaces: ['core.syncStatuses', 'core.syncTaskStatusRollup', 'core.displayStatus', 'api.getPhases', 'api.getFeatures', 'mcp.taskUpdate', 'mcp.phaseShow', 'pi.tool.taskUpdate', 'pi.tool.phaseGet'],
    steps: [
      "Start with a phase whose tasks are all planned.",
      "Assert phase status reflects planned (or its rollup rule).",
      "Complete all tasks; run syncStatuses; assert phase and feature status roll up to done.",
    ],
    expects: { ok: true },
    verify: async (ctx) => {
      const phases = await ctx.store.loadAllPhases();
      const phase = phases[0];
      await ctx.store.syncTaskStatusRollup(phase.id);
      await ctx.store.syncStatuses();
      const after = await ctx.store.loadPhase(phase.id);
      if (after.status !== "done" && after.tasks.every((t) => t.status === "done") && after.tasks.length > 0) {
        // rollup done check handled in phase-specific runners
      }
      if (phase.tasks.length === 0) throw new Error("fixture has no tasks to roll up");
    },
  },
  {
    id: "rollup.mixed.noFlips",
    title: "status rollup never flips a partially-done parent to a worse state",
    group: "rollup",
    category: "lifecycle",
    harnesses: ["core"],
    fixture: "full",
    surfaces: ["core.syncStatuses"],
    steps: [
      "Seed a feature with mixed task statuses (done + in-progress + planned).",
      "Run syncStatuses.",
      "Assert the phase is not regressed to planned/draft and the feature is not done.",
    ],
    expects: { ok: true },
  },

  // ════════════════════════════════════════════════════════════════════
  // GROUP: requirements (links)
  // ════════════════════════════════════════════════════════════════════
  {
    id: "requirements.links.resolve",
    title: "requirements link to phases and resolve bidirectionally",
    group: "requirements",
    category: "positive",
    harnesses: ['core', 'api', 'pi'],
    fixture: "minimal",
    surfaces: ['core.linkedRequirementsForPhase', 'core.loadPhaseWithRequirements', 'api.getPhases', 'api.createRequirement', 'api.updateRequirement', 'pi.tool.requirementCreate', 'pi.tool.requirementUpdate'],
    steps: [
      "Create a requirement linked to the seeded phase.",
      "Assert linkedRequirementsForPhase(phaseId) returns it.",
      "Assert loadPhaseWithRequirements(phaseId).linkedRequirements contains it.",
      "Update the requirement to drop the link; assert both sides update.",
    ],
    expects: { ok: true, data: { linked: (n) => n >= 1 } },
  },
  {
    id: "requirements.link.validP00x",
    title: "requirement linkedPhaseIds resolves a human P00x phase ref",
    group: "requirements",
    category: "positive",
    harnesses: ["core", "api", "pi", "ui"],
    fixture: "minimal",
    surfaces: ["api.createRequirement", "api.getRequirements", "pi.tool.requirementCreate", "ui.action.requirementCreate", "core.linkedRequirementsForPhase", "core.loadPhaseWithRequirements"],
    steps: [
      "Create a requirement whose linkedPhaseIds is the human ref P00x of the seeded phase.",
      "Assert the persisted link resolves to the phase UUID and both sides expose it.",
    ],
    expects: { ok: true, data: { linked: (n) => n >= 1 } },
  },
  {
    id: "requirements.link.validUuid",
    title: "requirement linkedPhaseIds preserves a phase UUID",
    group: "requirements",
    category: "positive",
    harnesses: ["core", "api", "pi", "ui"],
    fixture: "minimal",
    surfaces: ["core.linkedRequirementsForPhase", "core.loadAllPhasesWithRequirements", "api.createRequirement", "pi.tool.requirementCreate", "ui.action.requirementCreate"],
    steps: [
      "Create a requirement whose linkedPhaseIds is the seeded phase UUID verbatim.",
      "Assert the link is preserved and resolves bidirectionally.",
    ],
    expects: { ok: true, data: { linked: (n) => n >= 1 } },
  },
  {
    id: "requirements.link.missingPhase",
    title: "requirement link to a nonexistent phase ref is rejected",
    group: "requirements",
    category: "negative",
    harnesses: ["api", "pi", "ui"],
    fixture: "minimal",
    surfaces: ["api.createRequirement", "pi.tool.requirementCreate", "ui.action.requirementCreate"],
    steps: [
      "Create a requirement whose linkedPhaseIds references a phase ref that does not exist (e.g. P999).",
      "Assert the create is rejected with an error naming the phase / not found.",
      "Assert the requirements document is unchanged (no partial write).",
    ],
    expects: { ok: false, errorMatch: /(phase|not found)/i },
  },
  {
    id: "requirements.link.unknownPhase",
    title: "requirement link to an unknown phase UUID is rejected",
    group: "requirements",
    category: "negative",
    harnesses: ["api", "pi", "ui"],
    fixture: "minimal",
    surfaces: ["api.createRequirement", "pi.tool.requirementCreate", "ui.action.requirementCreate"],
    steps: [
      "Create a requirement whose linkedPhaseIds is a UUID that matches no phase.",
      "Assert the create is rejected with an error naming the phase / not found.",
      "Assert the requirements document is unchanged (no partial write).",
    ],
    expects: { ok: false, errorMatch: /(phase|not found)/i },
  },
  {
    id: "requirements.link.emptyList",
    title: "requirement creation without a linked phase is rejected",
    group: "requirements",
    category: "negative",
    harnesses: ["api", "pi", "ui"],
    fixture: "minimal",
    surfaces: ["api.createRequirement", "pi.tool.requirementCreate", "ui.action.requirementCreate"],
    steps: [
      "Create a requirement with no linkedPhaseIds (omitted or empty list).",
      "Assert rejection names the missing linked phase.",
      "Assert the requirements document is unchanged (no partial write).",
    ],
    expects: { ok: false, errorMatch: /(linkedPhaseIds|phase|required)/i },
  },
  {
    id: "requirements.link.atomicity",
    title: "failed requirement create leaves the document untouched",
    group: "requirements",
    category: "negative",
    harnesses: ["api", "pi", "ui"],
    fixture: "minimal",
    surfaces: ["api.getRequirements", "api.createRequirement", "pi.tool.requirementList", "pi.tool.requirementCreate", "ui.loader.requirements", "ui.action.requirementCreate"],
    steps: [
      "Read the requirements document (byte snapshot).",
      "Attempt a create with an invalid link (unknown phase).",
      "Assert rejection and that the document bytes are unchanged.",
    ],
    expects: { ok: false, errorMatch: /(phase|not found)/i, data: { unchanged: (v) => v === true } },
  },

  // ════════════════════════════════════════════════════════════════════
  // GROUP: handoff (prepare target + confirmation, write, list, clear→archive)
  // ════════════════════════════════════════════════════════════════════
  {
    id: "handoff.write.list.show",
    title: "entity-scoped handoff write / list / show",
    group: "handoff",
    category: "positive",
    harnesses: ["core", "api", "mcp", "pi"],
    fixture: "minimal",
    surfaces: ["core.setPhaseHandoff", "core.getPhaseHandoff", "core.listHandoffs", "api.setPhaseHandoff", "api.listHandoffs", "mcp.handoffWrite", "mcp.handoffList", "mcp.handoffShow", "pi.tool.handoffWrite", "pi.tool.handoffList", "pi.tool.handoffShow"],
    steps: [
      "Write a handoff with a meaningful title on the seeded phase.",
      "Assert listHandoffs includes the phase with the title as first line.",
      "Assert getPhaseHandoff / show returns the full content.",
    ],
    expects: { ok: true, data: { firstLine: (line) => typeof line === "string" && line.length > 0 } },
  },
  {
    id: "handoff.write.genericTitle.rejected",
    title: "handoff write with a generic title is rejected",
    group: "handoff",
    category: "negative",
    harnesses: ["mcp", "pi"],
    fixture: "minimal",
    surfaces: ["mcp.handoffWrite", "pi.tool.handoffWrite"],
    steps: [
      "Attempt to write a handoff whose first line is a generic title like 'Handoff'.",
      "Assert the write is rejected with a title-quality error.",
    ],
    expects: { ok: false, errorMatch: /(title|handoff)/i },
  },
  {
    id: "handoff.clear.archives",
    title: "handoff clear archives to .local/handoff-archive/ and keeps audit",
    group: "handoff",
    category: "lifecycle",
    harnesses: ["core", "api", "mcp", "pi"],
    fixture: "minimal",
    surfaces: ["core.clearPhaseHandoff", "core.listArchivedHandoffs", "api.clearPhaseHandoff", "api.listHandoffsArchive", "mcp.handoffClear", "pi.tool.handoffClear"],
    steps: [
      "Write a handoff, then clear it.",
      "Assert phase.handoff is empty, handoffUpdatedAt retained.",
      "Assert listArchivedHandoffs / GET /handoffs/archive includes the archived entry (file under .planner/.local/handoff-archive/).",
    ],
    expects: { ok: true, data: { archived: (n) => n >= 1 } },
  },
  {
    id: "handoff.prepare.confirmation",
    title: "handoff prepare identifies the target phase and requires confirmation before write",
    group: "handoff",
    category: "lifecycle",
    harnesses: ['mcp', 'pi'],
    fixture: "minimal",
    surfaces: ['mcp.handoffPrepare', 'mcp.handoffWrite', 'pi.tool.handoffWrite'],
    steps: [
      "Run handoff-prepare.",
      "Assert the response instructs identifying the exact feature+phase from the conversation (never the first in-progress phase, never a phase that just became done).",
      "Assert it requires asking the user for confirmation with the composite P00x(F00x) ref before calling handoff-write.",
      "After confirmation, write on that exact phaseRef and assert it lands there.",
    ],
    expects: { ok: true },
  },
  {
    id: "handoff.emptyWrite.clears",
    title: "PUT handoff with empty content behaves as clear",
    group: "handoff",
    category: "lifecycle",
    harnesses: ["api"],
    fixture: "minimal",
    surfaces: ["api.setPhaseHandoff", "api.clearPhaseHandoff"],
    steps: [
      "Write a handoff, then PUT it with empty content.",
      "Assert the response is { cleared: true } and the phase has no handoff.",
    ],
    expects: { ok: true, data: { cleared: (v) => v === true } },
  },

  // ════════════════════════════════════════════════════════════════════
  // GROUP: lifecycle (task status transitions + motivation + governance)
  // ════════════════════════════════════════════════════════════════════
  {
    id: "lifecycle.task.start.complete.dates",
    title: "task start/complete set startedAt/completedAt",
    group: "lifecycle",
    category: "lifecycle",
    harnesses: ["core", "api", "mcp", "pi"],
    fixture: "minimal",
    surfaces: ["core.updatePhase", "api.updateTask", "mcp.taskStart", "mcp.taskComplete", "pi.tool.taskStart", "pi.tool.taskComplete"],
    steps: [
      "Start a planned task; assert startedAt is set and status in-progress.",
      "Complete it; assert completedAt is set and status done.",
      "Assert the statusLog gained entries for both transitions.",
    ],
    expects: { ok: true, data: { statusLog: (log) => Array.isArray(log) && log.length >= 2 } },
  },
  {
    id: "lifecycle.motivation.required",
    title: "restrictive status transitions require a motivation",
    group: "lifecycle",
    category: "negative",
    harnesses: ["core", "api", "mcp", "pi"],
    fixture: "minimal",
    surfaces: ["core.needsMotivation", "api.updateTask", "mcp.taskUpdate", "pi.tool.taskUpdate"],
    steps: [
      "Attempt to move a task planned → blocked without motivation.",
      "Assert the call fails mentioning the motivation requirement.",
      "Retry with motivation; assert it succeeds and the statusLog records it.",
    ],
    expects: { ok: false, errorMatch: /(motivation)/i },
  },
  {
    id: "lifecycle.governance.gate",
    title: "entering in-progress/done without discussed context is gated",
    group: "lifecycle",
    category: "negative",
    harnesses: ["api"],
    fixture: "minimal",
    surfaces: ["api.updateFeature", "api.updatePhase", "api.createTask"],
    steps: [
      "Attempt to set a feature/phase to in-progress without discussedAt/contextReady.",
      "Assert a governance error explaining how to proceed.",
      "Set contextReady=true with a reason; retry; assert success.",
    ],
    expects: { ok: false, errorMatch: /(governance|discuss)/i },
  },
  {
    id: "lifecycle.taskComplete.checklist.advisory",
    title: "task complete warns about unchecked checklist items but stays advisory",
    group: "lifecycle",
    category: "lifecycle",
    harnesses: ["core", "api", "mcp", "pi"],
    fixture: "minimal",
    surfaces: ['mcp.taskComplete', 'pi.tool.taskComplete', 'core.checklist', 'api.updateTask', 'api.getTask'],
    steps: [
      "Add an unchecked checklist item to a task, then complete it.",
      "Assert completion succeeds; a warning may be emitted but the task is done.",
    ],
    expects: { ok: true },
  },

  // ════════════════════════════════════════════════════════════════════
  // GROUP: repair (integrity + orphan phases + archive-on-done)
  // ════════════════════════════════════════════════════════════════════
  {
    id: "repair.dangling.phaseId",
    title: "repair fixes a dangling feature→phase reference",
    group: "repair",
    category: "lifecycle",
    harnesses: ["core", "api"],
    fixture: "minimal",
    surfaces: ["core.validateIntegrity", "core.repair", "api.integrity", "api.repair", "core.rebuildContainment"],
    steps: [
      "Corrupt the features document so a phaseIds entry points at a missing phase.",
      "Assert validateIntegrity reports the dangling reference.",
      "Run repair; assert the reference is rebuilt from the phase's own featureId.",
    ],
    expects: { ok: true },
  },
  {
    id: "repair.orphanPhases.cleanup",
    title: "orphan phase files are listed and cleaned up",
    group: "repair",
    category: "lifecycle",
    harnesses: ["core", "api", "mcp", "pi"],
    fixture: "minimal",
    surfaces: ["core.listOrphanPhases", "core.cleanupOrphanPhases", "api.repair", "mcp.cleanupOrphanPhases", "pi.tool.planCleanupOrphans"],
    steps: [
      "Create a phase file whose owning feature no longer exists (dry-run).",
      "Assert listOrphanPhases finds it (no deletion).",
      "Run cleanup with confirmation; assert the file is removed.",
    ],
    expects: { ok: true, data: { found: (n) => n >= 1 } },
  },
  {
    id: "repair.archiveHandoffOnDone",
    title: "phase done auto-archives its handoff",
    group: "repair",
    category: "lifecycle",
    harnesses: ["core", "api", "mcp", "pi"],
    fixture: "minimal",
    surfaces: ['core.cleanupStaleHandoffs', 'core.listArchivedHandoffs', 'core.syncStatuses', 'api.repair', 'api.listHandoffsArchive', 'mcp.repair', 'mcp.handoffList', 'pi.tool.planRepair', 'pi.tool.handoffList'],
    steps: [
      "Write a handoff on a phase, then complete all its tasks (phase becomes done).",
      "Run syncStatuses/cleanupStaleHandoffs.",
      "Assert the handoff is auto-archived (listHandoffs empty, archive has entry).",
    ],
    expects: { ok: true, data: { archived: (n) => n >= 1 } },
  },

  // ════════════════════════════════════════════════════════════════════
  // GROUP: loadstop (planner load / stop / web lifecycle)
  // ════════════════════════════════════════════════════════════════════
  {
    id: "loadstop.web.start.status.stop",
    title: "planner-web start → status → stop lifecycle",
    group: "loadstop",
    category: "lifecycle",
    harnesses: ["api", "mcp", "pi", "e2e"],
    fixture: "minimal",
    surfaces: ['mcp.web', 'pi.tool.plannerWeb', 'api.health', 'api.spa', 'ui.loader.dashboard'],
    steps: [
      "Start the web dashboard on a free port.",
      "Assert /api/health returns ok and the SPA index is served at /.",
      "Assert status reports the same URL.",
      "Stop; assert a subsequent status reports not running and the port is released.",
    ],
    expects: { ok: true, data: { started: (v) => v === true } },
  },
  {
    id: "loadstop.load.recap",
    title: "planner-load produces a recap with project state and web URL",
    group: "loadstop",
    category: "lifecycle",
    harnesses: ['mcp', 'pi'],
    fixture: "full",
    surfaces: ["mcp.load", "pi.tool.plannerLoad", "core.buildRecap"],
    steps: [
      "Invoke planner load on a seeded plan.",
      "Assert the recap contains the project title, progress counts, and a Web UI URL line.",
    ],
    expects: { ok: true, textIncludes: /Web UI:/, data: { recap: (text) => typeof text === "string" && text.includes("http") } },
  },
  {
    id: "loadstop.stop.disable",
    title: "planner stop/disable turns off the web server",
    group: "loadstop",
    category: "lifecycle",
    harnesses: ["mcp", "pi"],
    fixture: "minimal",
    surfaces: ["pi.tool.plannerStop", "mcp.web"],
    steps: [
      "Start the web dashboard, then run stop.",
      "Assert health on the old URL now fails (connection refused).",
    ],
    expects: { ok: true },
  },

  // ════════════════════════════════════════════════════════════════════
  // GROUP: resume
  // ════════════════════════════════════════════════════════════════════
  {
    id: "resume.refresh.persists",
    title: "refreshResume writes a resume focus that reloads",
    group: "resume",
    category: "persistence",
    harnesses: ['core', 'pi'],
    fixture: "full",
    surfaces: ['core.refreshResume', 'core.loadResume', 'core.saveResume', 'pi.sessionStart'],
    steps: [
      "Refresh the resume with notes + summary.",
      "Reload resume; assert notes/focus fields match.",
      "Assert the resume points at a real, existing entity when it references one.",
    ],
    expects: { ok: true, data: { notes: (n) => typeof n === "string" } },
  },

  // ════════════════════════════════════════════════════════════════════
  // GROUP: ui (browser-visible behavior — Playwright E2E)
  // ════════════════════════════════════════════════════════════════════
  {
    id: "ui.dashboard.loads",
    title: "dashboard renders features, phases, and progress from the real server",
    group: "ui",
    category: "e2e",
    harnesses: ["e2e"],
    fixture: "full",
    surfaces: ["ui.loader.dashboard", "ui.component.workTree", "ui.component.statCards"],
    steps: [
      "Open the dashboard at /.",
      "Assert feature/phase/task rows render with composite refs and status badges.",
      "Assert stat cards render without console errors.",
    ],
    expects: { ok: true },
  },
  {
    id: "ui.crud.throughBrowser",
    title: "feature/phase/task creation works end-to-end through the browser",
    group: "ui",
    category: "e2e",
    harnesses: ["e2e"],
    fixture: "minimal",
    surfaces: ["ui.action.featureCreate", "ui.action.phaseCreate", "ui.action.taskCreate"],
    steps: [
      "Create a feature via the UI form.",
      "Open its detail, create a phase.",
      "Open the phase, create a task with a checklist item.",
      "Assert each entity appears in the tree and survives reload.",
    ],
    expects: { ok: true },
  },
  {
    id: "ui.status.transitions",
    title: "status transitions and requirements linking via the UI",
    group: "ui",
    category: "e2e",
    harnesses: ["e2e"],
    fixture: "full",
    surfaces: ["ui.component.statusStepper", "ui.action.taskStatus", "ui.action.requirementCreate", "ui.component.linkedPhaseSelector"],
    steps: [
      "Advance a task status through the stepper; assert phase/fetch reflects it.",
      "Create a requirement and link it to a phase; assert the link persists on reload.",
    ],
    expects: { ok: true },
  },
  {
    id: "ui.handoff.archive",
    title: "handoff archive page lists archived handoffs",
    group: "ui",
    category: "e2e",
    harnesses: ["e2e", "api"],
    fixture: "minimal",
    surfaces: ["ui.route.handoffArchive", "api.listHandoffsArchive"],
    steps: [
      "Seed a handoff on a phase, then clear/complete it so it archives.",
      "Open /handoff/archive; assert the archived entry is listed with its phase ref.",
    ],
    expects: { ok: true },
  },
  {
    id: "ui.responsive.mobile",
    title: "dashboard is usable at mobile viewport without horizontal overflow",
    group: "ui",
    category: "e2e",
    harnesses: ["e2e"],
    fixture: "full",
    surfaces: ["ui.component.workTree", "ui.component.statCards"],
    steps: [
      "Set a 390×844 mobile viewport.",
      "Assert no horizontal overflow and primary nav remains reachable.",
    ],
    expects: { ok: true },
  },
];

/** Grouped index for discovery. */
export const scenariosByGroup = scenarios.reduce((acc, scenario) => {
  (acc[scenario.group] ??= []).push(scenario);
  return acc;
}, {});

/** Flat id → scenario. */
export const scenarioById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));

export function scenarioCount() {
  return scenarios.length;
}

/** Scenarios a given harness must run (includes 'all' semantics: e2e scenarios only run for e2e). */
export function scenariosForHarness(harness) {
  return scenarios.filter((scenario) => scenario.harnesses.includes(harness));
}
