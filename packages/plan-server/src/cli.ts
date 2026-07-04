import { resolve } from "node:path";
import { serve } from "./serve.js";

const plannerRoot = resolve(process.cwd(), ".planner");
const planRoot = process.env.PLAN_ROOT ?? plannerRoot;
const port = parseInt(process.env.PLAN_PORT ?? "3030", 10);
const host = process.env.PLAN_HOST ?? "127.0.0.1";

serve({ port, planRoot, host })
  .then(({ url }) => {
    console.log(`[plan-server] running at ${url}`);
    console.log(`[plan-server] plan root: ${planRoot}`);
  })
  .catch((err: unknown) => {
    console.error("[plan-server] failed:", err);
    process.exit(1);
  });
