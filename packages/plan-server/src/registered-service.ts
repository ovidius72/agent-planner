import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Server } from "node:http";
import { createAdaptorServer } from "@hono/node-server";
import { Hono } from "hono";
import {
  PLANNER_API_V2_BASE_PATH,
  PLANNER_API_V2_VERSION,
  SERVICE_PROTOCOL_VERSION,
  compatibleServiceProtocols,
  packageVersionFromModule,
  readServiceEndpointRecord,
  removeServiceEndpointRecord,
  serviceRuntimeDir,
  verifyLiveServiceEndpoint,
  withPlanServiceLock,
  writeServiceEndpointRecord,
  type ServiceEndpointRecord,
} from "@agent-plan/core";
import { plannerAdmission, type AuthStrategy } from "./auth.js";
import { createProjectApi } from "./project-api.js";
import { resolveBundledStaticDir } from "./serve.js";
import { attachProjectEvents } from "./project-events.js";

export interface RegisteredServiceOptions {
  home?: string | undefined;
  port?: number | undefined;
  dedicatedProcess?: boolean | undefined;
  auth?: AuthStrategy | undefined;
  allowedOrigins?: readonly string[] | undefined;
}

export type RegisteredServiceConnection =
  | { reused: true; url: string; record: ServiceEndpointRecord }
  | { reused: false; url: string; record: ServiceEndpointRecord; close(): Promise<void> };

const authority = "registered-projects";
const runtimeVersion = packageVersionFromModule(import.meta.url, "@agent-plan/server").version;

async function startRegisteredService(home: string, options: RegisteredServiceOptions): Promise<RegisteredServiceConnection> {
  let eventHub: ReturnType<typeof attachProjectEvents> | undefined;
  const projectApi = createProjectApi(home, (projectId) => eventHub?.notify(projectId));
  const bootId = randomUUID();
  const originRef = { current: undefined as string | undefined };
  const app = new Hono();
  app.use("*", plannerAdmission({ originRef, allowedOrigins: options.allowedOrigins, auth: options.auth }));
  app.get("/health", (c) => c.json({
    bootId, protocolVersion: SERVICE_PROTOCOL_VERSION, runtimeVersion, authority,
    acceptedProtocolVersions: compatibleServiceProtocols(),
    ...(options.dedicatedProcess ? { runtimePid: process.pid } : {}),
  }));
  app.get(PLANNER_API_V2_BASE_PATH, (c) => c.json({
    apiVersion: PLANNER_API_V2_VERSION,
    data: { bootId, protocolVersion: SERVICE_PROTOCOL_VERSION, runtimeVersion, acceptedProtocolVersions: compatibleServiceProtocols(),
      authority, scope: "/projects/{projectId}/workspaces/{workspaceId}" },
  }));
  app.route(`${PLANNER_API_V2_BASE_PATH}/projects`, projectApi.app);
  const staticDir = resolveBundledStaticDir();
  if (staticDir) {
    const mime = new Map([["js", "application/javascript"], ["css", "text/css"], ["svg", "image/svg+xml"],
      ["png", "image/png"], ["woff2", "font/woff2"]]);
    app.get("/assets/:file", async (c) => {
      const file = c.req.param("file");
      const contentType = mime.get(file.split(".").at(-1) ?? "");
      if (!contentType || !/^[A-Za-z0-9_.-]+$/.test(file)) return c.notFound();
      try {
        return new Response(await readFile(join(staticDir, "assets", file)), { headers: { "Content-Type": contentType } });
      } catch {
        return c.notFound();
      }
    });
    app.get("/board/:projectId/:workspaceId/*", async (c) => {
      const { projectId, workspaceId } = c.req.param();
      const verified = await app.request(
        `${PLANNER_API_V2_BASE_PATH}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}`,
        { headers: c.req.raw.headers },
      );
      if (!verified.ok) return verified;
      return new Response(await readFile(join(staticDir, "index.html")), { headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } });
    });
  }
  const host = "127.0.0.1";
  const server = createAdaptorServer({ fetch: app.fetch, hostname: host });
  eventHub = attachProjectEvents({
    server: server as Server, bootId, originRef, allowedOrigins: options.allowedOrigins ?? [], fetch: app.fetch,
  });
  const closeHttp = () => new Promise<void>((resolve) => {
    server.close(() => resolve());
    if ("closeAllConnections" in server) server.closeAllConnections();
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once("error", onError);
      server.listen(options.port ?? 0, host, () => {
        server.off("error", onError);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The registered planner service has no TCP address.");
    const record = { bootId, protocolVersion: SERVICE_PROTOCOL_VERSION, runtimeVersion, authority, host, port: address.port } as const;
    const url = `http://${host}:${address.port}`;
    originRef.current = url;
    await writeServiceEndpointRecord(record, home);
    let closing: Promise<void> | undefined;
    return {
      reused: false, url, record,
      close() {
        closing ??= withPlanServiceLock(serviceRuntimeDir(home), "startup", async () => {
          eventHub?.close();
          await projectApi.close();
          await closeHttp();
          await removeServiceEndpointRecord(record, home);
        });
        return closing;
      },
    };
  } catch (error) {
    eventHub.close();
    await projectApi.close();
    await closeHttp();
    throw error;
  }
}

/** Start or reuse one registered project authority for this OS user. */
export async function connectRegisteredPlannerService(options: RegisteredServiceOptions = {}): Promise<RegisteredServiceConnection> {
  const home = options.home ?? homedir();
  return withPlanServiceLock(serviceRuntimeDir(home), "startup", async () => {
    const record = await readServiceEndpointRecord(home);
    if (record) {
      const health = await verifyLiveServiceEndpoint(record, { acceptedProtocolVersions: compatibleServiceProtocols() });
      if (health.verified && record.authority === authority) return { reused: true, url: `http://${record.host}:${record.port}`, record };
      if (health.verified || health.reason !== "unreachable") {
        throw new Error("An advertised planner service is live but its authority or protocol is incompatible.");
      }
    }
    return startRegisteredService(home, options);
  });
}
