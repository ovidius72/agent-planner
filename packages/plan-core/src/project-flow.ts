/**
 * Project-level settings flows shared by every surface.
 *
 * The planner project carries a small set of operator-owned settings:
 * the canonical Project Guidelines text agents must read, and the
 * preferred content/chat languages. Both are single-record updates on
 * `project.json`; no entity rollup is involved.
 */

import { PlanStoreError } from "./plan-store.js";
import type { PlanStore } from "./plan-store.js";
import type { Project } from "./index.js";
import type { ProjectGuidelinesSchema } from "./schema.js";
import type { z } from "zod";

type ProjectGuidelines = z.infer<typeof ProjectGuidelinesSchema>;

export type ProjectRefusalCode = "PLAN_STALE_WRITE" | "PROJECT_UPDATE_FAILED";

export interface ProjectRefusal {
  ok: false;
  code: ProjectRefusalCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface UpdateProjectGuidelinesInput {
  content: string;
  /** Optimistic guard: the guidelines timestamp the caller last observed. */
  expectedGuidelinesUpdatedAt?: string | undefined;
}

export interface ProjectGuidelinesSuccess {
  ok: true;
  projectGuidelines: ProjectGuidelines;
  /** True when the update emptied the section. */
  cleared: boolean;
}

/**
 * Replace the canonical Project Guidelines text. An empty string clears
 * the section; the store stamps `updatedAt` only when the content moved.
 */
export async function updateProjectGuidelinesFlow(
  store: PlanStore,
  input: UpdateProjectGuidelinesInput,
): Promise<ProjectGuidelinesSuccess | ProjectRefusal> {
  let project: Project;
  try {
    project = await store.updateProject((current) => ({
      ...current,
      projectGuidelines: { ...current.projectGuidelines, content: input.content.trim() },
    }), input.expectedGuidelinesUpdatedAt === undefined
      ? {}
      : { expectedGuidelinesUpdatedAt: input.expectedGuidelinesUpdatedAt });
  } catch (error) {
    return projectFailure(error);
  }
  await store.writeGenerated();
  return {
    ok: true,
    projectGuidelines: project.projectGuidelines,
    cleared: project.projectGuidelines.content.length === 0,
  };
}

export interface UpdateProjectLanguageInput {
  contentLanguage?: string | undefined;
  chatLanguage?: string | undefined;
}

export interface ProjectLanguageSuccess {
  ok: true;
  project: Project;
  contentLanguage: string;
  chatLanguage: string;
}

/** Persist the preferred languages; omitted fields keep their value. */
export async function updateProjectLanguageFlow(
  store: PlanStore,
  input: UpdateProjectLanguageInput,
): Promise<ProjectLanguageSuccess | ProjectRefusal> {
  let project: Project;
  try {
    project = await store.updateProject((current) => ({
      ...current,
      ...(input.contentLanguage !== undefined ? { contentLanguage: input.contentLanguage.trim() } : {}),
      ...(input.chatLanguage !== undefined ? { chatLanguage: input.chatLanguage.trim() } : {}),
    }));
  } catch (error) {
    return projectFailure(error);
  }
  await store.writeGenerated();
  return {
    ok: true,
    project,
    contentLanguage: project.contentLanguage,
    chatLanguage: project.chatLanguage,
  };
}

function projectFailure(error: unknown): ProjectRefusal {
  const rawCode = error instanceof PlanStoreError && typeof error.details?.errorCode === "string"
    ? error.details.errorCode
    : "";
  return {
    ok: false,
    code: rawCode === "PLAN_STALE_WRITE" ? "PLAN_STALE_WRITE" : "PROJECT_UPDATE_FAILED",
    message: error instanceof Error ? error.message : "Project update failed.",
    ...(error instanceof PlanStoreError && error.details ? { details: error.details } : {}),
  };
}
