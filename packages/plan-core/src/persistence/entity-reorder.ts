import { CommandRefusal, executeCommand, publishEvent } from "./command-authority.js";
import type { PersistenceDriver } from "./driver.js";
import type { ProjectCaller } from "./project-access.js";
import { registeredSessionIsLive } from "./task-execution.js";

export interface RegisteredEntityReorder {
  kind: "feature" | "phase" | "task";
  movedId: string;
  beforeId: string | null;
  afterId: string | null;
  requestId: string;
  sessionId: string;
}

const scopes = {
  feature: { table: "features", siblings: "" },
  phase: { table: "phases", siblings: "AND feature_id IS (SELECT feature_id FROM phases WHERE project_id = ? AND id = ?)" },
  task: { table: "tasks", siblings: "AND phase_id = (SELECT phase_id FROM tasks WHERE project_id = ? AND id = ?)" },
} as const;

export function reorderRegisteredEntity(driver: PersistenceDriver, caller: ProjectCaller, input: RegisteredEntityReorder) {
  const { projectId } = caller;
  const { kind, movedId, beforeId, afterId, sessionId, requestId } = input;
  return executeCommand(driver, {
    projectId, requestId, operation: "entity.reorder", payload: { kind, movedId, beforeId, afterId, sessionId },
  }, ({ recordRevision }) => {
    const now = new Date().toISOString();
    if (!registeredSessionIsLive(driver, caller, sessionId, now)) throw new CommandRefusal("SESSION_EXPIRED", "A live session is required.");
    const { table, siblings } = scopes[kind];
    const statement = driver.prepare(`SELECT id, priority FROM ${table} WHERE project_id = ? ${siblings} ORDER BY priority, number`);
    const rows = kind === "feature" ? statement.all(projectId) : statement.all(projectId, projectId, movedId);
    const items = rows.map(({ id, priority }) => ({ id: String(id), priority: Number(priority) }));
    const moved = items.find((item) => item.id === movedId);
    if (!moved) throw new CommandRefusal("REORDER_ENTITY_NOT_FOUND", "The item could not be resolved in this project.");
    const otherItems = items.filter((item) => item.id !== movedId);
    const before = beforeId === null ? -1 : otherItems.findIndex((item) => item.id === beforeId);
    const after = afterId === null ? otherItems.length : otherItems.findIndex((item) => item.id === afterId);
    if ((beforeId !== null && before < 0) || after < 0 || before >= after) {
      throw new CommandRefusal("REORDER_NEIGHBORS_CHANGED", "The reorder neighbors changed. Refresh and try again.");
    }
    const insertAt = before + 1;
    const step = 10;
    const previous = otherItems[before]?.priority ?? 0;
    const next = otherItems[insertAt]?.priority ?? Math.max(0, otherItems.at(-1)?.priority ?? 0) + step;
    const midpoint = previous + Math.floor((next - previous) / 2);
    const existingPriorities = new Map(items.map(({ id, priority }) => [id, priority]));
    const priorityUpdates = next - previous > 1 && Number.isSafeInteger(midpoint)
      ? [{ id: movedId, priority: midpoint }]
      : [...otherItems.slice(0, insertAt), moved, ...otherItems.slice(insertAt)]
        .map((item, index) => ({ id: item.id, priority: (index + 1) * step }))
        .filter((item) => existingPriorities.get(item.id) !== item.priority);
    const update = driver.prepare(`UPDATE ${table} SET priority = ?, updated_at = ? WHERE project_id = ? AND id = ?`);
    for (const item of priorityUpdates) update.run(item.priority, now, projectId, item.id);
    recordRevision();
    publishEvent(driver, projectId, "entity.reordered", { kind, movedId });
    return { ok: true, kind, movedId };
  }, caller);
}
