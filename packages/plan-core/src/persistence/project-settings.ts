import { z } from "zod";
import { normalizeDescriptionRef } from "../payload-fallback.js";
import { ProjectGuidelinesSchema, ProjectSchema, WorkflowRulesSchema } from "../schema.js";
import { CommandRefusal, executeCommand, publishEvent } from "./command-authority.js";
import type { PersistenceDriver } from "./driver.js";
import type { ProjectCaller } from "./project-access.js";

const text = z.string().trim();
const list = z.array(text).transform((items) => items.filter(Boolean));
const patchSchema = z.object({
  name: text.min(1).optional(), goal: text.optional(), description: text.optional(),
  contentLanguage: text.optional(), chatLanguage: text.optional(),
  descriptionRef: text.optional(), scope: list.optional(), outOfScope: list.optional(),
  technologies: list.optional(), tools: list.optional(), globalRules: list.optional(),
  projectGuidelines: z.object({ content: text }).optional(), expectedGuidelinesUpdatedAt: z.string().optional(),
}).strict();

export function readRegisteredGuidelines(driver: PersistenceDriver, projectId: string) {
  const row = driver.prepare("SELECT json_extract(metadata, '$.projectGuidelines') AS guidelines FROM projects WHERE id = ?").get(projectId);
  const guidelines = ProjectGuidelinesSchema.parse(JSON.parse(String(row?.guidelines ?? "{}")));
  return { projectGuidelines: { ...guidelines, sessionInfo: [] }, readRecorded: false };
}

export function updateRegisteredProject(driver: PersistenceDriver, caller: ProjectCaller, requestId: string, patch: unknown) {
  const { projectId } = caller;
  return executeCommand(driver, { projectId, requestId, operation: "project.update", payload: patch }, ({ recordRevision }) => {
    if (patch && typeof patch === "object" && ("decisions" in patch || "acceptedDecisions" in patch)) {
      const code = "decisions" in patch ? "LEGACY_DECISIONS_ARRAY_READ_ONLY" : "ACCEPTED_DECISION_RAW_REPLACEMENT_DISABLED";
      throw new CommandRefusal(code, "Use the accepted decision operations to change one decision.");
    }
    const parsed = patchSchema.safeParse(patch);
    if (!parsed.success) throw new CommandRefusal("INVALID_PROJECT_UPDATE", "Provide valid project fields.");
    const { expectedGuidelinesUpdatedAt, name, projectGuidelines, ...fields } = parsed.data;
    const updatedFields = Object.keys(parsed.data).filter((key) => key !== "expectedGuidelinesUpdatedAt");
    if (!updatedFields.length) throw new CommandRefusal("NO_MUTABLE_FIELDS_RECEIVED", "Provide fields to update.");
    const row = driver.prepare("SELECT name, metadata FROM projects WHERE id = ?").get(projectId);
    if (!row) throw new CommandRefusal("PROJECT_NOT_FOUND", "The registered project could not be resolved.");
    const metadata = JSON.parse(String(row.metadata)) as Record<string, unknown>;
    const current = readRegisteredGuidelines(driver, projectId).projectGuidelines;
    if (expectedGuidelinesUpdatedAt !== undefined && expectedGuidelinesUpdatedAt !== current.updatedAt) {
      throw new CommandRefusal("PLAN_STALE_WRITE", "The Project Guidelines have changed. Reload before applying edits.");
    }
    const descriptionRef = fields.descriptionRef === undefined ? metadata.descriptionRef : normalizeDescriptionRef(fields.descriptionRef);
    const previous = Date.parse(current.updatedAt);
    const now = new Date(Math.max(Date.now(), Number.isFinite(previous) ? previous + 1 : 0)).toISOString();
    const next = { ...metadata, ...fields, descriptionRef,
      ...(projectGuidelines !== undefined ? { projectGuidelines: { content: projectGuidelines.content, updatedAt: now, sessionInfo: [] } } : {}) };
    const project = ProjectSchema.parse({
      workflowRules: WorkflowRulesSchema.parse({}), ...next, name: name ?? row.name,
      acceptedDecisions: [], workDeviations: [],
    });
    driver.prepare("UPDATE projects SET name = ?, metadata = ? WHERE id = ?").run(project.name, JSON.stringify(next), projectId);
    recordRevision();
    publishEvent(driver, projectId, "project.updated", { updatedFields });
    return { project, updatedFields, projectGuidelines: project.projectGuidelines, cleared: project.projectGuidelines.content === "" };
  }, caller);
}
