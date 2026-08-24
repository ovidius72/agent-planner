import { expect, test as base, type APIRequestContext } from "@playwright/test";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type ServeHandle } from "../packages/plan-server/dist/index.js";
import { createPlannerFixture, seedFixture } from "../test/helpers/fixtures.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const webUiDist = join(root, "..", "packages", "plan-web-ui", "dist");

type Json = Record<string, unknown> | unknown[] | string | null;

export interface PlannerApi {
  request: (path: string, init?: RequestInit & { expectStatus?: number }) => Promise<{ status: number; body: Json }>;
}

export interface BrowserPlanner extends PlannerApi {
  root: string;
  planRoot: string;
  url: string;
  handle: ServeHandle;
  seed: (name: "empty" | "minimal" | "full" | "terminal" | "resume-needed" | "legacy-single-file") => Promise<void>;
}

export const test = base.extend<{ planner: BrowserPlanner }>({
  planner: async ({}, use, testInfo) => {
    const fixture = await createPlannerFixture({
      name: `playwright-${testInfo.project.name}-${testInfo.parallelIndex}-${testInfo.retry}`,
      seed: "empty",
    });
    let handle: ServeHandle | undefined;

    try {
      handle = await serve({
        planRoot: fixture.planRoot,
        port: 0,
        staticDir: webUiDist,
        quiet: true,
      });

      const request: PlannerApi["request"] = async (path, { expectStatus, ...init } = {}) => {
        const response = await fetch(`${handle!.url}/api${path}`, init);
        const text = await response.text();
        let body: Json = null;
        if (text) {
          try {
            body = JSON.parse(text) as Json;
          } catch {
            body = text;
          }
        }
        if (expectStatus !== undefined && response.status !== expectStatus) {
          throw new Error(`Expected ${init.method ?? "GET"} /api${path} to return ${expectStatus}; got ${response.status}: ${text}`);
        }
        if (expectStatus === undefined && !response.ok) {
          throw new Error(`${init.method ?? "GET"} /api${path} failed with ${response.status}: ${text}`);
        }
        return { status: response.status, body };
      };

      await use({
        root: fixture.root,
        planRoot: fixture.planRoot,
        url: handle.url,
        handle,
        request,
        seed: async (name) => seedFixture(fixture.store, name),
      });
    } finally {
      await handle?.close().catch(() => {});
      await rm(fixture.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  },
});

export { expect, type APIRequestContext };
