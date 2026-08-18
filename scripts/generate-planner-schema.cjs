#!/usr/bin/env node
"use strict";

/**
 * Generate docs/planner-schema.json from the canonical Zod schemas in
 * @agent-plan/core. Run this whenever schema.ts changes and commit the
 * generated JSON alongside the code change.
 */

const { zodToJsonSchema } = require("zod-to-json-schema");
const { PlanWorkspaceSchema } = require("../packages/plan-core/dist/index.js");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const outPath = join(root, "docs", "planner-schema.json");

const schema = zodToJsonSchema(PlanWorkspaceSchema, { name: "PlanWorkspace", $refStrategy: "relative" });
schema.$schema = "http://json-schema.org/draft-07/schema#";
schema.title = "Agent Plan .planner/ Workspace Schema";
schema.description = "Public JSON schema for the Agent Plan .planner/ directory.";

writeFileSync(outPath, JSON.stringify(schema, null, 2) + "\n", "utf-8");
console.log(`Wrote ${outPath}`);
