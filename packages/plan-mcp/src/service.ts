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

import { resolve } from "node:path";
import { PlanStore, PlannerApiClient, PlannerApiError, SERVICE_PROTOCOL_VERSION, verifyLiveServiceEndpoint, withPlanServiceLock, type SessionRegistrationInput } from "@agent-plan/core";
import { readLiveServerRecord, serve } from "@agent-plan/server";
import type { ServeHandle, ServerRecord } from "@agent-plan/server";

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
/** Issued registration per root and transport, including registrations in flight. */
const sessionsByTransport = new Map<string, Promise<string>>();

function startupOf(handle: ServeHandle): PlannerServiceStartup {
  return {
    localUrl: handle.localUrl,
    lanUrl: handle.lanUrl,
    mode: handle.mode,
    bindHost: handle.bindHost,
  };
}

async function reusePlannerService(record: ServerRecord): Promise<PlannerServiceStartup> {
  const { bootId, protocolVersion, host, port, localUrl } = record;
  if (!bootId || protocolVersion !== SERVICE_PROTOCOL_VERSION || host !== "127.0.0.1"
    || localUrl !== `http://127.0.0.1:${port}`) {
    return { localUrl: "", error: "An incompatible planner service already owns this planner." };
  }
  const health = await verifyLiveServiceEndpoint({ bootId, protocolVersion, host, port }, {
    acceptedProtocolVersions: [SERVICE_PROTOCOL_VERSION],
  });
  if (!health.verified) {
    return { localUrl: "", error: `The advertised planner service could not be verified: ${health.reason}.` };
  }
  return { localUrl, mode: "local", bindHost: host, reused: true };
}

/**
 * Resolve the service for a plan root: a live one (ours or another program's)
 * is reused, otherwise `serve()` is started inside this process. Reuse keeps
 * several clients on one authority instead of one store per adapter.
 */
export async function ensurePlannerService(root: string): Promise<PlannerServiceStartup> {
  const canonicalRoot = resolve(root);
  if (ownedHandle && ownedRoot === canonicalRoot) return { ...startupOf(ownedHandle), reused: true };
  try {
    const live = await readLiveServerRecord(canonicalRoot);
    if (live) return await reusePlannerService(live);
    if (!(await new PlanStore(canonicalRoot).exists())) return { localUrl: "", error: "Planner workspace does not exist." };
    return await withPlanServiceLock(canonicalRoot, "startup", async () => {
      const winner = await readLiveServerRecord(canonicalRoot);
      if (winner) return reusePlannerService(winner);
      const candidate = await serve({ planRoot: canonicalRoot, port: 0, quiet: true });
      if (!candidate.advertised) {
        await candidate.close();
        const published = await readLiveServerRecord(canonicalRoot);
        return published ? reusePlannerService(published) : { localUrl: "", error: "The planner service could not publish its endpoint." };
      }
      ownedHandle = candidate;
      ownedRoot = canonicalRoot;
      return { ...startupOf(candidate), reused: false };
    });
  } catch (error) {
    return { localUrl: "", error: error instanceof Error ? error.message : String(error) };
  }
}

/** Running service for a root without starting one; null when none is reachable. */
export async function plannerServiceStatus(root: string): Promise<(PlannerServiceStartup & { owned: boolean }) | null> {
  if (ownedHandle && ownedRoot === resolve(root)) return { ...startupOf(ownedHandle), reused: true, owned: true };
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
  apiClient = null;
  // Issued sessions are persisted by the service, so they stay valid for a
  // later service on the same plan root: a restart must not silently change
  // the caller's identity (read receipts and ownership name that id).
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
/**
 * Forget issued sessions. Only a plan root that was replaced (init/repair)
 * invalidates them; a service restart does not.
 */
export function resetPlannerSessions(): void {
  sessionsByTransport.clear();
}

export async function plannerApiForSession(
  root: string,
  transportSessionId: string,
  registration: SessionRegistrationInput,
): Promise<{ client: PlannerApiClient; sessionId: string }> {
  const { baseUrl } = await plannerApi(root);
  const key = JSON.stringify([resolve(root), transportSessionId]);
  let issued = sessionsByTransport.get(key);
  if (!issued) {
    const registrationClient = new PlannerApiClient({ baseUrl });
    issued = registrationClient.registerSession({
      ...registration,
      displayName: registration.displayName ?? `mcp:${transportSessionId}`,
    }).then((session) => session.sessionId);
    sessionsByTransport.set(key, issued);
  }
  try {
    const sessionId = await issued;
    return { client: new PlannerApiClient({ baseUrl, sessionId }), sessionId };
  } catch (error) {
    if (sessionsByTransport.get(key) === issued) sessionsByTransport.delete(key);
    throw error;
  }
}
