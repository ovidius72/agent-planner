import { findTaskByRef } from "../refs.js";
import { taskCompositeRef } from "../naming.js";
import { CommandRefusal, executeCommand, publishEvent } from "./command-authority.js";
import type { PersistenceDriver } from "./driver.js";
import { readProjectLists } from "./overview.js";
import type { ProjectCaller } from "./project-access.js";

export interface RegisteredTaskDependency {
  ref: string;
  dependsOn: string;
  action: "add" | "delete";
  confirmed: boolean;
  requestId: string;
}

export function mutateRegisteredTaskDependency(driver: PersistenceDriver, caller: ProjectCaller, input: RegisteredTaskDependency) {
  const { projectId } = caller;
  return executeCommand(driver, {
    projectId, requestId: input.requestId, operation: `task.dependency.${input.action}`, payload: input,
  }, ({ recordRevision }) => {
    if (input.action === "delete" && !input.confirmed) {
      throw new CommandRefusal("CONFIRMATION_REQUIRED", "Explicit confirmation is required to remove a dependency.");
    }
    const { features, phases } = readProjectLists(driver, projectId);
    const source = findTaskByRef(phases, features, input.ref);
    const dependency = findTaskByRef(phases, features, input.dependsOn);
    if (!source || !dependency) throw new CommandRefusal("DEPENDENCY_TASK_NOT_FOUND", "Dependency target not found.");
    const taskId = source.task.id;
    const targetId = dependency.task.id;
    const edges = source.task.dependsOn;
    const result = { ref: taskCompositeRef(source.task, source.phase, features),
      dependencyRef: taskCompositeRef(dependency.task, dependency.phase, features), task: source.task, dependsOn: edges };
    if (input.action === "add") {
      if (taskId === targetId) throw new CommandRefusal("DEPENDENCY_SELF", "A task cannot depend on itself.");
      if (edges.includes(targetId)) return result;
      const cycle = driver.prepare(`
        WITH RECURSIVE accessible(task_id) AS (
          SELECT ? UNION SELECT d.depends_on FROM task_dependencies d
          JOIN accessible a ON a.task_id = d.task_id
          JOIN tasks t ON t.id = d.depends_on WHERE t.project_id = ?
        ) SELECT 1 FROM accessible WHERE task_id = ? LIMIT 1
      `).get(targetId, projectId, taskId);
      if (cycle) throw new CommandRefusal("DEPENDENCY_CYCLE", "Dependency would create a cycle.");
      driver.prepare("INSERT INTO task_dependencies (task_id, depends_on) VALUES (?, ?)").run(taskId, targetId);
      result.dependsOn = [...edges, targetId];
    } else {
      if (!edges.includes(targetId)) throw new CommandRefusal("DEPENDENCY_NOT_FOUND", "Dependency not found.");
      driver.prepare("DELETE FROM task_dependencies WHERE task_id = ? AND depends_on = ?").run(taskId, targetId);
      result.dependsOn = edges.filter((id) => id !== targetId);
    }
    const now = new Date().toISOString();
    driver.prepare("UPDATE tasks SET updated_at = ? WHERE project_id = ? AND id = ?").run(now, projectId, taskId);
    recordRevision();
    publishEvent(driver, projectId, `task.dependency.${input.action}`, { taskId, dependencyId: targetId });
    return { ...result, task: { ...result.task, dependsOn: result.dependsOn } };
  }, caller);
}
