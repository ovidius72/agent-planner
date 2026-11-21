/**
 * MCP's connection to the local planner service (P128(F025)/T490 C3).
 *
 * The adapter is a stdio bridge: tools call the versioned application API
 * instead of opening the plan store. This module owns the two things the
 * adapter needs for that:
 *
 * - service resolution: reuse a live server for the plan root (the record
 *   `serve()` writes, whichever program started it), otherwise start one
 *   embedded in this process;
 * - the API client: one per plan root, with a registered session per MCP
 *   transport when an operation needs identity.
 *
 * It never reads or writes the plan store itself.
 */

import { PlanStore, PlannerApiClient, PlannerApiError, type SessionRegistrationInput } from "@agent-plan/core";
import { readLiveServerRecord, serve } from "@agent-plan/server";
import type { ServeHandle } from "@agent-plan/server";

export interface PlannerServiceStartup {
  localUrl: string;
  lanUrl?: string | undefined;
  mode?: string | undefined;
  bindHost?: string | undefined;
  error?: string | undefined;
  /** True when an already running service was adopted instead of started. */
  reused?: boolean | undefined;
}

let ownedHandle: ServeHandle | null = null;
let ownedRoot = "";
let apiClient: PlannerApiClient | null = null;
const sessionsByTransport = new Map<string, string>();

function startupOf(handle: ServeHandle): PlannerServiceStartup {
  return {
    localUrl: handle.localUrl,
    lanUrl: handle.lanUrl,
    mode: handle.mode,
    bindHost: handle.bindHost,
  };
}

/**
 * Resolve the service for a plan root: a live one (ours or another program's)
 * is reused, otherwise `serve()` is started inside this process. Reuse keeps
 * several clients on one authority instead of one store per adapter.
 */
export async function ensurePlannerService(root: string): Promise<PlannerServiceStartup> {
  if (ownedHandle && ownedRoot === root) return { ...startupOf(ownedHandle), reused: true };
  const live = await readLiveServerRecord(root).catch(() => null);
  if (live) {
    return {
      localUrl: live.localUrl,
      lanUrl: live.lanUrl ?? undefined,
      mode: "local",
      bindHost: live.host,
      reused: true,
    };
  }
  const st = new PlanStore(root);
  if (!(await st.exists())) return { localUrl: "", error: "Planner workspace does not exist." };
  try {
    ownedHandle = await serve({ planRoot: root, port: 0, quiet: true });
    ownedRoot = root;
    return { ...startupOf(ownedHandle), reused: false };
  } catch (error) {
    ownedHandle = null;
    ownedRoot = "";
    return { localUrl: "", error: error instanceof Error ? error.message : String(error) };
  }
}

/** Running service for a root without starting one; null when none is reachable. */
export async function plannerServiceStatus(root: string): Promise<(PlannerServiceStartup & { owned: boolean }) | null> {
  if (ownedHandle && ownedRoot === root) return { ...startupOf(ownedHandle), reused: true, owned: true };
  const live = await readLiveServerRecord(root).catch(() => null);
  return live ? { localUrl: live.localUrl, lanUrl: live.lanUrl ?? undefined, mode: "local", bindHost: live.host, reused: true, owned: false } : null;
}

/** Stop the service this process owns. A service started elsewhere is left alone. */
export async function stopPlannerService(): Promise<{ stopped: boolean; url: string; foreign: boolean }> {
  const handle = ownedHandle;
  if (!handle) {
    const live = ownedRoot ? await readLiveServerRecord(ownedRoot).catch(() => null) : null;
    return { stopped: false, url: live?.localUrl ?? "", foreign: Boolean(live) };
  }
  const url = handle.localUrl;
  ownedHandle = null;
  ownedRoot = "";
  await handle.close().catch(() => {});
  return { stopped: true, url, foreign: false };
}

/** API client for one plan root. Throws SERVICE_UNAVAILABLE when none can be reached. */
export async function plannerApi(root: string): Promise<PlannerApiClient> {
  const startup = await ensurePlannerService(root);
  if (!startup.localUrl) {
    throw new PlannerApiError(0, "SERVICE_UNAVAILABLE", startup.error ?? `No planner service is available for ${root}.`);
  }
  const baseUrl = startup.localUrl.replace(/\/+$/, "");
  if (!apiClient || apiClient.baseUrl !== baseUrl) {
    apiClient = new PlannerApiClient({ baseUrl });
  }
  return apiClient;
}

/**
 * API client with a service-issued session for one MCP transport. The session
 * is registered once per transport and reused; the returned id must be sent on
 * the calls that need identity (context reads, task lifecycle).
 */
export async function plannerApiForSession(
  root: string,
  transportSessionId: string,
  registration: SessionRegistrationInput,
): Promise<{ client: PlannerApiClient; sessionId: string }> {
  const client = await plannerApi(root);
  const existing = sessionsByTransport.get(transportSessionId);
  if (existing) return { client, sessionId: existing };
  const session = await client.registerSession({
    ...registration,
    displayName: registration.displayName ?? `mcp:${transportSessionId}`,
  });
  sessionsByTransport.set(transportSessionId, session.sessionId);
  return { client, sessionId: session.sessionId };
}
