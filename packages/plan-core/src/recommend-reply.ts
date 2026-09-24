/**
 * Shared reply shaping for `planner-task-recommend` / `task_recommend`.
 *
 * Measured on this repository's own planner (P104(F005)/T419): the raw
 * result of `recommendNextWork` was 48,869 characters, because both
 * adapters spread `selection` whole into the reply. `selection.candidate`
 * carries full `Feature`/`Phase`/`Task` entities — every sibling task's
 * complete description and completion summary, every checklist, every
 * statusLog entry, the whole persisted handoff body — to answer a question
 * whose only useful payload is "which task, and why." The compact fields
 * this builder already assembles (`taskId`, `phaseId`, `featureId`,
 * `activeTask`, `nextFeature`, `nextPhase`, `nextTask`, `claims`) carry the
 * answer; nothing reads the fat.
 *
 * Placed in plan-core per AGENTS.md rule 4: both adapters call
 * `recommendNextWork` themselves (the pure selector stays adapter-visible
 * for their own routing), then hand the result here once so neither can
 * drift from the other. Follows the shape of handoff-reply.ts and
 * mutation-reply.ts: one `text`/`structured` reply, built once, consumed by
 * every adapter.
 */
import type { Feature } from "./schema.js";
import { featureNumberOfPhase, formatPhaseRef } from "./naming.js";
import type { NextWorkRecommendation, TaskCandidate } from "./task-selection.js";

export interface RecommendReply {
  text: string;
  structured: Record<string, unknown>;
}

/** What `selection.candidate` shrinks to: the composite ref and title a
 * caller acts on, not the full entities behind them. */
export interface RecommendationCandidateSummary {
  ref: string;
  taskId: string;
  phaseId: string;
  featureId?: string;
  title: string;
  status: string;
}

function compositeTaskRef(candidate: TaskCandidate, features: Feature[]): string {
  const featureNumber = featureNumberOfPhase(candidate.phase, features);
  return `${formatPhaseRef(candidate.phase.number, featureNumber)}/T${String(candidate.task.number).padStart(3, "0")}`;
}

function summarizeCandidate(candidate: TaskCandidate, features: Feature[]): RecommendationCandidateSummary {
  return {
    ref: compositeTaskRef(candidate, features),
    taskId: candidate.task.id,
    phaseId: candidate.phase.id,
    ...(candidate.feature?.id ? { featureId: candidate.feature.id } : {}),
    title: candidate.task.title,
    status: candidate.task.status,
  };
}

function renderClaimsText(claims: NextWorkRecommendation["claims"]): string {
  return claims.length
    ? `\nClaims:\n${claims.map((claim) => `- ${claim.kind} (${claim.source}): ${claim.ref || claim.title} — ${claim.reason}`).join("\n")}`
    : "";
}

/**
 * Build the reply for `planner-task-recommend` / `task_recommend`, covering
 * both the candidate and no-candidate branches through one shared shape.
 *
 * `kind`, `reason`, `taskId`, `phaseId`, `featureId`, `deviation`,
 * `activeTask`, `nextFeature`, `nextPhase`, `nextTask`, `claims`, and the
 * no-candidate branch's `activeTaskIds` keep their exact prior shape and
 * position — the lifecycle protocol and the recommendation claims contract
 * read those fields. Only `selection.candidate` (and, symmetrically,
 * `selection.activeCandidates` on the conflict branch) is replaced with
 * bounded summaries instead of full entities.
 */
export function buildRecommendationReply(result: NextWorkRecommendation, features: Feature[]): RecommendReply {
  const { selection } = result;
  const claimsText = renderClaimsText(result.claims);

  if (!selection.candidate) {
    const activeCandidates = selection.activeCandidates ?? [];
    return {
      text: `No work recommendation: ${selection.reason}${claimsText}`,
      structured: {
        kind: selection.kind,
        reason: selection.reason,
        activeTaskIds: activeCandidates.map((candidate) => candidate.task.id),
        activeTask: result.activeTask,
        nextFeature: result.nextFeature,
        nextPhase: result.nextPhase,
        nextTask: result.nextTask,
        claims: result.claims,
        selection: {
          kind: selection.kind,
          reason: selection.reason,
          deviation: selection.deviation,
          activeCandidates: activeCandidates.map((candidate) => summarizeCandidate(candidate, features)),
        },
      },
    };
  }

  const { candidate } = selection;
  const candidateSummary = summarizeCandidate(candidate, features);
  const activeLine = result.activeTask ? `Active task: ${result.activeTask.id} — ${result.activeTask.title}\n` : "";
  const deviationLine = selection.deviation ? `\nDeviation: ${selection.deviation.id}; resume target ${selection.deviation.resumeTaskId}.` : "";
  const text = `${activeLine}Next work (${selection.kind}): ${candidateSummary.ref} — ${candidate.task.title}\n${selection.reason}${deviationLine}${claimsText}`;

  return {
    text,
    structured: {
      kind: selection.kind,
      taskId: candidate.task.id,
      phaseId: candidate.phase.id,
      featureId: candidate.feature?.id,
      deviation: selection.deviation,
      activeTask: result.activeTask,
      nextFeature: result.nextFeature,
      nextPhase: result.nextPhase,
      nextTask: result.nextTask,
      claims: result.claims,
      selection: {
        kind: selection.kind,
        reason: selection.reason,
        deviation: selection.deviation,
        candidate: candidateSummary,
      },
    },
  };
}
