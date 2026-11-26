import { execFile, fork } from "node:child_process";
import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import {
  PlannerApiError,
  compatibleServiceProtocols,
  readServiceEndpointRecord,
  registeredWorkspaceClient,
  serviceRuntimeDir,
  verifyLiveServiceEndpoint,
  withPlanServiceLock,
} from "@agent-plan/core";
import { compareRuntimeVersions, selectRegisteredRuntime, stageInstalledRegisteredRuntime } from "./installed-runtime.js";

const runFile = promisify(execFile);

async function verifiedRecord(home: string) {
  const record = await readServiceEndpointRecord(home);
  if (!record) return undefined;
  const checked = await verifyLiveServiceEndpoint(record, { acceptedProtocolVersions: compatibleServiceProtocols() });
  if (checked.verified && record.authority === "registered-projects") return record;
  if (!checked.verified && checked.reason === "unreachable") return undefined;
  throw new PlannerApiError(409, "REGISTERED_SERVICE_INCOMPATIBLE", "The advertised planner service is live but incompatible.");
}

/** Start a registered service outside the calling harness, or adopt a live boot. */
export async function ensureRegisteredPlannerRuntime(home = homedir(), port?: number) {
  return withPlanServiceLock(serviceRuntimeDir(home), "launcher", async () => {
    await stageInstalledRegisteredRuntime(home);
    const runtime = await selectRegisteredRuntime(home);
    const existing = await verifiedRecord(home);
    if (existing) {
      if (!existing.runtimeVersion || compareRuntimeVersions(runtime.version, existing.runtimeVersion) <= 0) return existing;
      await verifyUpgradeCandidate(runtime);
      try {
        await stopDedicatedRuntime(home, existing);
      } catch (error) {
        if (error instanceof PlannerApiError && error.code === "REGISTERED_SERVICE_NOT_DEDICATED") return existing;
        throw error;
      }
    }
    return startRuntime(home, runtime, existing?.port ?? port);
  });
}

async function verifyUpgradeCandidate(runtime: Awaited<ReturnType<typeof selectRegisteredRuntime>>): Promise<void> {
  try {
    const { stdout } = await runFile(runtime.executable, [runtime.entry, "--probe"], { timeout: 3_000, maxBuffer: 32 * 1024 });
    const candidate = JSON.parse(stdout) as { runtimeVersion?: unknown; protocolVersion?: unknown };
    if (candidate.runtimeVersion === runtime.version && typeof candidate.protocolVersion === "string"
      && compatibleServiceProtocols(candidate.protocolVersion).some((protocol) => compatibleServiceProtocols().includes(protocol))) return;
  } catch {
    // Keep the verified existing boot running if its replacement cannot load.
  }
  throw new PlannerApiError(409, "REGISTERED_RUNTIME_CANDIDATE_UNVERIFIED", `Planner runtime ${runtime.version} failed its startup probe.`);
}

async function startRuntime(home: string, runtime: Awaited<ReturnType<typeof selectRegisteredRuntime>>, port?: number) {
  const started = await new Promise<{ message?: string }>((resolve) => {
    const child = fork(runtime.entry, port === undefined ? [home] : [home, String(port)], {
      execPath: runtime.executable, detached: true, execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    const timeout = setTimeout(() => {
      if (child.connected) child.disconnect();
      resolve({ message: "The registered service did not announce readiness." });
    }, 8_000);
    child.unref();
    child.once("message", (message: unknown) => {
      clearTimeout(timeout);
      if (typeof message === "object" && message && "ok" in message && message.ok === true) resolve({});
      else {
        const reason = typeof message === "object" && message && "message" in message && typeof message.message === "string"
          ? message.message : "The registered service did not start.";
        resolve({ message: reason });
      }
    });
    child.once("error", (error) => { clearTimeout(timeout); resolve({ message: error.message }); });
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve({ message: "The registered runtime exited before becoming ready." });
    });
  });
  const record = await verifiedRecord(home);
  if (record) return record;
  throw new PlannerApiError(503, "REGISTERED_SERVICE_UNAVAILABLE", started.message ?? "The registered runtime has no verifiable endpoint.");
}


/** Stop a verified dedicated runtime. Embedded authorities have their own owner. */
export async function stopRegisteredPlannerRuntime(home = homedir()): Promise<boolean> {
  return withPlanServiceLock(serviceRuntimeDir(home), "launcher", async () => {
    const record = await verifiedRecord(home);
    if (!record) return false;
    await stopDedicatedRuntime(home, record);
    return true;
  });
}

export async function registeredDashboardInfo(cwd: string, action: "start" | "stop" | "status", port?: number) {
  if (action === "start") await ensureRegisteredPlannerRuntime(homedir(), port);
  try {
    const { client, scope } = await registeredWorkspaceClient(cwd);
    const localUrl = `${client.baseUrl}/board/${scope.projectId}/${scope.workspaceId}`;
    const details = { running: true, localUrl, address: localUrl, mode: "local", port: Number(new URL(localUrl).port) };
    return {
      text: action === "stop"
        ? `The shared service still serves the dashboard at ${localUrl}. Use agent-plan stop --user to shut down the service.`
        : `Planner dashboard: ${localUrl}`,
      details,
    };
  } catch (error) {
    if (!(error instanceof PlannerApiError)) throw error;
    if (action === "start") throw error;
    return { text: error.message, details: { running: false, localUrl: "", address: "", mode: "", port: 0, errorCode: error.code } };
  }
}

async function stopDedicatedRuntime(home: string, record: NonNullable<Awaited<ReturnType<typeof verifiedRecord>>>): Promise<void> {
  const health = await fetch(`http://${record.host}:${record.port}/health`, { signal: AbortSignal.timeout(1000), redirect: "error" });
  const body = await health.json() as { bootId?: string; runtimePid?: number };
  const pid = body.runtimePid;
  if (!health.ok || body.bootId !== record.bootId || typeof pid !== "number" || !Number.isSafeInteger(pid) || pid < 2 || pid === process.pid) {
    throw new PlannerApiError(409, "REGISTERED_SERVICE_NOT_DEDICATED", "Only a verified dedicated planner runtime can be stopped by this command.");
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error;
  }
  for (let attempt = 0; attempt < 65; attempt++) {
    const current = await readServiceEndpointRecord(home);
    if (current?.bootId !== record.bootId) return;
    await delay(100);
  }
  throw new PlannerApiError(503, "REGISTERED_SERVICE_STOP_TIMEOUT", "The dedicated planner runtime did not announce shutdown.");
}
