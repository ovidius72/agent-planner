import type { ProjectContextReply } from "./project-context.js";
import type { PlanWorkspace } from "./schema.js";
import { featureNumberOfPhase, formatFeatureRef, formatPhaseRef } from "./naming.js";
import { buildBoundedAcceptedDecisionContext } from "./task-context.js";

/**
 * Reply shaping for an explicit planner load, shared by every adapter
 * (MCP planner-load, Pi's planner-load tool and /planner load command).
 *
 * Every piece is sent once, in one text the agent reads top to bottom: the
 * recap to show the user, then the agent-only context. `structured` carries
 * only status fields; hosts that show the agent only structured content
 * still get the text because the MCP server folds it in.
 */

/** How the planner operating guide reaches the agent on this load. */
export type PlannerGuideDelivery =
  /** The guide body is included (a host with no other way to deliver it). */
  | { mode: "include"; content: string; customized: boolean; message: string }
  /** The host already delivers the guide (e.g. Claude Code's /planner
   * command); send only where it lives, never the body again. */
  | { mode: "pointer"; path: string; customized: boolean; message: string };

export interface PlannerLoadReplyInput {
  recap: string;
  projectContext: ProjectContextReply;
  /** Accepted Decisions below project scope (feature/phase/task). Project
   * decisions are already inside the project context. */
  scopedDecisions?: { content: string; total: number; truncated: boolean };
  plannerGuide: PlannerGuideDelivery;
}

export interface PlannerLoadReply {
  text: string;
  structured: Record<string, unknown>;
}

export const PLANNER_LOAD_RECAP_HEADING = "## Recap — show this to the user verbatim";
export const PLANNER_LOAD_AGENT_HEADING = "## Agent-only context — read and keep it; never quote it in the recap";

/** Split a load reply's text back into the recap the user sees and the
 * agent-only context. Any client (or test) that must show only the recap
 * uses this instead of guessing at the layout. */
export function splitPlannerLoadText(text: string): { recap: string; agentContext: string } {
  const agentAt = text.indexOf(PLANNER_LOAD_AGENT_HEADING);
  const recapStart = text.startsWith(PLANNER_LOAD_RECAP_HEADING) ? PLANNER_LOAD_RECAP_HEADING.length : 0;
  if (agentAt < 0) return { recap: text.slice(recapStart).trim(), agentContext: "" };
  return { recap: text.slice(recapStart, agentAt).trim(), agentContext: text.slice(agentAt + PLANNER_LOAD_AGENT_HEADING.length).trim() };
}

export function buildPlannerLoadReply(input: PlannerLoadReplyInput): PlannerLoadReply {
  const guide = input.plannerGuide;
  const guideBlock = guide.mode === "include"
    ? ["### Agent Plan operating guide", guide.customized ? guide.message : "", guide.content].filter(Boolean).join("\n\n")
    : [
      "### Agent Plan operating guide",
      `Follow the Agent Plan operating guide. If it is not already in this conversation (the /planner command includes it), read ${guide.path}.`,
      guide.customized ? guide.message : "",
    ].filter(Boolean).join("\n");

  const blocks = [
    PLANNER_LOAD_RECAP_HEADING,
    input.recap,
    PLANNER_LOAD_AGENT_HEADING,
    "### Project context",
    input.projectContext.text,
  ];
  if (input.scopedDecisions && input.scopedDecisions.total > 0) {
    blocks.push("### Accepted decisions for features, phases and tasks", input.scopedDecisions.content);
  }
  blocks.push(guideBlock);

  return {
    text: blocks.join("\n\n"),
    structured: {
      loaded: true,
      projectContext: input.projectContext.structured,
      plannerGuide: guide.mode === "include"
        ? { mode: "include", customized: guide.customized }
        : { mode: "pointer", path: guide.path, customized: guide.customized },
      scopedDecisions: input.scopedDecisions
        ? { total: input.scopedDecisions.total, truncated: input.scopedDecisions.truncated }
        : { total: 0, truncated: false },
    },
  };
}

/** Accepted Decisions owned by features, phases and tasks, bounded for a
 * load reply. Project decisions are left out: the project context already
 * carries them. */
export function buildScopedDecisionContext(plan: PlanWorkspace): { content: string; total: number; truncated: boolean } {
  const features = plan.features.features;
  const phaseRef = (phase: PlanWorkspace["phases"][number]) => formatPhaseRef(phase.number, featureNumberOfPhase(phase, features));
  const { content, total, truncated } = buildBoundedAcceptedDecisionContext([
    ...features.map((feature) => ({ scope: `feature ${formatFeatureRef(feature.number)}`, decisions: feature.acceptedDecisions })),
    ...plan.phases.map((phase) => ({ scope: `phase ${phaseRef(phase)}`, decisions: phase.acceptedDecisions })),
    ...plan.phases.flatMap((phase) => phase.tasks.map((task) => ({
      scope: `task ${phaseRef(phase)}/T${String(task.number).padStart(3, "0")}`,
      decisions: task.acceptedDecisions,
    }))),
  ]);
  return { content, total, truncated };
}
