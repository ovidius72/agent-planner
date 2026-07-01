import type { AcceptedDecision, Feature, Phase, PlanWorkspace, Requirement } from "./schema.js";

function bullet(lines: string[], indent = 0): string {
  return lines.length > 0
    ? lines.map((l) => `${"  ".repeat(indent)}- ${l}`).join("\n")
    : `${"  ".repeat(indent)}- _none_`;
}

function statusBadge(status: string): string {
  const icons: Record<string, string> = {
    draft: "📄",
    discovery: "🔍",
    planned: "📋",
    "in-progress": "🚧",
    done: "✅",
    blocked: "🚫",
    canceled: "❌",
  };
  return `${icons[status] ?? "❓"} \`${status}\``;
}

function statusIcon(status: string): string {
  const icons: Record<string, string> = {
    planned: "📋",
    "in-progress": "🚧",
    done: "✅",
    blocked: "🚫",
    canceled: "❌",
  };
  return icons[status] ?? "❓";
}

function renderAcceptedDecisions(decisions: AcceptedDecision[]): string[] {
  const lines: string[] = [];
  for (const entry of decisions) {
    lines.push(`- **${entry.title}**`);
    if (entry.decision) lines.push(`  - Decision: ${entry.decision}`);
    if (entry.rationale) lines.push(`  - Rationale: ${entry.rationale}`);
    if (entry.implementationNotes) lines.push(`  - Implementation: ${entry.implementationNotes}`);
    lines.push(`  - Accepted at: ${entry.acceptedAt}`);
  }
  return lines;
}

