export const TASK_START_ERROR_CODES = [
  "PLAN_NOT_FOUND",
  "TASK_NOT_FOUND",
  "TASK_DONE",
  "PROJECT_GUIDELINES_READ_REQUIRED",
  "CONTEXT_READ_REQUIRED",
  "REQUIREMENTS_READ_REQUIRED",
  "START_NOT_ALLOWED",
  "ACTIVE_TASK_CONFLICT",
  "PERSISTENCE_VERIFICATION_FAILED",
] as const;

export type TaskStartErrorCode = (typeof TASK_START_ERROR_CODES)[number];

export interface TaskStartDeniedOutcome {
  started: false;
  errorCode: TaskStartErrorCode;
  message: string;
  nextActions: string[];
  taskId?: string;
  requirementIds?: string[];
}

export interface TaskStartSucceededOutcome {
  started: true;
  taskId: string;
  status: "in-progress";
  alreadyStarted: boolean;
}

export type TaskStartOutcome = TaskStartDeniedOutcome | TaskStartSucceededOutcome;

export function taskStartDenied(
  errorCode: TaskStartErrorCode,
  message: string,
  nextActions: string[],
  details: { taskId?: string; requirementIds?: string[] } = {},
): TaskStartDeniedOutcome {
  return {
    started: false,
    errorCode,
    message,
    nextActions,
    ...(details.taskId ? { taskId: details.taskId } : {}),
    ...(details.requirementIds ? { requirementIds: details.requirementIds } : {}),
  };
}

export function taskStartSucceeded(taskId: string, alreadyStarted = false): TaskStartSucceededOutcome {
  return { started: true, taskId, status: "in-progress", alreadyStarted };
}
