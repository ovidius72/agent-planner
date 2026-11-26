import { PlannerApiClient, PlannerApiError } from "./api-client.js";
import { compatibleServiceProtocols, readServiceEndpointRecord, verifyLiveServiceEndpoint } from "./service-endpoint.js";

export interface RegisteredWorkspaceScope {
  projectId: string;
  workspaceId: string;
}

export function resolveRegisteredWorkspace(client: PlannerApiClient, cwd: string): Promise<RegisteredWorkspaceScope> {
  return client.request("POST", "/projects/resolve", { cwd });
}

/** Resolve workspace API paths against the verified user authority. */
export async function registeredWorkspaceClient(cwd: string, home?: string) {
  const record = await readServiceEndpointRecord(home);
  if (record?.authority !== "registered-projects") {
    throw new PlannerApiError(503, "REGISTERED_SERVICE_UNAVAILABLE", "No registered project service is advertised for this user.");
  }
  const health = await verifyLiveServiceEndpoint(record, { acceptedProtocolVersions: compatibleServiceProtocols() });
  if (!health.verified) {
    throw new PlannerApiError(503, "REGISTERED_SERVICE_UNVERIFIED", `The registered project service could not be verified: ${health.reason}.`);
  }
  const client = new PlannerApiClient({ baseUrl: `http://${record.host}:${record.port}` });
  const scope = await resolveRegisteredWorkspace(client, cwd);
  const prefix = `/projects/${encodeURIComponent(scope.projectId)}/workspaces/${encodeURIComponent(scope.workspaceId)}`;
  return { client, scope, prefix };
}

/** One service-issued lease for the currently attached native harness session. */
export function createRegisteredSessionClient(clientKind: string) {
  let current: {
    nativeId: string; prefix: string; session: Promise<string>;
    cwd: string; heartbeat?: ReturnType<typeof setTimeout>;
  } | undefined;

  function clear() {
    if (current?.heartbeat) clearTimeout(current.heartbeat);
    current = undefined;
  }

  async function attach(cwd: string, nativeId: string) {
    const connection = await registeredWorkspaceClient(cwd);
    if (current?.nativeId !== nativeId || current.prefix !== connection.prefix) {
      clear();
      const target = {
        nativeId, prefix: connection.prefix, cwd,
        session: connection.client.request<{ sessionId: string }>("POST", `${connection.prefix}/sessions`, { clientKind })
          .then(({ sessionId }) => sessionId),
      };
      current = target;
      renew(target);
    }
    const entry = current;
    try {
      const sessionId = await entry.session;
      connection.client.useSession(sessionId);
      return { ...connection, sessionId };
    } catch (error) {
      if (current === entry) clear();
      throw error;
    }
  }

  function renew(entry: NonNullable<typeof current>): void {
    entry.heartbeat = setTimeout(async () => {
      try {
        const sessionId = await entry.session;
        const { client, prefix } = await registeredWorkspaceClient(entry.cwd);
        if (current === entry && prefix === entry.prefix) await client.request("POST", `${prefix}/sessions/${sessionId}/heartbeat`);
      } catch (error) {
        if (current === entry && error instanceof PlannerApiError && ["SESSION_EXPIRED", "SESSION_NOT_FOUND"].includes(error.code)) clear();
      } finally {
        if (current === entry) renew(entry);
      }
    }, 30_000).unref();
  }

  function handleFailure(error: unknown): void {
    if (error instanceof PlannerApiError && ["SESSION_EXPIRED", "SESSION_NOT_FOUND"].includes(error.code)) clear();
  }

  async function end(): Promise<void> {
    const entry = current;
    clear();
    if (!entry) return;
    try {
      const sessionId = await entry.session;
      const { client, prefix } = await registeredWorkspaceClient(entry.cwd);
      if (prefix === entry.prefix) await client.request("DELETE", `${prefix}/sessions/${sessionId}`);
    } catch {
      // Service-side expiry still releases the lease if the service is offline.
    }
  }

  return { attach, handleFailure, end };
}
