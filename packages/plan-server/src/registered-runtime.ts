import { connectRegisteredPlannerService } from "./registered-service.js";
import { SERVICE_PROTOCOL_VERSION, packageVersionFromModule } from "@agent-plan/core";

const home = process.argv[2];
const port = process.argv[3] === undefined ? undefined : Number(process.argv[3]);
if (home === "--probe") {
  const runtimeVersion = packageVersionFromModule(import.meta.url, "@agent-plan/server").version;
  console.log(JSON.stringify({ runtimeVersion, protocolVersion: SERVICE_PROTOCOL_VERSION }));
} else {
  try {
    const service = await connectRegisteredPlannerService({ home, port, dedicatedProcess: true });
    if (!service.reused) {
      const stop = () => { void service.close().finally(() => process.exit(0)); };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    }
    process.send?.({ ok: true, record: service.record }, () => { if (process.connected) process.disconnect?.(); });
  } catch (error) {
    process.exitCode = 1;
    process.send?.({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }, () => { if (process.connected) process.disconnect?.(); });
  }
}
