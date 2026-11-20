/**
 * Task application flows (P128(F025)/T490 — one coordinated authority).
 *
 * Creating a task and mutating its checklist is domain orchestration, not
 * harness behavior: one flow here serves the MCP tools and the versioned
 * HTTP API alike (AGENTS.md rule 19). Resolution, cross-entity validation
 * (a task's phase must belong to the named feature), identity allocation
 * and atomic writes are the flow's job; adapters wrap only their own
 * envelope. Session-bound attestation stays with the calling surface.
 */

import {
  clampSlug,
  createTaskId,
  createChecklistItemId,
  featureNumberOfPhase,
  formatFeatureRef,
  formatPhaseRef,
  taskCompositeRef,
  validateResolvedTarget,
} from "./naming.js";
import { randomUUID } from "node:crypto";
import { addChecklistItem, removeChecklistItem, replaceChecklist, toggleChecklistItem } from "./checklist.js";
import { findPhaseByRef, findTaskByRef, resolveFeatureRefStrict } from "./refs.js";
import { normalizeDescriptionRef } from "./payload-fallback.js";
import { taskCreatedPriorityFragment } from "./task-order-context.js";
import { applyTaskLifecycleDates } from "./task-lifecycle.js";
import { PlanStoreError, nowISO } from "./plan-store.js";
import { needsMotivation, TaskStatusSchema } from "./schema.js";
import type { HierarchicalDescriptionFreshness, Phase, PlanStore, StatusLogEntry, Task } from "./index.js";

/** Refusal codes shared by every task client surface. */
export type TaskFlowRefusalCode =
  | "TASK_FEATURE_REQUIRED"
  | "TASK_FEATURE_NOT_FOUND"
  | "TASK_PHASE_NOT_FOUND"
  | "TASK_PHASE_MISMATCH"
  | "TASK_TITLE_REQUIRED"
  | "TASK_DESCRIPTION_TOO_SHORT"
  | "TASK_NOT_FOUND"
  | "TASK_STATUS_INVALID"
  | "TASK_LIFECYCLE_TRANSITION_REQUIRED"
  | "TASK_LEGACY_DECISIONS_READ_ONLY"
  | "TASK_MOTIVATION_REQUIRED"
  | "TASK_NO_MUTABLE_FIELDS"
  | "SUBTASK_ID_INVALID"
  | "DEPENDENCY_TASK_NOT_FOUND"
  | "CONFIRMATION_REQUIRED"
  | "CHECKLIST_EMPTY"
  | "CHECKLIST_ITEM_NOT_FOUND";

/**
 * A typed refusal raised before or during orchestration. Adapters map the
 * code to their own presentation; the code is the stable part. Details
 * carry the domain facts (refs, statuses, field lists, target transition)
 * so each surface renders the same rule with its own action labels.
 */
export class TaskFlowRefusal extends Error {
  readonly code: TaskFlowRefusalCode;
  readonly details: Record<string, unknown>;

  constructor(code: TaskFlowRefusalCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "TaskFlowRefusal";
    this.code = code;
    this.details = details;
  }
}

export interface TaskCreateFlowInput {
  /** Feature ref the task's phase belongs to. REQUIRED — a task belongs to a feature. */
  featureRef: string;
  /** Phase ref. Accepts the canonical ref grammar (composite, bare, shortId, UUID, title). */
  phaseRef: string;
  title: string;
  description: string;
  checklist?: string[] | undefined;
}

export interface TaskCreateFlowOutcome {
  task: Task;
  phase: Phase;
  /** Canonical composite ref, e.g. "P102(F005)/T003". */
  compositeRef: string;
  /** MCP-parity human message; HTTP ignores it. */
  message: string;
}

/**
 * Create a task under a validated feature/phase pair. Ownership rules are
 * preserved exactly: the named feature must exist, the resolved phase must
 * belong to it, and both targets are re-validated right before the write.
 */
