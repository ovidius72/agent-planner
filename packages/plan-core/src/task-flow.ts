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
import { addChecklistItem, removeChecklistItem, toggleChecklistItem } from "./checklist.js";
import { findPhaseByRef, findTaskByRef, resolveFeatureRefStrict } from "./refs.js";
import { taskCreatedPriorityFragment } from "./task-order-context.js";
import { nowISO } from "./plan-store.js";
import type { Phase, PlanStore, Task } from "./index.js";

/** Refusal codes shared by every task client surface. */
export type TaskFlowRefusalCode =
  | "TASK_FEATURE_REQUIRED"
  | "TASK_FEATURE_NOT_FOUND"
  | "TASK_PHASE_NOT_FOUND"
  | "TASK_PHASE_MISMATCH"
  | "TASK_TITLE_REQUIRED"
  | "TASK_DESCRIPTION_TOO_SHORT"
  | "TASK_NOT_FOUND"
  | "CHECKLIST_EMPTY"
  | "CHECKLIST_ITEM_NOT_FOUND";

/**
 * A typed refusal raised before or during orchestration. Adapters map the
 * code to their own presentation; the code is the stable part.
 */
export class TaskFlowRefusal extends Error {
  readonly code: TaskFlowRefusalCode;

  constructor(code: TaskFlowRefusalCode, message: string) {
    super(message);
    this.name = "TaskFlowRefusal";
    this.code = code;
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
