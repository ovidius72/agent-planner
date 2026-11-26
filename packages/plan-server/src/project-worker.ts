import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { ExportService, beginIdeaPromotionFlow, boundedOpenPhaseWork, boundedPage, buildHierarchicalDescriptionFreshness, buildHandoffShowReply, buildPhaseWorkMap, buildPlannerLoadReply, buildTaskMoveReply, cloneKeyFor, findIdeaByRef, findPhaseByRef, findTaskByRef, formatFeatureRef, formatPhaseRef, listOpenPhaseWork, loadCanonicalGrillMeSkill, loadCanonicalPlannerSkill, listFeatureSummaries, listPhaseSummaries, listTaskSummaries, readPlannerOverview, resolveFeatureRefStrict, resolvePlannerWorkspace, taskCompositeRef, type IdeaTargetType, type TaskListFilter } from "@agent-plan/core";
import {
  STORE_SCHEMA_VERSION,
  CommandRefusal,
  clearRegisteredHandoff,
  prepareRegisteredHandoff,
  completeRegisteredTask,
  createRegisteredEntity,
  updateRegisteredEntity,
  deleteRegisteredEntity,
  reorderRegisteredEntity,
  updateRegisteredProject,
  verifyRegisteredHandoff,
  writeRegisteredHandoff,
  executeCommand,
  getDocument,
  getDocumentByPath,
  mutateProjectSession,
  mutateRegisteredRequirement,
  mutateRegisteredDecision,
  mutateRegisteredIdea,
  mutateRegisteredTaskDependency,
  moveRegisteredTasks,
  openNodeSqliteDriver,
  pauseRegisteredTask,
  publishEvent,
  readProjectEvents,
  readProjectLists,
  readProjectOverviewSource,
  readRegisteredProjectContext,
  readRegisteredBoard,
  readRegisteredRequirements,
  readRegisteredDecisions,
  readRegisteredGuidelines,
  readRegisteredHandoffs,
  readRegisteredIdeas,
  registeredPlannerDocumentPath,
  recommendRegisteredWork,
  recordRegisteredTaskDeviation,
  readRegisteredPhaseRequirements,
  readStoreSchemaVersion,
  readTaskExecutionContext,
  reopenRegisteredTask,
  recoverRegisteredTaskSession,
  releaseRegisteredTask,
  resolveProjectCaller,
  resolveRegisteredProjectWorkspace,
  searchDocumentsLiteral,
  startRegisteredTask,
  switchRegisteredTask,
  updateDocumentInTransaction,
  mutateRegisteredChecklist,
  type ProjectCaller,
  type RegisteredTaskCompletion,
  type RegisteredTaskDeviation,
  type RegisteredTaskPause,
  type RegisteredTaskReopen,
  type RegisteredTaskSwitch,
  type RegisteredTaskRecovery,
  type RegisteredEntityCreate,
  type RegisteredEntityUpdate,
  type RegisteredEntityDelete,
  type RegisteredEntityReorder,
  type RegisteredRequirementCommand,
  type RegisteredDecisionTarget,
  type RegisteredDecisionMutation,
  type RegisteredTaskDependency,
  type RegisteredTaskMove,
  type RegisteredIdeaCommand,
  type RegisteredChecklistMutation,
  type ProjectSessionCommand,
} from "@agent-plan/core/persistence";