export async function createTaskFlow(store: PlanStore, input: TaskCreateFlowInput): Promise<TaskCreateFlowOutcome> {
  const featureRef = input.featureRef?.trim();
  if (!featureRef) {
    throw new TaskFlowRefusal("TASK_FEATURE_REQUIRED", "feature is required: a task must belong to a feature.");
  }
  if (!input.title?.trim()) {
    throw new TaskFlowRefusal("TASK_TITLE_REQUIRED", "title is required.");
  }
  if (!input.description || input.description.trim().length < 50) {
    throw new TaskFlowRefusal(
      "TASK_DESCRIPTION_TOO_SHORT",
      "Description must be at least 50 characters — include code references (file:line), current state vs desired state, structs/traits to modify, concrete implementation steps, edge cases.",
    );
  }

  return store.runBatch(async () => {
    const features = (await store.loadFeatures()).features;
    const resolvedFeature = resolveFeatureRefStrict(features, featureRef);
    if (!resolvedFeature.ok) {
      throw new TaskFlowRefusal("TASK_FEATURE_NOT_FOUND", resolvedFeature.error);
    }
    const feature = resolvedFeature.feature;
    const featureValidation = await validateResolvedTarget(
      "feature",
      feature.id,
      () => store.loadFeatures().then((document) => document.features.find((entry) => entry.id === feature.id)).catch(() => undefined),
    );
    if (!featureValidation.ok) {
      throw new TaskFlowRefusal("TASK_FEATURE_NOT_FOUND", featureValidation.error);
    }
    const found = findPhaseByRef(await store.loadAllPhases(), features, input.phaseRef);
    if (!found) {
      throw new TaskFlowRefusal("TASK_PHASE_NOT_FOUND", `Phase not found: ${input.phaseRef}`);
    }
    if (found.featureId !== feature.id) {
      throw new TaskFlowRefusal(
        "TASK_PHASE_MISMATCH",
        `Phase ${formatPhaseRef(found.number, featureNumberOfPhase(found, features))} does not belong to feature ${formatFeatureRef(feature.number)}. Refusing to create task.`,
      );
    }
    const phaseValidation = await validateResolvedTarget("phase", found.id, () => store.loadPhase(found.id).catch(() => undefined));
    if (!phaseValidation.ok) {
      throw new TaskFlowRefusal("TASK_PHASE_NOT_FOUND", phaseValidation.error);
    }
    const existingPhase = await store.loadPhase(found.id);
    if (!existingPhase) {
      throw new TaskFlowRefusal("TASK_PHASE_NOT_FOUND", `Resolved phase ${found.id} no longer exists. Refusing to create task.`);
    }

    const timestamp = nowISO();
    const taskId = createTaskId();
    const identity = await store.allocateEntityIdentity("task", taskId);
    const priority = await store.nextPriority("task", found.id);
    const task: Task = {
      id: taskId,
      phaseId: found.id,
      number: identity.number,
      shortId: identity.shortId,
      priority,
      shortName: clampSlug(input.title, 30, `task-${Date.now().toString(36)}`),
      title: input.title.trim(),
      status: "planned",
      description: input.description.trim(),
      descriptionUpdatedAt: timestamp,
      notes: "",
      statusLog: [],
      sessionInfo: [],
      decisions: [],
      acceptedDecisions: [],
      checklist: (input.checklist ?? []).map((item, index) => ({ id: createChecklistItemId(taskId, index + 1, item), number: index + 1, title: item, checked: false })),
      subtasks: [],
      dependsOn: [],
      pauseSnapshot: null,
      pauseHistory: [],
      startedAt: "",
      completedAt: "",
      activeOwnerSession: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await store.updatePhase(found.id, (entry) => {
      entry.tasks.push(task);
      entry.taskIds.push(task.id);
      entry.updatedAt = timestamp;
      return entry;
    });
    await store.writeGenerated();
    const finalFeatures = (await store.loadFeatures()).features;
    const compositeRef = taskCompositeRef(task, found, finalFeatures);
    return {
      task,
      phase: found,
      compositeRef,
      message: `✅ Task created: ${compositeRef} — ${task.title} (planned; ${taskCreatedPriorityFragment(task.priority)})${task.shortId ? ` · ${task.shortId}` : ""}`,
    };
  });
}

export interface TaskRefResolution {
  phase: Phase;
  task: Task;
  /** Canonical composite ref, e.g. "P102(F005)/T003". */
  compositeRef: string;
}

/** Resolve a task ref to its phase and task, refusing with a typed code. */
export async function resolveTaskRef(store: PlanStore, ref: string): Promise<TaskRefResolution> {
  const features = (await store.loadFeatures()).features;
  const found = findTaskByRef(await store.loadAllPhases(), features, ref);
  if (!found) {
    throw new TaskFlowRefusal("TASK_NOT_FOUND", `Task not found: ${ref}`);
  }
  return { phase: found.phase, task: found.task, compositeRef: taskCompositeRef(found.task, found.phase, features) };
}

export interface ChecklistFlowOutcome {
  item: { id: string; number: number; title: string; checked: boolean };
  checklistSize: number;
  /** MCP-parity human message; HTTP ignores it. */
  message: string;
}

/** Append one checklist item as the next C{n}; planner keeps ids and numbers. */
export async function addTaskChecklistItemFlow(store: PlanStore, taskRef: string, title: string): Promise<ChecklistFlowOutcome> {
  if (!title?.trim()) {
    throw new TaskFlowRefusal("TASK_TITLE_REQUIRED", "Checklist item text is required.");
  }
  const resolved = await resolveTaskRef(store, taskRef);
  let outcome: ChecklistFlowOutcome | undefined;
  await store.updatePhase(resolved.phase.id, (phase) => {
    const task = phase.tasks.find((entry) => entry.id === resolved.task.id);
    if (!task) {
      throw new TaskFlowRefusal("TASK_NOT_FOUND", `Task not found: ${taskRef}`);
    }
    const checklist = task.checklist ?? [];
    const item = addChecklistItem(checklist, task.id, title);
    checklist.push(item);
    task.checklist = checklist;
    task.updatedAt = nowISO();
    phase.updatedAt = nowISO();
    outcome = {
      item,
      checklistSize: checklist.length,
      message: `✅ Added C${item.number} "${item.title}" (${checklist.length} items)`,
    };
    return phase;
  });
  await store.writeGenerated();
  return outcome!;
}

/** Tick/untick one item; omit `checked` to toggle. */
export async function toggleTaskChecklistItemFlow(store: PlanStore, taskRef: string, selector: string, checked?: boolean | undefined): Promise<ChecklistFlowOutcome> {
  const resolved = await resolveTaskRef(store, taskRef);
  let outcome: ChecklistFlowOutcome | undefined;
  await store.updatePhase(resolved.phase.id, (phase) => {
    const task = phase.tasks.find((entry) => entry.id === resolved.task.id);
    if (!task) {
      throw new TaskFlowRefusal("TASK_NOT_FOUND", `Task not found: ${taskRef}`);
    }
    const checklist = task.checklist ?? [];
    if (checklist.length === 0) {
      throw new TaskFlowRefusal("CHECKLIST_EMPTY", `Task "${resolved.task.title}" has no checklist.`);
    }
    const target = toggleChecklistItem(checklist, selector, checked);
    if (!target) {
      throw new TaskFlowRefusal("CHECKLIST_ITEM_NOT_FOUND", `No checklist item matching "${selector}".`);
    }
    task.updatedAt = nowISO();
    phase.updatedAt = nowISO();
    const doneCount = checklist.filter((item) => item.checked).length;
    outcome = {
      item: target,
      checklistSize: checklist.length,
      message: `✅ C${target.number} "${target.title}" → ${target.checked ? "done" : "open"} (${doneCount}/${checklist.length} checked)`,
    };
    return phase;
  });
  await store.writeGenerated();
  return outcome!;
}

/** Remove one item; remaining items are renumbered, stable ids preserved. */
export async function removeTaskChecklistItemFlow(store: PlanStore, taskRef: string, selector: string): Promise<ChecklistFlowOutcome> {
  const resolved = await resolveTaskRef(store, taskRef);
  let outcome: ChecklistFlowOutcome | undefined;
  await store.updatePhase(resolved.phase.id, (phase) => {
    const task = phase.tasks.find((entry) => entry.id === resolved.task.id);
    if (!task) {
      throw new TaskFlowRefusal("TASK_NOT_FOUND", `Task not found: ${taskRef}`);
    }
    const checklist = task.checklist ?? [];
    if (checklist.length === 0) {
      throw new TaskFlowRefusal("CHECKLIST_EMPTY", `Task "${resolved.task.title}" has no checklist.`);
    }
    const removed = removeChecklistItem(checklist, selector);
    if (!removed) {
      throw new TaskFlowRefusal("CHECKLIST_ITEM_NOT_FOUND", `No checklist item matching "${selector}".`);
    }
    task.updatedAt = nowISO();
    phase.updatedAt = nowISO();
    outcome = {
      item: removed,
      checklistSize: checklist.length,
      message: `✅ Removed C${removed.number} "${removed.title}" (${checklist.length} items left)`,
    };
    return phase;
  });
  await store.writeGenerated();
  return outcome!;
}

export interface TaskSubtaskInput {
  id?: string | undefined;
  title: string;
  description?: string | undefined;
  status?: string | undefined;
}

export interface TaskUpdateFlowInput {
  title?: string | undefined;
  /** Lifecycle transitions (in-progress / done) are refused: they belong to the start/complete flows. */
  status?: string | undefined;
  description?: string | undefined;
  descriptionRef?: string | undefined;
  notes?: string | undefined;
  /** Rejected by the flow: the legacy free-form decisions array is read-only history. */
  decisions?: string[] | undefined;
  motivation?: string | undefined;
  priority?: number | undefined;
  checklist?: string[] | undefined;
  subtasks?: TaskSubtaskInput[] | undefined;
}

export interface TaskUpdateFlowOutcome {
  task: Task;
  /** Canonical ref after the write. */
  ref: string;
  updatedFields: string[];
  checklistLostTicks: string[];
  /** Set when leaving a temporary task: the paused task that must be resumed. */
  resumeRequired?: { taskId: string; phaseId: string; ref: string; title: string; snapshot: unknown };
  descriptionFreshness: HierarchicalDescriptionFreshness | null;
  staleParentRefs: string[];
}

const TASK_UPDATE_FIELDS = [
  "title", "status", "description", "descriptionRef", "notes", "motivation", "priority", "checklist", "subtasks",
] as const;

/**
 * Update task metadata without performing a lifecycle transition. Field
 * admission, the motivation rule for status changes, checklist tick
 * carry-over and the resume-required bookkeeping live here so MCP and HTTP
 * cannot drift. `sessionId` scopes the work-deviation lookup; a client
 * without session identity simply gets no resume pointer.
 */
export async function updateTaskFlow(
  store: PlanStore,
  taskRef: string,
  input: TaskUpdateFlowInput,
  options: { sessionId?: string | undefined } = {},
): Promise<TaskUpdateFlowOutcome> {
  const features = (await store.loadFeatures()).features;
  const found = findTaskByRef(await store.loadAllPhases(), features, taskRef);
  if (!found) {
    throw new TaskFlowRefusal("TASK_NOT_FOUND", `Task not found: ${taskRef}`, { entity: "task", ref: taskRef });
  }
  const currentRef = taskCompositeRef(found.task, found.phase, features);
  if (input.status !== undefined) {
    const parsed = TaskStatusSchema.safeParse(input.status);
    if (!parsed.success) {
      throw new TaskFlowRefusal("TASK_STATUS_INVALID", `Unknown task status: ${input.status}`, {
        entity: "task",
        ref: currentRef,
        taskId: found.task.id,
        attemptedStatus: input.status,
      });
    }
    if (input.status === "in-progress" && input.status !== found.task.status) {
      throw new TaskFlowRefusal(
        "TASK_LIFECYCLE_TRANSITION_REQUIRED",
        "Task start/resume transitions require planner-task-start so lifecycle state, checkpoints, and return stacks remain consistent.",
        { entity: "task", ref: currentRef, taskId: found.task.id, transition: "start", fromStatus: found.task.status, toStatus: input.status },
      );
    }
    if (input.status === "done" && input.status !== found.task.status) {
      throw new TaskFlowRefusal(
        "TASK_LIFECYCLE_TRANSITION_REQUIRED",
        "Task completion transitions require planner-task-complete with durable completion and verification evidence.",
        { entity: "task", ref: currentRef, taskId: found.task.id, transition: "complete", fromStatus: found.task.status, toStatus: input.status },
      );
    }
  }
  if (input.decisions !== undefined) {
    throw new TaskFlowRefusal("TASK_LEGACY_DECISIONS_READ_ONLY", "The legacy free-form decisions list is read-only for history.", {
      entity: "task",
      ref: currentRef,
      taskId: found.task.id,
    });
  }
  if (input.status !== undefined && needsMotivation(found.task.status, input.status as Task["status"])) {
    if (!input.motivation || !input.motivation.trim()) {
      throw new TaskFlowRefusal(
        "TASK_MOTIVATION_REQUIRED",
        `Status transition "${found.task.status} → ${input.status}" requires a motivation. Provide the "motivation" parameter with a detailed explanation of why this change is needed.`,
        { entity: "task", ref: currentRef, taskId: found.task.id, fromStatus: found.task.status, toStatus: input.status },
      );
    }
  }
  const updatedFields = TASK_UPDATE_FIELDS.filter((field) => input[field] !== undefined);
  if (updatedFields.length === 0) {
    throw new TaskFlowRefusal("TASK_NO_MUTABLE_FIELDS", `No mutable task fields were received for ${currentRef}.`, {
      entity: "task",
      ref: currentRef,
      taskId: found.task.id,
      operation: "update",
      mutableFields: [...TASK_UPDATE_FIELDS],
    });
  }
  if (input.subtasks !== undefined) {
    const existingIds = new Set(found.task.subtasks.map((item) => item.id));
    if (input.subtasks.some((item) => item.id !== undefined && !existingIds.has(item.id))) {
      throw new TaskFlowRefusal("SUBTASK_ID_INVALID", "Subtask IDs must belong to the target task.", {
        entity: "task",
        ref: currentRef,
        taskId: found.task.id,
      });
    }
  }

  let updatedTask: Task | undefined;
  let checklistLostTicks: string[] = [];
  const timestamp = nowISO();
  await store.updateTask(found.phase.id, found.task.id, (task) => {
    if (input.title !== undefined) task.title = input.title.trim();
    if (input.priority !== undefined) task.priority = input.priority;
    if (input.description !== undefined) task.description = input.description.trim();
    if (input.descriptionRef !== undefined) {
      const descriptionRef = normalizeDescriptionRef(input.descriptionRef);
      if (descriptionRef) task.descriptionRef = descriptionRef;
      else delete task.descriptionRef;
    }
    if (input.notes !== undefined) task.notes = input.notes.trim();
    if (input.checklist !== undefined) {
      const replacement = replaceChecklist(task.checklist ?? [], input.checklist, task.id);
      task.checklist = replacement.items;
      checklistLostTicks = replacement.lostTicks;
    }
    if (input.subtasks !== undefined) {
      const existingIds = new Set(task.subtasks.map((item) => item.id));
      if (input.subtasks.some((item) => item.id !== undefined && !existingIds.has(item.id))) {
        throw new PlanStoreError("Subtask IDs must belong to the target task.", undefined, { errorCode: "SUBTASK_ID_INVALID" });
      }
      task.subtasks = input.subtasks.map((item) => ({
        id: item.id ?? randomUUID(),
        title: item.title.trim(),
        description: item.description?.trim() ?? "",
        status: (item.status ?? "planned") as Task["status"],
        createdAt: task.subtasks.find((candidate) => candidate.id === item.id)?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }));
    }
    if (input.status !== undefined && input.status !== task.status) {
      const entry: StatusLogEntry = {
        id: createChecklistItemId(task.id, (task.statusLog?.length ?? 0) + 1, `${task.status}-${input.status}`),
        date: timestamp,
        fromStatus: task.status,
        toStatus: input.status as Task["status"],
        title: input.motivation?.split("\n")[0]?.trim() || `${task.status} → ${input.status}`,
        description: input.motivation?.trim() || "",
      };
      task.statusLog = [...(task.statusLog ?? []), entry];
      applyTaskLifecycleDates(task, input.status as Task["status"], timestamp);
    }
    task.updatedAt = timestamp;
    updatedTask = task;
    return task;
  });
  await store.syncTaskStatusRollup(found.phase.id);

  let resumeRequired: TaskUpdateFlowOutcome["resumeRequired"];
  if (input.status && input.status !== "in-progress" && input.status !== found.task.status) {
    const deviation = (await store.loadProject(options.sessionId)).workDeviations
      .filter((entry) => (entry.state === "approved" || entry.state === "active") && entry.temporaryTaskId === found.task.id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (deviation) {
      await store.setWorkDeviationState(deviation.id, "resume-required", timestamp);
      const resume = findTaskByRef(await store.loadAllPhases(), features, deviation.resumeTaskId);
      if (resume) {
        resumeRequired = {
          taskId: resume.task.id,
          phaseId: resume.phase.id,
          ref: taskCompositeRef(resume.task, resume.phase, features),
          title: resume.task.title,
          snapshot: resume.task.pauseSnapshot ?? deviation.snapshot,
        };
      }
    }
  }
  await store.writeGenerated();
  const task = updatedTask ?? found.task;
  const refreshedFeatures = (await store.loadFeatures()).features;
  const descriptionFreshness = updatedFields.some((field) => field === "description" || field === "descriptionRef")
    ? await store.previewDescriptionReconciliation()
    : null;
  const ownerIds = new Set([found.phase.id, found.phase.featureId].filter((id): id is string => Boolean(id)));
  const staleParentRefs = descriptionFreshness?.diagnostics
    .filter((entry) => entry.state === "stale" && ownerIds.has(entry.ownerId))
    .map((entry) => entry.ownerRef) ?? [];
  return {
    task,
    ref: taskCompositeRef(task, found.phase, refreshedFeatures),
    updatedFields: [...updatedFields],
    checklistLostTicks,
    ...(resumeRequired ? { resumeRequired } : {}),
    descriptionFreshness,
    staleParentRefs,
  };
}

export interface TaskDependencyFlowOutcome {
  task: Task;
  ref: string;
  dependencyRef: string;
  dependsOn: string[];
}

/** Add a validated dependency atomically (store rejects self/cycles/missing). */
export async function addTaskDependencyFlow(store: PlanStore, taskRef: string, dependsOnRef: string): Promise<TaskDependencyFlowOutcome> {
  const features = (await store.loadFeatures()).features;
  const phases = await store.loadAllPhases();
  const found = findTaskByRef(phases, features, taskRef);
  const dependency = findTaskByRef(phases, features, dependsOnRef);
  if (!found || !dependency) {
    throw new TaskFlowRefusal("DEPENDENCY_TASK_NOT_FOUND", "Dependency target not found.", {
      entity: "task",
      taskRef,
      dependsOnRef,
    });
  }
  const result = await store.addTaskDependency(found.phase.id, found.task.id, dependency.task.id);
  await store.writeGenerated();
  return {
    task: result,
    ref: taskCompositeRef(found.task, found.phase, features),
    dependencyRef: taskCompositeRef(dependency.task, dependency.phase, features),
    dependsOn: [...result.dependsOn],
  };
}

/** Remove a dependency after explicit confirmation. */
export async function removeTaskDependencyFlow(
  store: PlanStore,
  taskRef: string,
  dependsOnRef: string,
  confirmed: boolean,
): Promise<TaskDependencyFlowOutcome> {
  if (!confirmed) {
    throw new TaskFlowRefusal("CONFIRMATION_REQUIRED", "Explicit confirmation is required to remove a dependency.");
  }
  const features = (await store.loadFeatures()).features;
  const phases = await store.loadAllPhases();
  const found = findTaskByRef(phases, features, taskRef);
  const dependency = findTaskByRef(phases, features, dependsOnRef);
  if (!found || !dependency) {
    throw new TaskFlowRefusal("DEPENDENCY_TASK_NOT_FOUND", "Dependency target not found.", {
      entity: "task",
      taskRef,
      dependsOnRef,
    });
  }
  const result = await store.deleteTaskDependency(found.phase.id, found.task.id, dependency.task.id);
  await store.writeGenerated();
  return {
    task: result,
    ref: taskCompositeRef(found.task, found.phase, features),
    dependencyRef: taskCompositeRef(dependency.task, dependency.phase, features),
    dependsOn: [...result.dependsOn],
  };
}

export interface DeleteTaskFlowOutcome {
  taskId: string;
  /** Canonical ref of the task before deletion. */
  ref: string;
  shortId: string;
  phaseId: string;
  phaseRef: string;
}

/**
 * Delete one task, keeping the phase's taskIds list consistent and
 * refreshing the derived phase status. Deletion is destructive: every
 * surface must obtain explicit intent before calling this.
 */
export async function deleteTaskFlow(store: PlanStore, taskRef: string): Promise<DeleteTaskFlowOutcome> {
  const features = (await store.loadFeatures()).features;
  const found = findTaskByRef(await store.loadAllPhases(), features, taskRef);
  if (!found) throw new TaskFlowRefusal("TASK_NOT_FOUND", `Task not found: ${taskRef}`);
  const ref = taskCompositeRef(found.task, found.phase, features);
  const phaseRef = formatPhaseRef(found.phase.number, featureNumberOfPhase(found.phase, features));
  await store.updatePhase(found.phase.id, (phase) => {
    phase.tasks = phase.tasks.filter((task) => task.id !== found.task.id);
    phase.taskIds = phase.taskIds.filter((id) => id !== found.task.id);
    phase.updatedAt = nowISO();
    return phase;
  });
  await store.syncTaskStatusRollup(found.phase.id);
  await store.writeGenerated();
  return {
    taskId: found.task.id,
    ref,
    shortId: found.task.shortId,
    phaseId: found.phase.id,
    phaseRef,
  };
}
