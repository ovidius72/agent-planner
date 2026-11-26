import type { PersistenceDriver } from "./driver.js";

export type HandoffArchiveReason = "manual" | "superseded" | "phase-done" | "phase-canceled" | "phase-rejected";

export function archivePhaseHandoffs(
  driver: PersistenceDriver, projectId: string, phaseId: string, reason: HandoffArchiveReason, now: string,
): number {
  return Number(driver.prepare(`
    UPDATE phase_handoffs SET archived = 1, content = json_set(
      CASE json_type(content) WHEN 'text' THEN json_object('content', json_extract(content, '$')) ELSE content END,
      '$.archiveReason', ?, '$.handoffUpdatedAt', updated_at
    ), updated_at = ? WHERE project_id = ? AND phase_id = ? AND archived = 0
  `).run(reason, now, projectId, phaseId).changes);
}
