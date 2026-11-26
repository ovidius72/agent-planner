import { randomUUID } from "node:crypto";
import type { PersistenceDriver } from "./driver.js";

export interface ProjectCaller {
  projectId: string;
  workspaceId: string;
  principalId: string;
  requesterId?: string | undefined;
}

export function recordProjectAudit(driver: PersistenceDriver, caller: ProjectCaller, operation: string, revision: number, requestId: string, at: string): void {
  driver.prepare(`
    INSERT INTO command_audit (project_id, request_id, workspace_id, actor_id, requester_id, operation, revision, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(caller.projectId, requestId, caller.workspaceId, caller.principalId, caller.requesterId ?? caller.principalId, operation, revision, at);
}

/** The descriptor identifies a project; only a stored grant authorizes access. */
export function resolveProjectCaller(driver: PersistenceDriver, caller: ProjectCaller) {
  return driver.prepare(`
    SELECT p.id, p.name, p.revision, w.id AS workspace_id, w.source_path
    FROM projects p
    JOIN project_principals g ON g.project_id = p.id
    JOIN project_workspaces w ON w.project_id = p.id
    WHERE p.id = ? AND p.descriptor_project_id = ? AND g.principal_id = ? AND w.id = ?
  `).get(caller.projectId, caller.projectId, caller.principalId, caller.workspaceId);
}

/** An existing clone registration authorizes its linked Git worktrees. */
export function resolveRegisteredProjectWorkspace(
  driver: PersistenceDriver,
  input: { projectId: string; principalId: string; requesterId?: string | undefined; sourcePath: string; cloneKey: string; verifiedCloneMember: boolean },
): string | undefined {
  return driver.runExclusive(() => {
    const { projectId, principalId, sourcePath, cloneKey } = input;
    const granted = driver.prepare(`
      SELECT p.revision FROM projects p JOIN project_principals g ON p.id = g.project_id
      WHERE p.id = ? AND p.descriptor_project_id = ? AND g.principal_id = ?
    `).get(projectId, projectId, principalId);
    if (!granted) return undefined;

    const exact = driver.prepare("SELECT id, clone_key FROM project_workspaces WHERE project_id = ? AND source_path = ?").get(projectId, sourcePath);
    if (exact) return exact.clone_key === cloneKey ? String(exact.id) : undefined;

    if (!input.verifiedCloneMember) return undefined;
    const clone = driver.prepare("SELECT id FROM project_workspaces WHERE project_id = ? AND clone_key = ? LIMIT 1").get(projectId, cloneKey);
    if (!clone) return undefined;

    const workspaceId = randomUUID();
    driver.prepare("INSERT INTO project_workspaces(project_id, id, source_path, clone_key) VALUES (?, ?, ?, ?)")
      .run(projectId, workspaceId, sourcePath, cloneKey);
    recordProjectAudit(driver, { projectId, workspaceId, principalId, requesterId: input.requesterId },
      "workspace.register", Number(granted.revision), randomUUID(), new Date().toISOString());
    return workspaceId;
  });
}
