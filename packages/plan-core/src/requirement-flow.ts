/**
 * Requirement application flows (P128(F025)/T490 — one coordinated
 * authority).
 *
 * Creating, updating and deleting declarative product Requirements is
 * domain orchestration, not harness behavior: one flow here serves the
 * MCP tools and the versioned HTTP API alike (AGENTS.md rule 19). Phase
 * links are validated against the canonical plan before any write; macro
 * tasks are reconciled by the canonical reconciler. Session-bound
 * attestation stays with the calling surface — these flows have no
 * session concept.
 */

import {
  createRequirementId,
  nowISO,
  reconcileRequirementMacroTasks,
  RequirementMacroTaskError,
  findPhaseByRef,
  type MacroTaskStatus,
  type PlanStore,
  type Requirement,
} from "./index.js";

/** Refusal codes shared by every requirement client surface. */
export type RequirementFlowRefusalCode =
  | "REQUIREMENT_PHASE_LINK_INVALID"
  | "REQUIREMENT_MACRO_TASK_INVALID"
  | "REQUIREMENT_NOT_FOUND";

/**
 * A typed refusal raised before any store mutation. Adapters map the
 * code to their own presentation; the code is the stable part.
 */
export class RequirementFlowRefusal extends Error {
  readonly code: RequirementFlowRefusalCode;

  constructor(code: RequirementFlowRefusalCode, message: string) {
    super(message);
    this.name = "RequirementFlowRefusal";
    this.code = code;
  }
}

export interface RequirementMacroTaskFlowInput {
  title: string;
  description?: string | undefined;
  status?: MacroTaskStatus | undefined;
}

export interface RequirementCreateFlowInput {
  title: string;
  description?: string | undefined;
  linkedPhaseIds: string[];
  macroTasks?: RequirementMacroTaskFlowInput[] | undefined;
}

/**
 * Resolve client-supplied phase refs (P00x | P00x(F00x) | UUID | title)
 * to canonical phase ids. At least one link is required.
 */
export async function resolveRequirementPhaseLinks(store: PlanStore, refs: string[] | undefined): Promise<string[]> {
  if (!refs || refs.length === 0) {
    throw new RequirementFlowRefusal("REQUIREMENT_PHASE_LINK_INVALID", "linkedPhaseIds must contain at least one phase reference.");
  }
  const [phases, features] = await Promise.all([store.loadAllPhases(), store.loadFeatures()]);
  const linkedPhaseIds: string[] = [];
  for (const rawRef of refs) {
    const ref = rawRef.trim();
    const phase = ref ? findPhaseByRef(phases, features.features, ref) : undefined;
    if (!phase) {
      throw new RequirementFlowRefusal("REQUIREMENT_PHASE_LINK_INVALID", `Linked phase not found: ${rawRef}`);
    }
    if (!linkedPhaseIds.includes(phase.id)) linkedPhaseIds.push(phase.id);
  }
  return linkedPhaseIds;
}

/** Create one requirement with planner-assigned ids and timestamps. */
export async function createRequirementFlow(store: PlanStore, input: RequirementCreateFlowInput): Promise<Requirement> {
  const linkedPhaseIds = await resolveRequirementPhaseLinks(store, input.linkedPhaseIds);
  const now = nowISO();
  let macroTasks: Requirement["macroTasks"];
  try {
    macroTasks = reconcileRequirementMacroTasks([], (input.macroTasks ?? []).map((task) => ({
      title: task.title,
      ...(task.description !== undefined ? { description: task.description } : {}),
      status: task.status ?? "planned",
    })), now);
  } catch (error) {
    throw new RequirementFlowRefusal(
      "REQUIREMENT_MACRO_TASK_INVALID",
      error instanceof RequirementMacroTaskError ? error.message : "Invalid macro tasks.",
    );
  }
  const requirement: Requirement = {
    id: createRequirementId(),
    title: input.title.trim(),
    description: input.description?.trim() ?? "",
    macroTasks,
    linkedPhaseIds,
    createdAt: now,
    updatedAt: now,
    sessionInfo: [],
  };
  await store.updateRequirements((document) => ({ requirements: [...document.requirements, requirement] }));
  await store.writeGenerated();
  return requirement;
}

export interface RequirementUpdateFlowInput {
  title?: string | undefined;
  description?: string | undefined;
  linkedPhaseIds?: string[] | undefined;
  macroTasks?: Array<{ id?: string | undefined; title: string; description?: string | undefined; status: MacroTaskStatus }> | undefined;
}

export interface RequirementUpdateOutcome {
  requirement: Requirement;
  updatedFields: string[];
}

/** Update title/description/links/macro-tasks; planner keeps ids and timestamps. */
export async function updateRequirementFlow(store: PlanStore, requirementId: string, input: RequirementUpdateFlowInput): Promise<RequirementUpdateOutcome> {
  const requirements = await store.loadRequirements();
  const current = requirements.requirements.find((requirement) => requirement.id === requirementId);
  if (!current) {
    throw new RequirementFlowRefusal("REQUIREMENT_NOT_FOUND", `Requirement not found: ${requirementId}`);
  }
  const updatedFields = [
    ...(input.title !== undefined ? ["title"] : []),
    ...(input.description !== undefined ? ["description"] : []),
    ...(input.linkedPhaseIds !== undefined ? ["linkedPhaseIds"] : []),
    ...(input.macroTasks !== undefined ? ["macroTasks"] : []),
  ];
  const linkedPhaseIds = input.linkedPhaseIds === undefined ? current.linkedPhaseIds : await resolveRequirementPhaseLinks(store, input.linkedPhaseIds);
  const now = nowISO();
  let next: Requirement;
  try {
    next = await store.updateRequirement(current.id, (canonical) => ({
      ...canonical,
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description.trim() } : {}),
      ...(input.linkedPhaseIds !== undefined ? { linkedPhaseIds } : {}),
      ...(input.macroTasks !== undefined ? { macroTasks: reconcileRequirementMacroTasks(canonical.macroTasks, input.macroTasks.map((task) => ({
        ...(task.id !== undefined ? { id: task.id } : {}),
        title: task.title,
        ...(task.description !== undefined ? { description: task.description } : {}),
        status: task.status,
      })), now) } : {}),
      updatedAt: now,
    }));
  } catch (error) {
    throw new RequirementFlowRefusal(
      "REQUIREMENT_MACRO_TASK_INVALID",
      error instanceof RequirementMacroTaskError ? error.message : "Invalid macro tasks.",
    );
  }
  await store.writeGenerated();
  return { requirement: next, updatedFields };
}

/** Permanently delete a top-level requirement. Returns false when absent. */
export async function deleteRequirementFlow(store: PlanStore, requirementId: string): Promise<{ deleted: boolean }> {
  let deleted = false;
  await store.updateRequirements((document) => {
    const requirements = document.requirements.filter((requirement) => requirement.id !== requirementId);
    deleted = requirements.length !== document.requirements.length;
    return deleted ? { requirements } : document;
  });
  if (deleted) await store.writeGenerated();
  return { deleted };
}
