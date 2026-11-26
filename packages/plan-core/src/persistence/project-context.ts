import { buildScopedDecisionContext } from "../load-reply.js";
import { buildBoundedProjectContextReply, createProjectContextSnapshot } from "../project-context.js";
import { ProjectSchema, WorkflowRulesSchema } from "../schema.js";
import type { PersistenceDriver } from "./driver.js";
import { readProjectOverviewSource } from "./overview.js";
import { resolveProjectCaller, type ProjectCaller } from "./project-access.js";
import { readRegisteredRequirements } from "./requirements.js";
import { readRegisteredDecisionsByOwner } from "./decisions.js";

export function readRegisteredProjectContext(
  driver: PersistenceDriver, caller: ProjectCaller, sessionId: string, maxChars: number,
) {
  return driver.runExclusive(() => {
    if (!resolveProjectCaller(driver, caller)) return { kind: "forbidden" } as const;
    const now = new Date().toISOString();
    const session = driver.prepare(`
      SELECT id FROM project_sessions
      WHERE id = ? AND project_id = ? AND workspace_id = ? AND principal_id = ?
      AND ended_at IS NULL AND expires_at > ?
    `).get(sessionId, caller.projectId, caller.workspaceId, caller.principalId, now);
    if (!session) return { kind: "session-expired" } as const;

    const row = driver.prepare("SELECT name, metadata FROM projects WHERE id = ?").get(caller.projectId);
    if (!row) return { kind: "forbidden" } as const;
    const decisions = readRegisteredDecisionsByOwner(driver, caller.projectId);

    const project = ProjectSchema.parse({
      workflowRules: WorkflowRulesSchema.parse({}), ...JSON.parse(String(row.metadata)) as object,
      name: row.name, acceptedDecisions: decisions.get(caller.projectId) ?? [],
    });
    const requirements = readRegisteredRequirements(driver, caller.projectId);
    const snapshot = createProjectContextSnapshot(project, { requirements });
    const context = buildBoundedProjectContextReply(snapshot, maxChars);
    const source = readProjectOverviewSource(driver, caller.projectId, project);
    if (!source) return { kind: "forbidden" } as const;
    if (context.structured.contextComplete === true && typeof context.structured.fingerprint === "string") {
      driver.prepare(`
        INSERT INTO project_context_reads(session_id, fingerprint, delivered_at) VALUES (?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET fingerprint=excluded.fingerprint, delivered_at=excluded.delivered_at
      `).run(sessionId, context.structured.fingerprint, now);
    }
    return {
      kind: "context" as const, context, source,
      async scopedDecisions() {
        const features = (await source.loadFeatures()).features.map((feature) => ({
          ...feature, acceptedDecisions: decisions.get(feature.id) ?? [],
        }));
        const phases = (await source.loadAllPhases()).map((phase) => ({
          ...phase, acceptedDecisions: decisions.get(phase.id) ?? [],
          tasks: phase.tasks.map((task) => ({ ...task, acceptedDecisions: decisions.get(task.id) ?? [] })),
        }));
        return buildScopedDecisionContext({ features: { features }, phases });
      },
    };
  });
}