export type ProjectOperation =
  | { kind: "workspace.resolve"; cwd: string; principalId: string; requesterId?: string | undefined }
  | ({ caller: ProjectCaller } & (
  | ProjectSessionCommand
  | { kind: "entity.create"; requestId: string; input: RegisteredEntityCreate }
  | { kind: "entity.reorder"; requestId: string; input: RegisteredEntityReorder }
  | { kind: "entity.delete"; requestId: string; input: RegisteredEntityDelete }
  | { kind: "entity.update"; requestId: string; input: RegisteredEntityUpdate }
  | ({ kind: "requirement.mutate" } & RegisteredRequirementCommand)
  | { kind: "requirement.list"; phaseRef?: string | undefined }
  | ({ kind: "decision.list" } & RegisteredDecisionTarget)
  | ({ kind: "decision.mutate" } & RegisteredDecisionMutation)
  | ({ kind: "task.dependency" } & RegisteredTaskDependency)
  | ({ kind: "task.move" } & RegisteredTaskMove)
  | ({ kind: "idea.mutate" } & RegisteredIdeaCommand)
  | { kind: "idea.read"; ref?: string | undefined }
  | { kind: "idea.promotion.begin"; ref: string; targetType: IdeaTargetType }
  | { kind: "task.context"; ref: string; sessionId: string; maxChars: number }
  | { kind: "task.start"; ref: string; sessionId: string; requestId: string; confirmedTakeover?: boolean | undefined }
  | ({ kind: "task.complete" } & RegisteredTaskCompletion)
  | ({ kind: "task.pause" } & RegisteredTaskPause)
  | ({ kind: "task.reopen" } & RegisteredTaskReopen)
  | ({ kind: "task.release" } & RegisteredTaskReopen)
  | ({ kind: "task.deviation" } & RegisteredTaskDeviation)
  | ({ kind: "task.switch" } & RegisteredTaskSwitch)
  | ({ kind: "task.session.recover" } & RegisteredTaskRecovery)
  | ({ kind: "task.checklist.mutate" } & RegisteredChecklistMutation)
  | { kind: "context.load"; sessionId: string; maxChars: number }
  | { kind: "project.get" }
  | { kind: "project.guidelines" }
  | { kind: "project.recommend"; sessionId: string }
  | { kind: "project.export"; full: boolean }
  | { kind: "project.plan" }
  | { kind: "handoff.list"; archived: boolean; includeContent: boolean; page: number; pageSize: number }
  | { kind: "handoff.show"; ref: string }
  | { kind: "handoff.clear"; ref: string; requestId: string; confirmed: boolean }
  | { kind: "handoff.prepare"; ref: string; supportingDocuments: unknown }
  | { kind: "handoff.verify"; ref: string; requestId: string; fields: unknown }
  | { kind: "handoff.write"; ref: string; requestId: string; fields: unknown }
  | { kind: "project.update"; requestId: string; fields: unknown }
  | { kind: "project.board" }
  | { kind: "project.overview" }
  | { kind: "project.description-freshness" }
  | { kind: "project.list"; collection: "features" | "phases" | "tasks"; filters: TaskListFilter }
  | { kind: "project.detail"; collection: "features" | "phases" | "tasks"; ref: string; full: boolean }
  | { kind: "project.snapshot" }
  | { kind: "events.replay"; after: number }
  | { kind: "documents.search"; query: string }
  | { kind: "document.get"; documentId: string }
  | { kind: "document.path"; path: string }
  | { kind: "document.update"; requestId: string; expectedRevision?: number | undefined; expectedDocumentRevision?: number | undefined; documentId: string; content: string }
));

export type ProjectReply =
  | { status: 200; data: unknown }
  | { status: 400 | 403 | 404 | 409 | 500 | 503; code: string; message: string; details?: Record<string, unknown> | undefined };

const refused: ProjectReply = { status: 403, code: "PROJECT_ACCESS_DENIED", message: "The principal has no access to the project and workspace." };
const missingDocument: ProjectReply = { status: 404, code: "DOCUMENT_NOT_FOUND", message: "Document not found in the project." };

const runGit = promisify(execFile);

async function registeredGitWorktree(path: string, cloneKey: string): Promise<boolean> {
  if (path === cloneKey) return false;
  const args = [`--git-dir=${cloneKey}`, "worktree", "list", "--porcelain", "-z"];
  try {
    const { stdout } = await runGit("git", args, { timeout: 1500, maxBuffer: 128 * 1024 });
    for (const field of stdout.split("\0")) {
      if (field.startsWith("worktree ") && await realpath(field.slice(9)).catch(() => "") === path) return true;
    }
  } catch {
    return false;
  }
  return false;
}

