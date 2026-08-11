import type { Phase, Requirement } from "./types";

export type RequirementPhaseGroup = {
  phase: Phase;
  requirements: Requirement[];
};

/**
 * Group a filtered requirement set by its valid phase links.
 * A requirement linked to multiple phases intentionally appears in each group;
 * links with no live phase are surfaced in the unlinked fallback rather than
 * disappearing from the Requirements page.
 */
export function groupRequirementsByPhase(
  requirements: Requirement[],
  phases: Phase[],
): { phaseGroups: RequirementPhaseGroup[]; unlinkedRequirements: Requirement[] } {
  const phaseIds = new Set(phases.map((phase) => phase.id));
  const phaseGroups = phases
    .map((phase) => ({
      phase,
      requirements: requirements.filter((requirement) => requirement.linkedPhaseIds.includes(phase.id)),
    }))
    .filter((group) => group.requirements.length > 0)
    .sort((left, right) => (left.phase.priority - right.phase.priority) || (left.phase.number - right.phase.number));

  const unlinkedRequirements = requirements.filter(
    (requirement) => !requirement.linkedPhaseIds.some((phaseId) => phaseIds.has(phaseId)),
  );

  return { phaseGroups, unlinkedRequirements };
}
