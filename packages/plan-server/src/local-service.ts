import { resolve } from "node:path";
import { PlanStore, SERVICE_PROTOCOL_VERSION, verifyLiveServiceEndpoint, withPlanServiceLock } from "@agent-plan/core";
import { readLiveServerRecord, type ServerRecord } from "./server-record.js";
import { serve, type ServeHandle, type ServeOptions } from "./serve.js";

export class LocalPlannerServiceError extends Error {
  constructor(readonly code: "PLAN_NOT_FOUND" | "SERVICE_ENDPOINT_INCOMPATIBLE" | "SERVICE_ENDPOINT_UNVERIFIED" | "SERVICE_ENDPOINT_UNPUBLISHED", message: string) {
    super(message);
    this.name = "LocalPlannerServiceError";
  }
}

export async function verifyPlannerServerRecord(record: ServerRecord): Promise<ServerRecord> {
  const { bootId, protocolVersion, host, port, localUrl } = record;
  if (!bootId || protocolVersion !== SERVICE_PROTOCOL_VERSION || host !== "127.0.0.1"
    || localUrl !== `http://127.0.0.1:${port}`) {
    throw new LocalPlannerServiceError("SERVICE_ENDPOINT_INCOMPATIBLE", "An incompatible planner service already owns this planner.");
  }
  const health = await verifyLiveServiceEndpoint({ bootId, protocolVersion, host, port }, {
    acceptedProtocolVersions: [SERVICE_PROTOCOL_VERSION],
  });
  if (!health.verified) {
    throw new LocalPlannerServiceError("SERVICE_ENDPOINT_UNVERIFIED", `The advertised planner service could not be verified: ${health.reason}.`);
  }
  return record;
}

export type LocalPlannerConnection =
  | { reused: true; localUrl: string; record: ServerRecord }
  | { reused: false; localUrl: string; handle: ServeHandle };

/** Coordinate startup of the legacy root-scoped service across local clients. */
export async function connectLocalPlannerService(options: Omit<ServeOptions, "recordServer">): Promise<LocalPlannerConnection> {
  const planRoot = resolve(options.planRoot);
  const adopt = async (candidate: ServerRecord): Promise<LocalPlannerConnection> => {
    const record = await verifyPlannerServerRecord(candidate);
    return { reused: true, localUrl: record.localUrl, record };
  };
  const live = await readLiveServerRecord(planRoot);
  if (live) return adopt(live);
  if (!(await new PlanStore(planRoot).exists())) {
    throw new LocalPlannerServiceError("PLAN_NOT_FOUND", "Planner workspace does not exist.");
  }
  return withPlanServiceLock(planRoot, "startup", async () => {
    const winner = await readLiveServerRecord(planRoot);
    if (winner) return adopt(winner);
    const handle = await serve({ ...options, planRoot, recordServer: true });
    if (handle.advertised) return { reused: false, localUrl: handle.localUrl, handle };
    await handle.close();
    const published = await readLiveServerRecord(planRoot);
    if (published) return adopt(published);
    throw new LocalPlannerServiceError("SERVICE_ENDPOINT_UNPUBLISHED", "The planner service could not publish its endpoint.");
  });
}
