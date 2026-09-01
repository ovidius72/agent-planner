import type { MacroTask, RequirementStatus } from "./schema.js";

const REQUIREMENT_STATUSES = new Set<RequirementStatus>([
  "planned", "in-progress", "done", "blocked", "canceled", "rejected", "deferred", "waiting",
]);

export interface MacroTaskMutationInput {
  /** Existing persisted ID only. Omit it for a new macro task. */
  id?: string;
  title: string;
  description?: string;
  status: RequirementStatus;
}

export class RequirementMacroTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequirementMacroTaskError";
  }
}

function nextMacroTaskId(used: Set<string>): string {
  for (let number = 1; number <= 999; number += 1) {
    const candidate = `MT-${String(number).padStart(3, "0")}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new RequirementMacroTaskError("A requirement cannot contain more than 999 macro tasks.");
}

/**
 * Reconciles user-authored macro-task fields while retaining all system-owned
 * identity and timestamp values. The input array order is canonical, so a
 * successful mutation also performs an explicit reorder atomically.
 */
export function reconcileRequirementMacroTasks(
  existing: readonly MacroTask[],
  inputs: readonly MacroTaskMutationInput[],
  timestamp: string,
): MacroTask[] {
  const existingById = new Map(existing.map((task) => [task.id, task]));
  const usedIds = new Set(existingById.keys());
  const seenIds = new Set<string>();

  return inputs.map((input, index) => {
    const title = input.title.trim();
    if (!title) throw new RequirementMacroTaskError(`Macro task ${index + 1} requires a title.`);
    if (!REQUIREMENT_STATUSES.has(input.status)) {
      throw new RequirementMacroTaskError(`Macro task ${index + 1} has an invalid status: ${input.status}.`);
    }
    const requestedId = input.id?.trim();
    if (requestedId && seenIds.has(requestedId)) {
      throw new RequirementMacroTaskError(`Macro task ID ${requestedId} appears more than once.`);
    }
    if (requestedId) seenIds.add(requestedId);
    const previous = requestedId ? existingById.get(requestedId) : undefined;
    if (requestedId && !previous) {
      throw new RequirementMacroTaskError(`Macro task ID ${requestedId} is not owned by this requirement.`);
    }
    const id = previous?.id ?? nextMacroTaskId(usedIds);
    usedIds.add(id);
    return {
      id,
      title,
      description: input.description?.trim() ?? "",
      status: input.status,
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
  });
}