async function findWorkspace(cwd: string): Promise<{ projectId: string; path: string; cloneKey: string } | { reply: ProjectReply }> {
  if (!(await stat(cwd).catch(() => null))?.isDirectory()) {
    return { reply: { status: 404, code: "WORKSPACE_NOT_FOUND", message: "The workspace directory does not exist." } };
  }
  const location = await resolvePlannerWorkspace(await realpath(cwd));
  if (location.kind === "descriptor-error") {
    return { reply: { status: 409, code: location.error.code, message: "The workspace descriptor is invalid or incompatible." } };
  }
  if (location.kind !== "descriptor") {
    return { reply: { status: 404, code: "PROJECT_DESCRIPTOR_REQUIRED", message: "A workspace descriptor is required for the registered project service." } };
  }
  return { projectId: location.descriptor.projectId, path: location.root, cloneKey: await cloneKeyFor(location.root) };
}

async function dispatch(operation: ProjectOperation, home: string): Promise<ProjectReply> {
  const workspace = operation.kind === "workspace.resolve" ? await findWorkspace(operation.cwd) : undefined;
  if (workspace && "reply" in workspace) return workspace.reply;
  const projectId = operation.kind === "workspace.resolve" ? workspace!.projectId : operation.caller.projectId;
  const projects = resolve(await realpath(home), ".agent-plan", "projects");
  const path = join(projects, projectId, "planner.sqlite");
  const info = await lstat(path).catch(() => null);
  if (!info?.isFile() || await realpath(path) !== path) {
    return { status: 404, code: "PROJECT_STORE_NOT_FOUND", message: "The project has no registered local SQLite store." };
  }
  const driver = openNodeSqliteDriver({ path, busyTimeoutMs: 500 });
  try {
    if (readStoreSchemaVersion(driver) !== STORE_SCHEMA_VERSION) {
      return { status: 409, code: "PROJECT_STORE_INCOMPATIBLE", message: "The project store requires an explicit schema upgrade." };
    }
    if (operation.kind === "workspace.resolve") {
      const { path: sourcePath, cloneKey } = workspace!;
      const workspaceId = resolveRegisteredProjectWorkspace(driver, {
        projectId, principalId: operation.principalId, requesterId: operation.requesterId, sourcePath, cloneKey,
        verifiedCloneMember: await registeredGitWorktree(sourcePath, cloneKey),
      });
      return workspaceId ? { status: 200, data: { projectId, workspaceId } } : refused;
    }
    const { caller } = operation;
    const project = resolveProjectCaller(driver, caller);
    if (!project) return refused;
    if (operation.kind === "session.register" || operation.kind === "session.heartbeat" || operation.kind === "session.end") {
      const result = mutateProjectSession(driver, caller, operation);
      if (result.kind === "forbidden") return refused;
      if (result.kind === "not-found") return { status: 404, code: "SESSION_NOT_FOUND", message: "Session does not exist in the current scope." };
      if (result.kind === "expired") return { status: 409, code: "SESSION_EXPIRED", message: "The registered session lease has expired." };
      return { status: 200, data: result };
    }
    if (operation.kind === "task.context") {
      const result = readTaskExecutionContext(driver, caller, operation);
      if (result.kind === "forbidden") return refused;
      if (result.kind === "expired") return { status: 409, code: "SESSION_EXPIRED", message: "A live session is required." };
      if (result.kind === "missing") return { status: 404, code: "TASK_NOT_FOUND", message: "The task could not be resolved." };
      return { status: 200, data: result };
    }
    if ("requestId" in operation && operation.kind !== "document.update") {
      const apply = () => {
        switch (operation.kind) {
          case "entity.create": return createRegisteredEntity(driver, caller, operation.input);
          case "entity.reorder": return reorderRegisteredEntity(driver, caller, operation.input);
          case "entity.delete": return deleteRegisteredEntity(driver, caller, operation.input);
          case "entity.update": return updateRegisteredEntity(driver, caller, operation.input);
          case "handoff.clear": return clearRegisteredHandoff(driver, caller, operation);
          case "handoff.verify": return verifyRegisteredHandoff(driver, caller, operation);
          case "handoff.write": return writeRegisteredHandoff(driver, caller, operation);
          case "project.update": return updateRegisteredProject(driver, caller, operation.requestId, operation.fields);
          case "requirement.mutate": return mutateRegisteredRequirement(driver, caller, operation);
          case "decision.mutate": return mutateRegisteredDecision(driver, caller, operation);
          case "idea.mutate": return mutateRegisteredIdea(driver, caller, operation);
          case "task.dependency": return mutateRegisteredTaskDependency(driver, caller, operation);
          case "task.move": {
            const moved = moveRegisteredTasks(driver, caller, operation);
            if (moved.status !== "committed" && moved.status !== "already-applied") return moved;
            const result = moved.result;
            if (!result) return { status: "error" as const };
            const reply = buildTaskMoveReply(result, `planner-phase-show ${result.targetPhaseRef} full=true`);
            return { ...moved, result: { ...reply.structured, message: reply.text } };
          }
          case "task.start": return startRegisteredTask(driver, caller, operation);
          case "task.complete": return completeRegisteredTask(driver, caller, operation);
          case "task.pause": return pauseRegisteredTask(driver, caller, operation);
          case "task.deviation": return recordRegisteredTaskDeviation(driver, caller, operation);
          case "task.switch": return switchRegisteredTask(driver, caller, operation);
          case "task.session.recover": return recoverRegisteredTaskSession(driver, caller, operation);
          case "task.reopen": return reopenRegisteredTask(driver, caller, operation);
          case "task.release": return releaseRegisteredTask(driver, caller, operation);
          case "task.checklist.mutate": return mutateRegisteredChecklist(driver, caller, operation);
        }
      };
      const result = apply();
      if (result.status === "committed" || result.status === "already-applied") return { status: 200, data: result.result };
      if (result.status === "forbidden") return refused;
      if (result.status === "refused") return {
        status: result.code?.endsWith("_NOT_FOUND") ? 404 : 409,
        code: result.code ?? "PROJECT_COMMAND_REFUSED", message: result.reason ?? "The project command was refused.", details: result.details,
      };
      if (result.status === "busy") return { status: 503, code: "PROJECT_BUSY", message: "The project is busy. Retry with the same requestId." };
      if (result.status === "conflict") return { status: 409, code: "REQUEST_ID_CONFLICT", message: result.reason ?? "The request ID was already used." };
      return { status: 500, code: "TASK_LIFECYCLE_FAILED", message: "The task command could not be applied." };
    }
    if (operation.kind === "context.load") {
      const guide = await loadCanonicalPlannerSkill();
      const context = readRegisteredProjectContext(driver, caller, operation.sessionId, operation.maxChars);
      if (context.kind === "forbidden") return refused;
      if (context.kind === "session-expired") return { status: 409, code: "SESSION_EXPIRED", message: "A live session is required for project context." };
      const { summary } = await readPlannerOverview(context.source);
      return { status: 200, data: buildPlannerLoadReply({
        recap: summary,
        projectContext: context.context,
        scopedDecisions: await context.scopedDecisions(),
        plannerGuide: { mode: "include", content: guide, customized: false, message: "" },
      }) };
    }
    if (operation.kind === "project.board") {
      const board = driver.runExclusive(() => resolveProjectCaller(driver, caller) ? readRegisteredBoard(driver, caller.projectId, caller.workspaceId) : undefined);
      return board ? { status: 200, data: board } : refused;
    }
    if (operation.kind === "project.export") {
      const board = driver.runExclusive(() => resolveProjectCaller(driver, caller)
        ? readRegisteredBoard(driver, caller.projectId, caller.workspaceId) : undefined);
      if (!board) return refused;
      const markdown = new ExportService().exportToMarkdown({
        project: board.project, features: { features: board.features }, phases: board.phases,
      }, operation.full);
      return { status: 200, data: { markdown, filePath: operation.full ? "EXPORT-full.md" : "EXPORT.md" } };
    }
    if (operation.kind === "project.plan") {
      return driver.runExclusive(() => {
        if (!resolveProjectCaller(driver, caller)) return refused;
        const { projectId, workspaceId } = caller;
        const board = readRegisteredBoard(driver, projectId, workspaceId);
        if (!board) return refused;
        const created = driver.prepare("SELECT created_at FROM projects WHERE id = ?").get(projectId)?.created_at;
        const activeTasks = board.phases.flatMap((phase) => phase.tasks
          .filter(({ status }) => status === "in-progress").map(({ id, title, status, number }) => ({
            id, ref: taskCompositeRef({ number }, phase, board.features), title, status,
          })));
        const openPhaseWork = listOpenPhaseWork(board.phases, board.features);
        return { status: 200, data: {
          manifest: { schemaVersion: 1, projectId, projectName: board.project.name, createdAt: created, updatedAt: board.project.updatedAt },
          project: board.project, features: { features: board.features }, phases: board.phases,
          requirements: { requirements: board.requirements }, ideas: readRegisteredIdeas(driver, projectId),
          activeTasks, activeTaskState: activeTasks.length === 0 ? "none" : activeTasks.length === 1 ? "single" : "conflict",
          openPhaseWork: boundedOpenPhaseWork(openPhaseWork), openPhaseWorkTotal: openPhaseWork.length,
        } };
      });
    }
    if (operation.kind === "handoff.list") {
      return driver.runExclusive(() => {
        if (!resolveProjectCaller(driver, caller)) return refused;
        const rows = readRegisteredHandoffs(driver, caller.projectId, operation.archived);
        const page = boundedPage(rows, operation.page, operation.pageSize);
        return { status: 200, data: { ...page, items: page.items.map(({ audit, content, ...summary }) => ({
          ...summary, ...(operation.includeContent ? { content } : {}),
        })) } };
      });
    }
    if (operation.kind === "handoff.prepare") {
      const result = prepareRegisteredHandoff(driver, caller, operation.ref, operation.supportingDocuments);
      if (result.kind === "forbidden") return refused;
      if (result.kind === "missing") return { status: 404, code: "PHASE_NOT_FOUND", message: "The phase could not be resolved.", details: { failureKind: "refusal" } };
      if (result.kind === "no-feature") return { status: 409, code: "HANDOFF_PARENT_REQUIRED", message: "The phase must have a registered feature for durable handoff context." };
      if (result.kind === "refused") return { status: 409, code: result.code, message: result.message, details: result.details };
      return { status: 200, data: { ...result.reply.structured, message: result.reply.text } };
    }
    if (operation.kind === "handoff.show") {
      return driver.runExclusive(() => {
        if (!resolveProjectCaller(driver, caller)) return refused;
        const { projectId, workspaceId } = caller;
        const board = readRegisteredBoard(driver, projectId, workspaceId);
        if (!board) return refused;
        const phase = findPhaseByRef(board.phases, board.features, operation.ref);
        if (!phase) return { status: 404, code: "PHASE_NOT_FOUND", message: "The phase could not be resolved." };
        const feature = board.features.find(({ id }) => id === phase.featureId);
        const phaseRef = formatPhaseRef(phase.number, feature?.number);
        const active = readRegisteredHandoffs(driver, projectId, false).find(({ phaseId }) => phase.id === phaseId);
        const archived = active ? undefined : readRegisteredHandoffs(driver, projectId, true)
          .find(({ phaseId, reason }) => phase.id === phaseId && ["phase-done", "phase-canceled", "phase-rejected"].includes(reason));
        const reply = active ? buildHandoffShowReply({
          kind: "active", phaseRef,
          phase: { ...phase, handoff: active.content, handoffUpdatedAt: active.updatedAt, handoffAudit: active.audit },
          phaseWorkMap: buildPhaseWorkMap(phase, feature?.number),
        }) : archived ? buildHandoffShowReply({
          kind: "archived", phaseRef, phaseId: phase.id, content: archived.content, archiveReason: archived.reason,
          archivedAt: archived.archivedAt, archiveFile: archived.file, handoffAudit: archived.audit,
        }) : buildHandoffShowReply({ kind: "empty", phaseRef, phaseId: phase.id, handoffAudit: null });
        return { status: 200, data: { ...reply.structured, message: reply.text, updatedAt: active?.updatedAt ?? archived?.archivedAt ?? "" } };
      });
    }
    if (operation.kind === "project.detail") {
      return driver.runExclusive(() => {
        if (!resolveProjectCaller(driver, caller)) return refused;
        const { projectId, workspaceId } = caller;
        const { ref, collection, full } = operation;
        const board = full ? readRegisteredBoard(driver, projectId, workspaceId) : undefined;
        const model = board ?? readProjectLists(driver, projectId);
        if (collection === "features") {
          const result = resolveFeatureRefStrict(model.features, ref);
          if (!result.ok) return { status: 404, code: "FEATURE_NOT_FOUND", message: result.error };
          const { feature } = result;
          const phaseIds = new Set(model.phases.filter((phase) => phase.featureId === feature.id).map((phase) => phase.id));
          const linkedRequirements = board?.requirements.filter((requirement) => requirement.linkedPhaseIds.some((id) => phaseIds.has(id))) ?? [];
          return { status: 200, data: { feature, ref: formatFeatureRef(feature.number), phaseCount: phaseIds.size, linkedRequirements } };
        }
        if (collection === "phases") {
          const phase = findPhaseByRef(model.phases, model.features, ref);
          if (!phase) return { status: 404, code: "PHASE_NOT_FOUND", message: "The phase could not be resolved." };
          const feature = model.features.find(({ id }) => id === phase.featureId);
          const linkedRequirements = readRegisteredRequirements(driver, projectId).filter((requirement) => requirement.linkedPhaseIds.includes(phase.id));
          return { status: 200, data: { phase, ref: formatPhaseRef(phase.number, feature?.number), linkedRequirements } };
        }
        const found = findTaskByRef(model.phases, model.features, ref);
        if (!found) return { status: 404, code: "TASK_NOT_FOUND", message: "The task could not be resolved." };
        const feature = model.features.find(({ id }) => id === found.phase.featureId);
        return { status: 200, data: { task: found.task, ref: taskCompositeRef(found.task, found.phase, model.features),
          phaseRef: formatPhaseRef(found.phase.number, feature?.number) } };
      });
    }
    if (operation.kind === "requirement.list") {
      return driver.runExclusive(() => {
        if (!resolveProjectCaller(driver, caller)) return refused;
        const { projectId } = caller;
        if (!operation.phaseRef) return { status: 200, data: { requirements: readRegisteredRequirements(driver, projectId) } };
        const model = readProjectLists(driver, projectId);
        const phase = findPhaseByRef(model.phases, model.features, operation.phaseRef);
        if (!phase) return { status: 404, code: "PHASE_NOT_FOUND", message: "The phase could not be resolved." };
        const feature = model.features.find(({ id }) => id === phase.featureId);
        return { status: 200, data: {
          requirements: readRegisteredPhaseRequirements(driver, projectId, phase.id, feature?.id),
          target: { phaseId: phase.id, phaseRef: formatPhaseRef(phase.number, feature?.number), featureId: feature?.id },
          readScope: "target", attestedRequirementIds: [],
        } };
      });
    }
    if (operation.kind === "decision.list") {
      return driver.runExclusive(() => {
        if (!resolveProjectCaller(driver, caller)) return refused;
        const data = readRegisteredDecisions(driver, caller.projectId, operation);
        return data ? { status: 200, data }
          : { status: 404, code: "ACCEPTED_DECISION_TARGET_NOT_FOUND", message: "The decision owner could not be resolved." };
      });
    }
    if (operation.kind === "idea.read") {
      return driver.runExclusive(() => {
        if (!resolveProjectCaller(driver, caller)) return refused;
        const document = readRegisteredIdeas(driver, caller.projectId);
        if (operation.ref === undefined) return { status: 200, data: { ideas: document.ideas } };
        const idea = findIdeaByRef(document.ideas, operation.ref);
        return idea ? { status: 200, data: { idea } } : { status: 404, code: "IDEA_NOT_FOUND", message: "The idea could not be resolved." };
      });
    }
    if (operation.kind === "idea.promotion.begin") {
      const model = driver.runExclusive(() => {
        if (!resolveProjectCaller(driver, caller)) return undefined;
        return { document: readRegisteredIdeas(driver, caller.projectId), ...readProjectLists(driver, caller.projectId) };
      });
      if (!model) return refused;
      const result = await beginIdeaPromotionFlow({
        ...model, loadIdeas: async () => model.document, ideaDiscussionSkill: loadCanonicalGrillMeSkill,
      }, operation.ref, operation.targetType);
      if (!result.ok) return { status: result.code === "IDEA_NOT_FOUND" ? 404 : 409,
        code: result.code, message: result.message, details: { ideaRef: result.ideaRef } };
      return { status: 200, data: { ...result, persisted: false } };
    }
    if (operation.kind === "project.get") {
      const languages = driver.prepare(`
        SELECT json_extract(metadata, '$.contentLanguage') AS content_language,
               json_extract(metadata, '$.chatLanguage') AS chat_language
        FROM projects WHERE id = ?
      `).get(caller.projectId);
      return { status: 200, data: {
        projectId: project.id, workspaceId: project.workspace_id, name: project.name, revision: project.revision,
        contentLanguage: typeof languages?.content_language === "string" ? languages.content_language : "",
        chatLanguage: typeof languages?.chat_language === "string" ? languages.chat_language : "",
      } };
    }
    if (operation.kind === "project.guidelines") {
      return driver.runExclusive(() => resolveProjectCaller(driver, caller)
        ? { status: 200, data: readRegisteredGuidelines(driver, caller.projectId) } : refused);
    }
    if (operation.kind === "project.recommend") {
      const result = recommendRegisteredWork(driver, caller, operation.sessionId);
      if (result.kind === "forbidden") return refused;
      if (result.kind === "expired") return { status: 409, code: "SESSION_EXPIRED", message: "A live session is required." };
      return { status: 200, data: result.reply };
    }
    if (operation.kind === "project.description-freshness") {
      return driver.runExclusive(() => {
        if (!resolveProjectCaller(driver, caller)) return refused;
        const board = readRegisteredBoard(driver, caller.projectId, caller.workspaceId);
        return board ? { status: 200, data: buildHierarchicalDescriptionFreshness(board.features, board.phases) } : refused;
      });
    }
    if (operation.kind === "project.overview") {
      const source = driver.runExclusive(() => resolveProjectCaller(driver, caller)
        ? readProjectOverviewSource(driver, caller.projectId)
        : undefined);
      return source ? { status: 200, data: await readPlannerOverview(source) } : refused;
    }
    if (operation.kind === "project.list") {
      const list = driver.runExclusive(() => resolveProjectCaller(driver, caller) ? readProjectLists(driver, caller.projectId) : null);
      if (!list) return refused;
      if (operation.collection === "features") {
        const features = await listFeatureSummaries(list, operation.filters);
        return { status: 200, data: { features: features.items, total: features.items.length } };
      }
      const result = operation.collection === "phases"
        ? await listPhaseSummaries(list, operation.filters)
        : await listTaskSummaries(list, operation.filters);
      return result.ok
        ? { status: 200, data: { [operation.collection]: result.items, total: result.items.length } }
        : { status: 404, code: result.code, message: result.message };
    }
    if (operation.kind === "project.snapshot" || operation.kind === "events.replay") {
      return driver.runExclusive(() => {
        const scoped = resolveProjectCaller(driver, caller);
        if (!scoped) return refused;
        const lastEvent = driver.prepare("SELECT MAX(event_id) AS event_id FROM event_outbox WHERE project_id = ?").get(caller.projectId);
        const cursor = Number(lastEvent?.event_id ?? 0);
        if (operation.kind === "events.replay") {
          if (operation.after > cursor) {
            return { status: 409, code: "EVENT_CURSOR_AHEAD", message: "Reload a project snapshot before requesting replay." };
          }
          const events = readProjectEvents(driver, caller.projectId, operation.after, 101);
          const page = events.slice(0, 100);
          return { status: 200, data: { events: page, more: events.length > 100, cursor, nextCursor: page.at(-1)?.eventId ?? operation.after } };
        }
        const documents = driver.prepare(`
          SELECT id, folder, name, revision, content_hash AS contentHash
          FROM documents WHERE project_id = ? ORDER BY id LIMIT 101
        `).all(caller.projectId);
        const model = readProjectLists(driver, caller.projectId);
        const phases = model.phases.map(({ tasks, ...phase }) => ({ ...phase, taskCount: tasks.length }));
        const tasks = model.phases.flatMap((phase) => phase.tasks.map((task) => ({
          ...task, phaseId: phase.id, featureId: phase.featureId,
        })));
        return {
          status: 200,
          data: {
            projectId: scoped.id, workspaceId: scoped.workspace_id, sourceRoot: scoped.source_path, name: scoped.name, revision: scoped.revision,
            cursor, documents: documents.slice(0, 100), moreDocuments: documents.length > 100,
            features: model.features.slice(0, 100), moreFeatures: model.features.length > 100,
            phases: phases.slice(0, 100), morePhases: phases.length > 100,
            tasks: tasks.slice(0, 100), moreTasks: tasks.length > 100,
          },
        };
      });
    }
    if (operation.kind === "documents.search") {
      return { status: 200, data: searchDocumentsLiteral(driver, caller.projectId, operation.query, { limit: 50 }) };
    }
    if (operation.kind === "document.path") {
      const path = registeredPlannerDocumentPath(operation.path);
      if (!path) return { status: 400, code: "DOCUMENT_PATH_INVALID", message: "Provide a Markdown path within .planner/docs." };
      return driver.runExclusive(() => {
        if (!resolveProjectCaller(driver, caller)) return refused;
        const doc = getDocumentByPath(driver, caller.projectId, path.folder, path.name);
        return doc ? { status: 200, data: doc } : missingDocument;
      });
    }
    const documentInProject = () => driver.prepare("SELECT id FROM documents WHERE project_id = ? AND id = ?").get(caller.projectId, operation.documentId);
    if (operation.kind === "document.get") {
      return documentInProject() ? { status: 200, data: getDocument(driver, operation.documentId) } : missingDocument;
    }
    if (!documentInProject()) return missingDocument;
    const outcome = executeCommand(driver, {
      projectId: caller.projectId,
      requestId: operation.requestId,
      expectedRevision: operation.expectedRevision,
      operation: operation.kind,
      payload: { documentId: operation.documentId, content: operation.content, expectedDocumentRevision: operation.expectedDocumentRevision },
    }, ({ recordRevision }) => {
      if (!documentInProject()) throw new Error("Document no longer exists in this project.");
      if (operation.expectedDocumentRevision !== undefined && getDocument(driver, operation.documentId)?.revision !== operation.expectedDocumentRevision) {
        throw new CommandRefusal("DOCUMENT_REVISION_CONFLICT", "This document changed after it was opened. Reload it before saving.");
      }
      const document = updateDocumentInTransaction(driver, operation.documentId, { content: operation.content });
      recordRevision();
      publishEvent(driver, caller.projectId, "document.updated", { documentId: document.id, revision: document.revision });
      return document;
    }, caller);
    if (outcome.status === "committed" || outcome.status === "already-applied") return { status: 200, data: outcome };
    if (outcome.status === "forbidden") return refused;
    if (outcome.status === "busy") return { status: 503, code: "PROJECT_BUSY", message: "The project is busy. Retry with the same requestId." };
    if (outcome.status === "refused" && outcome.code === "DOCUMENT_REVISION_CONFLICT") {
      return { status: 409, code: outcome.code, message: outcome.reason ?? "The document revision changed." };
    }
    if (outcome.status === "conflict" || outcome.status === "revision-conflict") {
      return {
        status: 409,
        code: outcome.status === "conflict" ? "REQUEST_ID_CONFLICT" : "PROJECT_REVISION_CONFLICT",
        message: outcome.reason ?? "The command conflicts with the current project.",
      };
    }
    return { status: 500, code: "PROJECT_COMMAND_FAILED", message: "The document command failed." };
  } finally {
    driver.close();
  }
}

if (parentPort) {
  const port = parentPort;
  const { operation, home } = workerData as { operation: ProjectOperation; home?: string };
  void dispatch(operation, home ?? homedir()).then(
    (result) => port.postMessage(result),
    () => port.postMessage({ status: 500, code: "PROJECT_STORE_UNAVAILABLE", message: "The project store could not be opened or read." } satisfies ProjectReply),
  );
}
