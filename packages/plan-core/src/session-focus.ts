/**
 * Per-session focus: which side tasks and which resume focus belong to which
 * agent session.
 *
 * Several agents can work on one planner at once. Task ownership is already per
 * session (Task.activeOwnerSession); the approved side-task stack and the resume
 * focus used to be shared by the whole project, so one agent's temporary switch
 * became every agent's return target. These helpers are the one place that
 * decides who sees what, so no caller has to remember the rule.
 *
 * A caller with no session id (the web UI, scripts) sees the whole project, as
 * before.
 */

import type { ResumeSessions, WorkDeviation } from "./schema.js";

/** How many per-session resume entries are kept; the least recently updated are dropped. */
export const RESUME_SESSION_LIMIT = 20;

/**
 * The deviations a session may see: its own, plus unowned ones (legacy data,
 * written before sessions were tracked). Another session's are hidden. An empty
 * session id means "the whole project" and returns everything.
 */
export function deviationsForSession<T extends Pick<WorkDeviation, "ownerSession">>(
  deviations: readonly T[],
  sessionId: string | undefined,
): T[] {
  if (!sessionId) return [...deviations];
  return deviations.filter((deviation) => deviation.ownerSession === "" || deviation.ownerSession === sessionId);
}

/** Keep the most recently updated entries, at most `limit`. Pure: returns a new object. */
export function pruneResumeSessions(sessions: ResumeSessions, limit: number = RESUME_SESSION_LIMIT): ResumeSessions {
  const entries = Object.entries(sessions);
  if (entries.length <= limit) return { ...sessions };
  entries.sort(([, a], [, b]) => b.updatedAt.localeCompare(a.updatedAt));
  return Object.fromEntries(entries.slice(0, limit));
}
