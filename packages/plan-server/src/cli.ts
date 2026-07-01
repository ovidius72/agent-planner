import { existsSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "./serve.js";

const plannerRoot = resolve(process.cwd(), ".planner");
const legacyRoot = resolve(process.cwd(), ".plan");

if (!process.env.PLAN_ROOT && !existsSync(resolve(plannerRoot, "manifest.json")) && existsSync(resolve(legacyRoot, "manifest.json")) && !existsSync(plannerRoot)) {
  renameSync(legacyRoot, plannerRoot);
  console.log("[plan-server] migrated legacy .plan/ directory to .planner/");
}

const planRoot = process.env.PLAN_ROOT ?? (
  existsSync(resolve(plannerRoot, "manifest.json"))
    ? plannerRoot
    : existsSync(resolve(legacyRoot, "manifest.json"))
      ? legacyRoot
      : plannerRoot
);
const port = parseInt(process.env.PLAN_PORT ?? "3030", 10);

serve({ port, planRoot })
  .then(({ url }) => {
    console.log(`[plan-server] running at ${url}`);
    console.log(`[plan-server] plan root: ${planRoot}`);
  })
  .catch((err: unknown) => {
    console.error("[plan-server] failed:", err);
    process.exit(1);
  });
