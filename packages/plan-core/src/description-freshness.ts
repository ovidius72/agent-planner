import { formatFeatureRef, formatPhaseRef } from "./naming.js";
import type { Feature, Phase, Task } from "./schema.js";

export type DescriptionFreshnessOwnerKind = "feature" | "phase";
export type DescriptionFreshnessChildKind = "phase" | "task";

export interface DescriptionFreshnessDiagnostic {
  ownerKind: DescriptionFreshnessOwnerKind;
  ownerId: string;
  ownerRef: string;
  state: "fresh" | "stale";
  ownerDescriptionUpdatedAt: string;
  newestChildKind: DescriptionFreshnessChildKind | null;
  newestChildId: string;
  newestChildRef: string;
  newestChildDescriptionUpdatedAt: string;
  reason: string;
}

export interface DescriptionReconciliationStep {
  ownerKind: DescriptionFreshnessOwnerKind;
  ownerId: string;
  ownerRef: string;
  causedByRef: string;
  reason: string;
  action: string;
}

export interface HierarchicalDescriptionFreshness {
  diagnostics: DescriptionFreshnessDiagnostic[];
  staleParentRefs: string[];
  reconciliationRequired: boolean;
  reconciliationPreview: DescriptionReconciliationStep[];
}

type DescriptionEntity = {
  id: string;
  createdAt: string;
  description: string;
  descriptionRef?: string | undefined;
  descriptionUpdatedAt?: string;
};

type ChildCandidate = {
  kind: DescriptionFreshnessChildKind;
  id: string;
  ref: string;
  revision: string;
};

function descriptionRevision(entity: DescriptionEntity): string {
  if (!entity.description.trim() && !entity.descriptionRef?.trim()) return "";
  return entity.descriptionUpdatedAt?.trim() || entity.createdAt;
}

function taskRef(task: Task, phase: Phase, featureNumber?: number): string {
  return `${formatPhaseRef(phase.number, featureNumber)}/T${String(task.number).padStart(3, "0")}`;
}

function newestChild(candidates: ChildCandidate[]): ChildCandidate | null {
  return candidates
    .filter((candidate) => candidate.revision)
    .sort((left, right) => right.revision.localeCompare(left.revision) || left.ref.localeCompare(right.ref))[0] ?? null;
}

function diagnostic(
  ownerKind: DescriptionFreshnessOwnerKind,
  owner: DescriptionEntity,
  ownerRef: string,
  child: ChildCandidate | null,
): DescriptionFreshnessDiagnostic {
  const ownerRevision = descriptionRevision(owner);
  const stale = child !== null && (!ownerRevision || child.revision > ownerRevision);
  const reason = stale
    ? `${ownerRef} description is older than ${child.ref}; review the child context and explicitly reconcile the parent description or descriptionRef.`
    : child
      ? `${ownerRef} description is at least as recent as its newest described child ${child.ref}.`
      : `${ownerRef} has no described child context requiring reconciliation.`;
  return {
    ownerKind,
    ownerId: owner.id,
    ownerRef,
    state: stale ? "stale" : "fresh",
    ownerDescriptionUpdatedAt: ownerRevision,
    newestChildKind: child?.kind ?? null,
    newestChildId: child?.id ?? "",
    newestChildRef: child?.ref ?? "",
    newestChildDescriptionUpdatedAt: child?.revision ?? "",
    reason,
  };
}

/**
 * Compute child-to-parent description freshness without mutating user-authored
 * prose. Reconciliation is intentionally leaf-to-root: stale phases first,
 * then their owning features.
 */
export function buildHierarchicalDescriptionFreshness(
  features: Feature[],
  phases: Phase[],
): HierarchicalDescriptionFreshness {
  const featureById = new Map(features.map((feature) => [feature.id, feature]));
  const phaseDiagnostics = phases.map((phase) => {
    const feature = phase.featureId ? featureById.get(phase.featureId) : undefined;
    const ref = formatPhaseRef(phase.number, feature?.number);
    const child = newestChild(phase.tasks.map((task) => ({
      kind: "task" as const,
      id: task.id,
      ref: taskRef(task, phase, feature?.number),
      revision: descriptionRevision(task),
    })));
    return diagnostic("phase", phase, ref, child);
  });

  const featureDiagnostics = features.map((feature) => {
    const ownedPhases = phases.filter((phase) => phase.featureId === feature.id);
    const candidates: ChildCandidate[] = [];
    for (const phase of ownedPhases) {
      const phaseRef = formatPhaseRef(phase.number, feature.number);
      candidates.push({ kind: "phase", id: phase.id, ref: phaseRef, revision: descriptionRevision(phase) });
      for (const task of phase.tasks) {
        candidates.push({ kind: "task", id: task.id, ref: taskRef(task, phase, feature.number), revision: descriptionRevision(task) });
      }
    }
    return diagnostic("feature", feature, formatFeatureRef(feature.number), newestChild(candidates));
  });

  const diagnostics = [...phaseDiagnostics, ...featureDiagnostics];
  const stale = diagnostics.filter((entry) => entry.state === "stale");
  return {
    diagnostics,
    staleParentRefs: stale.map((entry) => entry.ownerRef),
    reconciliationRequired: stale.length > 0,
    reconciliationPreview: stale.map((entry) => ({
      ownerKind: entry.ownerKind,
      ownerId: entry.ownerId,
      ownerRef: entry.ownerRef,
      causedByRef: entry.newestChildRef,
      reason: entry.reason,
      action: `Read ${entry.newestChildRef}, review ${entry.ownerRef}, then explicitly update ${entry.ownerRef}'s description or descriptionRef if the parent prose is stale.`,
    })),
  };
}

export function freshnessForOwner(
  freshness: HierarchicalDescriptionFreshness,
  ownerKind: DescriptionFreshnessOwnerKind,
  ownerId: string,
): DescriptionFreshnessDiagnostic | undefined {
  return freshness.diagnostics.find((entry) => entry.ownerKind === ownerKind && entry.ownerId === ownerId);
}