export class PlanRenderer {
  renderPlan(plan: PlanWorkspace): string {
    const { project, manifest, features, requirements, phases } = plan;
    const lines: string[] = [];

    lines.push(`# ${project.name} — Project Plan`);
    lines.push("");
    lines.push(`> ${project.goal || "*Goal not defined yet.*"}`);
    if (project.description) {
      lines.push("");
      lines.push(project.description);
    }
    lines.push("");
    lines.push(`**Last updated:** ${manifest.updatedAt}`);
    lines.push(`**Version:** ${manifest.schemaVersion}`);
    lines.push(`**Project ID:** \`${manifest.projectId}\``);
    lines.push("");
    lines.push("---");
    lines.push("");

    // ── Scope ────────────────────────────────────────────────────────
    if (project.scope.length > 0 || project.outOfScope.length > 0) {
      lines.push("## Scope");
      lines.push("");
      if (project.scope.length > 0) {
        lines.push("### In scope");
        lines.push(bullet(project.scope));
        lines.push("");
      }
      if (project.outOfScope.length > 0) {
        lines.push("### Out of scope");
        lines.push(bullet(project.outOfScope));
        lines.push("");
      }
    }

    // ── Stack & Tools ────────────────────────────────────────────────
    if (project.technologies.length > 0 || project.tools.length > 0) {
      lines.push("## Stack & Tools");
      lines.push("");
      if (project.technologies.length > 0) {
        lines.push("### Technologies");
        lines.push(bullet(project.technologies));
        lines.push("");
      }
      if (project.tools.length > 0) {
        lines.push("### Tools");
        lines.push(bullet(project.tools));
        lines.push("");
      }
    }

    // ── Decisions ────────────────────────────────────────────────────
    if (project.decisions.length > 0) {
      lines.push("## Architectural Decisions");
      lines.push("");
      lines.push(bullet(project.decisions));
      lines.push("");
    }
    if (project.acceptedDecisions.length > 0) {
      lines.push("## Accepted Decisions");
      lines.push("");
      lines.push(...renderAcceptedDecisions(project.acceptedDecisions));
      lines.push("");
    }

    // ── Global Rules ─────────────────────────────────────────────────
    if (project.globalRules.length > 0) {
      lines.push("## Global Rules");
      lines.push("");
      lines.push(bullet(project.globalRules));
      lines.push("");
    }

    // ── Workflow Rules ───────────────────────────────────────────────
    const wr = project.workflowRules;
    lines.push("## Workflow Rules");
    lines.push("");
    if (wr.beforePhaseStart.length > 0) {
      lines.push("### Before phase start");
      lines.push(bullet(wr.beforePhaseStart));
      lines.push("");
    }
    if (wr.beforeTaskStart.length > 0) {
      lines.push("### Before task start");
      lines.push(bullet(wr.beforeTaskStart));
      lines.push("");
    }
    if (wr.afterPhaseComplete.length > 0) {
      lines.push("### After phase complete");
      lines.push(bullet(wr.afterPhaseComplete));
      lines.push("");
    }

    // ── Features ────────────────────────────────────────────────────
    if (features.features.length > 0) {
      lines.push("---");
      lines.push("## Features");
      lines.push("");
      for (const feature of features.features) {
        lines.push(`### ${statusIcon(feature.status)} ${feature.id} — ${feature.name}`);
        if (feature.description) lines.push("", feature.description);
        lines.push("");
        lines.push(`Status: ${statusBadge(feature.status)}`);
        const featurePhases = phases.filter((p) => feature.phaseIds.includes(p.id));
        if (featurePhases.length > 0) {
          lines.push("");
          lines.push("**Phases:**");
          for (const fp of featurePhases) {
            const doneTasks = fp.tasks.filter((t) => t.status === "done").length;
            lines.push(`- ${statusIcon(fp.status)} **${fp.id}** ${fp.title} (${doneTasks}/${fp.tasks.length} tasks)`);
          }
        }
        if (feature.workDone) lines.push("", `**Work done:** ${feature.workDone}`);
        if (feature.workRemaining) lines.push("", `**Work remaining:** ${feature.workRemaining}`);
        if (feature.acceptedDecisions.length > 0) {
          lines.push("");
          lines.push("**Accepted decisions:**");
          lines.push(...renderAcceptedDecisions(feature.acceptedDecisions));
        }
        lines.push("");
      }
    }

    // ── Requirements ─────────────────────────────────────────────────
    lines.push("---");
    lines.push("## Requirements");
    lines.push("");
    if (requirements.requirements.length === 0) {
      lines.push("_No requirements defined yet._");
      lines.push("");
    } else {
      for (const req of requirements.requirements) {
        lines.push(`### ${req.id} — ${req.title}`);
        if (req.description) {
          lines.push("");
          lines.push(req.description);
        }
        lines.push("");
        lines.push(`Status: ${statusBadge(req.status)}`);
        if (req.linkedPhaseIds.length > 0) {
          lines.push(`Phases: ${req.linkedPhaseIds.map((p) => `\`${p}\``).join(", ")}`);
        }
        if (req.macroTasks.length > 0) {
          lines.push("");
          lines.push("**Macro tasks:**");
          for (const mt of req.macroTasks) {
            lines.push(`- ${statusIcon(mt.status)} **${mt.id}** ${mt.title}`);
            if (mt.description) lines.push(`  - ${mt.description}`);
          }
        }
        lines.push("");
      }
    }

    // ── Phases ───────────────────────────────────────────────────────
    lines.push("---");
    lines.push("## Phases");
    lines.push("");
    if (phases.length === 0) {
      lines.push("_No phases defined yet._");
      lines.push("");
    } else {
      for (const phase of phases) {
        lines.push(this.renderPhaseBlock(phase));
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  renderPhase(phase: Phase): string {
    return ["# " + this.renderPhaseHeading(phase), "", ...this.renderPhaseBody(phase)].join("\n");
  }

  private renderPhaseHeading(phase: Phase): string {
    return `${phase.id} — ${phase.title}`;
  }

  private renderPhaseBlock(phase: Phase): string {
    const lines: string[] = [];
    lines.push(`### ${statusIcon(phase.status)} ${phase.id} — ${phase.title}`);
    if (phase.summary) {
      lines.push("");
      lines.push(phase.summary);
    }
    lines.push("");
    lines.push(`Status: ${statusBadge(phase.status)}`);
    if (phase.dependencies.length > 0) {
      lines.push(`Dependencies: ${phase.dependencies.join(", ")}`);
    }
    if (phase.completionCriteria.length > 0) {
      lines.push("");
      lines.push("**Completion criteria:**");
      lines.push(bullet(phase.completionCriteria));
    }
    if (phase.acceptedDecisions.length > 0) {
      lines.push("");
      lines.push("**Accepted decisions:**");
      lines.push(...renderAcceptedDecisions(phase.acceptedDecisions));
    }
    if (phase.tasks.length > 0) {
      lines.push("");
      lines.push(`**Tasks:** ${phase.tasks.filter((t) => t.status === "done").length}/${phase.tasks.length}`);
    }
    return lines.join("\n");
  }

  private renderPhaseBody(phase: Phase): string[] {
    const lines: string[] = [];

    lines.push(`**Status:** ${statusBadge(phase.status)}`);
    lines.push(`**Created:** ${phase.createdAt}`);
    lines.push(`**Updated:** ${phase.updatedAt}`);
    lines.push("");

    if (phase.summary) {
      lines.push(phase.summary);
      lines.push("");
    }

    if (phase.description) {
      lines.push(phase.description);
      lines.push("");
    }

    // Goals & non-goals
    if (phase.goals.length > 0) {
      lines.push("## Goals");
      lines.push(bullet(phase.goals));
      lines.push("");
    }
    if (phase.nonGoals.length > 0) {
      lines.push("## Non-goals");
      lines.push(bullet(phase.nonGoals));
      lines.push("");
    }
    if (phase.dependencies.length > 0) {
      lines.push("## Dependencies");
      lines.push(bullet(phase.dependencies));
      lines.push("");
    }
    if (phase.risks.length > 0) {
      lines.push("## Risks");
      lines.push(bullet(phase.risks));
      lines.push("");
    }
    if (phase.openQuestions.length > 0) {
      lines.push("## Open Questions");
      lines.push(bullet(phase.openQuestions));
      lines.push("");
    }
    if (phase.acceptedDecisions.length > 0) {
      lines.push("## Accepted Decisions");
      lines.push(...renderAcceptedDecisions(phase.acceptedDecisions));
      lines.push("");
    }

    // Completion criteria
    if (phase.completionCriteria.length > 0) {
      lines.push("## Completion Criteria");
      lines.push(bullet(phase.completionCriteria));
      lines.push("");
    }

    // Tasks
    lines.push("## Tasks");
    lines.push("");
    if (phase.tasks.length === 0) {
      lines.push("_No tasks defined._");
      lines.push("");
    } else {
      for (const task of phase.tasks) {
        lines.push(`### ${statusIcon(task.status)} ${task.id} — ${task.title}`);
        lines.push("");
        lines.push(`Status: ${statusBadge(task.status)}`);
        if (task.description) {
          lines.push("");
          lines.push(task.description);
        }
        if (task.notes) {
          lines.push("");
          lines.push(`**Implementation notes:** ${task.notes}`);
        }
        if (task.decisions.length > 0) {
          lines.push("");
          lines.push("**Decisions:**");
          lines.push(bullet(task.decisions));
        }
        if (task.acceptedDecisions.length > 0) {
          lines.push("");
          lines.push("**Accepted decisions:**");
          lines.push(...renderAcceptedDecisions(task.acceptedDecisions));
        }
        if (task.checklist.length > 0) {
          lines.push("");
          lines.push("**Checklist:**");
          for (const item of task.checklist) {
            lines.push(`- [${item.checked ? "x" : " "}] ${item.title}`);
          }
        }
        if (task.subtasks.length > 0) {
          lines.push("");
          lines.push("**Subtasks:**");
          for (const st of task.subtasks) {
            lines.push(`- ${statusIcon(st.status)} **${st.id}** ${st.title}`);
          }
        }
        lines.push("");
      }
    }

    return lines;
  }

  renderFeature(feature: Feature, phases: Phase[]): string {
    const lines: string[] = [];

    lines.push(`# ${feature.id} — ${feature.name}`);
    lines.push("");
    lines.push(`Status: ${statusBadge(feature.status)}`);
    if (feature.startDate) lines.push(`**Start:** ${feature.startDate}`);
    if (feature.endDate) lines.push(`**End:** ${feature.endDate}`);
    lines.push("");

    if (feature.description) {
      lines.push(feature.description);
      lines.push("");
    }

    if (feature.workDone) {
      lines.push("## Work Done");
      lines.push(feature.workDone);
      lines.push("");
    }

    if (feature.workRemaining) {
      lines.push("## Work Remaining");
      lines.push(feature.workRemaining);
      lines.push("");
    }

    if (feature.acceptedDecisions.length > 0) {
      lines.push("## Accepted Decisions");
      lines.push(...renderAcceptedDecisions(feature.acceptedDecisions));
      lines.push("");
    }

    const featurePhases = phases.filter((p) => feature.phaseIds.includes(p.id));
    if (featurePhases.length > 0) {
      lines.push("## Phases");
      lines.push("");
      for (const fp of featurePhases) {
        lines.push(`### ${statusIcon(fp.status)} ${fp.id} — ${fp.title}`);
        lines.push("");
        lines.push(`Status: ${statusBadge(fp.status)}`);
        if (fp.summary) lines.push("", fp.summary);
        const doneTasks = fp.tasks.filter((t) => t.status === "done").length;
        if (fp.tasks.length > 0) lines.push("", `**Tasks:** ${doneTasks}/${fp.tasks.length} done`);
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  /** Render markdown and return a map of relative paths → content */
  render(plan: PlanWorkspace): Map<string, string> {
    const files = new Map<string, string>();

    files.set("PLAN.md", this.renderPlan(plan));

    for (const feature of plan.features.features) {
      files.set(`features/${feature.id}.md`, this.renderFeature(feature, plan.phases));
    }

    for (const phase of plan.phases) {
      files.set(`phases/${phase.id}.md`, this.renderPhase(phase));
    }

    return files;
  }
}
