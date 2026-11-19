/**
 * Agent session registration (P128(F025)/T490 — session identity).
 *
 * The service issues the planner session id; clients never choose one.
 * Registration records integration provenance (adapter kind and version,
 * agent identity, capabilities) so context receipts, task ownership and
 * audit rows can name the caller. See docs/agent-brain/session-registration.md
 * for the full target contract; this flow implements the identity core and
 * leaves principal authentication to its own checklist item.
 *
 * Records live in worktree-local `.local/sessions.json`: runtime state,
 * never a second operational store.
 */

import { randomUUID } from "node:crypto";
import { nowISO } from "./plan-store.js";
import type { PlannerSessionRecord, PlanStore } from "./index.js";

/** Request header that carries the issued session id on later operations. */
export const PLANNER_SESSION_HEADER = "x-planner-session";
/** Live plus recent records kept on disk; older entries are pruned on write. */
export const MAX_REGISTERED_SESSIONS = 200;

export type SessionFlowRefusalCode =
  | "SESSION_CLIENT_KIND_REQUIRED"
  | "SESSION_NOT_FOUND"
  | "SESSION_ENDED";

export class SessionFlowRefusal extends Error {
  readonly code: SessionFlowRefusalCode;
  readonly details: Record<string, unknown>;

  constructor(code: SessionFlowRefusalCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "SessionFlowRefusal";
    this.code = code;
    this.details = details;
  }
}

export interface SessionRegistrationInput {
  /** Adapter kind: "mcp", "pi", "cli", "web", … */
  clientKind: string;
  clientVersion?: string | undefined;
  /** Logical agent identity. Defaults to the client kind when the adapter has none. */
  agentId?: string | undefined;
  displayName?: string | undefined;
  harnessId?: string | undefined;
  capabilities?: string[] | undefined;
}

export interface SessionRegistrationOutcome {
  session: PlannerSessionRecord;
}

function normalizedCapabilities(capabilities: readonly string[] | undefined): string[] {
  return [...new Set((capabilities ?? []).map((capability) => capability.trim()).filter(Boolean))];
}

/** Keep the newest records, live ones first, and cap the file. */
function pruned(records: readonly PlannerSessionRecord[]): PlannerSessionRecord[] {
  return [...records]
    .sort((left, right) => {
      const leftLive = left.endedAt ? 1 : 0;
      const rightLive = right.endedAt ? 1 : 0;
      return leftLive - rightLive || right.lastSeenAt.localeCompare(left.lastSeenAt);
    })
    .slice(0, MAX_REGISTERED_SESSIONS);
}

/** Register one caller and issue its planner session id. */
export async function registerPlannerSession(store: PlanStore, input: SessionRegistrationInput): Promise<SessionRegistrationOutcome> {
  const clientKind = input.clientKind?.trim() ?? "";
  if (!clientKind) {
    throw new SessionFlowRefusal("SESSION_CLIENT_KIND_REQUIRED", "clientKind is required to register a planner session.");
  }
  const manifest = await store.loadManifest();
  const timestamp = nowISO();
  const agentId = input.agentId?.trim() || clientKind;
  const session: PlannerSessionRecord = {
    sessionId: randomUUID(),
    projectId: manifest.projectId,
    clientKind,
    clientVersion: input.clientVersion?.trim() ?? "",
    agentId,
    displayName: input.displayName?.trim() || agentId,
    harnessId: input.harnessId?.trim() ?? "",
    capabilities: normalizedCapabilities(input.capabilities),
    contextEpoch: 1,
    registeredAt: timestamp,
    lastSeenAt: timestamp,
    endedAt: "",
    endReason: "",
  };
  const records = await store.loadPlannerSessions();
  await store.savePlannerSessions(pruned([...records, session]));
  return { session };
}

/** Resolve one live session; unknown or ended ids are refused. */
export async function resolvePlannerSession(store: PlanStore, sessionId: string): Promise<PlannerSessionRecord> {
  const normalized = sessionId.trim();
  const records = await store.loadPlannerSessions();
  const session = records.find((record) => record.sessionId === normalized);
  if (!session) {
    throw new SessionFlowRefusal("SESSION_NOT_FOUND", `Planner session not found: ${normalized}`, { sessionId: normalized });
  }
  if (session.endedAt) {
    throw new SessionFlowRefusal("SESSION_ENDED", `Planner session already ended: ${normalized}`, {
      sessionId: normalized,
      endedAt: session.endedAt,
    });
  }
  return session;
}

/** Record liveness; the adapter heartbeat calls this on its own timer. */
export async function heartbeatPlannerSession(store: PlanStore, sessionId: string): Promise<SessionRegistrationOutcome> {
  const session = await resolvePlannerSession(store, sessionId);
  const records = await store.loadPlannerSessions();
  const updated: PlannerSessionRecord = { ...session, lastSeenAt: nowISO() };
  await store.savePlannerSessions(pruned(records.map((record) => record.sessionId === updated.sessionId ? updated : record)));
  return { session: updated };
}

/** End one session. Ending an already-ended session is idempotent. */
export async function endPlannerSession(store: PlanStore, sessionId: string, reason?: string | undefined): Promise<SessionRegistrationOutcome> {
  const normalized = sessionId.trim();
  const records = await store.loadPlannerSessions();
  const existing = records.find((record) => record.sessionId === normalized);
  if (!existing) {
    throw new SessionFlowRefusal("SESSION_NOT_FOUND", `Planner session not found: ${normalized}`, { sessionId: normalized });
  }
  if (existing.endedAt) return { session: existing };
  const timestamp = nowISO();
  const ended: PlannerSessionRecord = {
    ...existing,
    endedAt: timestamp,
    endReason: reason?.trim() ?? "",
    lastSeenAt: timestamp,
  };
  await store.savePlannerSessions(pruned(records.map((record) => record.sessionId === ended.sessionId ? ended : record)));
  return { session: ended };
}
