import type { PlanStore } from "./plan-store.js";
import type { GuardStateInput } from "./guard-decision.js";

export interface NoTaskGuardState extends GuardStateInput {
  inProgressTaskIds: string[];
}

const CLOSED_STATUSES = new Set(["done", "canceled", "rejected"]);

/**
 * Read the planner state the no-task warning needs, once, for any adapter.
 * The suggested task is the one the plan is already pointing at: the
 * resume file's in-progress task, then an open task in the current phase,
 * then a paused task, then the first open task. Never throws for a missing
 * planner; it reports `hasPlannerDir: false` instead.
 */
export async function loadNoTaskGuardState(st: PlanStore): Promise<NoTaskGuardState> {
  const hasPlannerDir = await st.exists().catch(() => false);
  if (!hasPlannerDir) {
    return { hasPlannerDir, totalTasks: 0, hasInProgressTask: false, inProgressTaskIds: [], guardBypassed: false };
  }
  const [workspace, resume, guardBypassed] = await Promise.all([
    st.loadAll(),
    st.loadResume().catch(() => null),
    st.isGuardBypassed().catch(() => false),
  ]);
  const allTasks = workspace.phases.flatMap((phase) => phase.tasks.map((task) => ({ phase, task })));
  const inProgressTaskIds = allTasks.filter(({ task }) => task.status === "in-progress").map(({ task }) => task.id);
  const isOpen = (status: string) => !CLOSED_STATUSES.has(status);

  const focus = (resume?.inProgressTaskIds?.[0] ? allTasks.find(({ task }) => task.id === resume.inProgressTaskIds[0]) : undefined)
    ?? (resume?.currentPhaseId ? allTasks.find(({ phase, task }) => phase.id === resume.currentPhaseId && isOpen(task.status)) : undefined)
    ?? allTasks.find(({ task }) => task.pauseSnapshot)
    ?? allTasks.find(({ task }) => task.status === "planned" || task.status === "blocked" || task.status === "waiting")
    ?? allTasks.find(({ task }) => isOpen(task.status));

  return {
    hasPlannerDir,
    totalTasks: allTasks.length,
    hasInProgressTask: inProgressTaskIds.length > 0,
    inProgressTaskIds,
    guardBypassed,
    ...(focus ? { focusTask: { id: focus.task.id, title: focus.task.title } } : {}),
  };
}
