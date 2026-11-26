import { randomUUID } from "node:crypto";
import type { PersistenceDriver } from "./driver.js";
import { recordProjectAudit, resolveProjectCaller, type ProjectCaller } from "./project-access.js";

export const PROJECT_SESSION_LEASE_MS = 120_000;

export type ProjectSessionCommand =
  | { kind: "session.register"; clientKind: string }
  | { kind: "session.heartbeat"; sessionId: string }
  | { kind: "session.end"; sessionId: string };

export type ProjectSessionResult =
  | { kind: "forbidden" | "not-found" | "expired" }
  | { kind: "session"; sessionId: string; lastSeenAt: string; expiresAt: string; endedAt: string | null };

export function mutateProjectSession(
  driver: PersistenceDriver,
  caller: ProjectCaller,
  command: ProjectSessionCommand,
  clock: () => number = Date.now,
): ProjectSessionResult {
  return driver.runExclusive(() => {
    const project = resolveProjectCaller(driver, caller);
    if (!project) return { kind: "forbidden" };
    const timestamp = clock();
    const now = new Date(timestamp).toISOString();
    const expiresAt = new Date(timestamp + PROJECT_SESSION_LEASE_MS).toISOString();
    if (command.kind === "session.register") {
      const sessionId = randomUUID();
      driver.prepare(`
        INSERT INTO project_sessions (id, project_id, workspace_id, principal_id, client_kind, created_at, last_seen_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(sessionId, caller.projectId, caller.workspaceId, caller.principalId, command.clientKind, now, now, expiresAt);
      recordProjectAudit(driver, caller, command.kind, Number(project.revision), randomUUID(), now);
      return { kind: "session", sessionId, lastSeenAt: now, expiresAt, endedAt: null };
    }

    const { sessionId } = command;
    const session = driver.prepare(`
      SELECT last_seen_at, expires_at, ended_at FROM project_sessions
      WHERE id = ? AND project_id = ? AND workspace_id = ? AND principal_id = ?
    `).get(sessionId, caller.projectId, caller.workspaceId, caller.principalId);
    if (!session) return { kind: "not-found" };
    if (command.kind === "session.end") {
      const endedAt = typeof session.ended_at === "string" ? session.ended_at : now;
      if (session.ended_at == null) {
        driver.prepare("UPDATE project_sessions SET ended_at = ? WHERE id = ?").run(endedAt, sessionId);
        recordProjectAudit(driver, caller, command.kind, Number(project.revision), randomUUID(), now);
      }
      return { kind: "session", sessionId, lastSeenAt: String(session.last_seen_at), expiresAt: String(session.expires_at), endedAt };
    }
    if (session.ended_at || String(session.expires_at) <= now) return { kind: "expired" };
    driver.prepare("UPDATE project_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?").run(now, expiresAt, sessionId);
    return { kind: "session", sessionId, lastSeenAt: now, expiresAt, endedAt: null };
  });
}
