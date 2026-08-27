import { useMemo, useState } from "react";
import { useLoaderData, useNavigate, useRouteLoaderData } from "react-router-dom";
import { Pencil } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { FormattedText } from "../../components/ui/formatted-text";
import { AiConsolidatedContext } from "../../components/dashboard/ai-consolidated-context";
import { LatestCompletedTasks } from "../../components/dashboard/latest-completed-tasks";
import { NewAddedTasks } from "../../components/dashboard/new-added-tasks";
import { StatCards } from "../../components/dashboard/stat-cards";
import { FlowBacklogAnalytics } from "../../components/dashboard/flow-backlog-analytics";
import type { AnalyticsDrilldown } from "../../components/dashboard/analytics-charts";
import { WorkTree } from "../../components/dashboard/work-tree";
import { ResumeRequiredSection } from "../../components/dashboard/resume-required";
import { useShortcut } from "../../lib/shortcuts";
import type { ActiveTaskSummary, TaskFocusSummary } from "../../lib/api";
import type { Feature, Phase, Project } from "../../lib/types";

/**
 * Dashboard / home route. Now a thin orchestrator: it loads the plan data,
 * derives the per-project storage scope, and composes the four dashboard
 * sections. All section logic + state lives in dedicated components/hooks
 * (AiConsolidatedContext, StatCards, WorkTree, LatestCompletedTasks).
 */
export function DashboardRoute() {
  const { features, phases, activeTasks } = useLoaderData() as {
    features: Feature[];
    phases: Phase[];
    activeTasks: ActiveTaskSummary[];
  };
  const { project, taskFocus } = useRouteLoaderData("root") as { project: Project; taskFocus: TaskFocusSummary };
  const resumeRequiredIds = useMemo(
    () => new Set((taskFocus.pendingResume ?? []).map((t) => t.id)),
    [taskFocus.pendingResume],
  );
  const [analyticsDrilldown, setAnalyticsDrilldown] = useState<AnalyticsDrilldown | null>(null);
  const analyticsTaskIds = useMemo(
    () => new Set(analyticsDrilldown?.taskIds ?? []),
    [analyticsDrilldown],
  );
  const navigate = useNavigate();
  const openEditProject = () => navigate("/project/edit");
  useShortcut("edit", openEditProject);

  const projectStorageScope = project.projectRoot || project.planRoot || project.name || "default";

  return (
    <div className="grid grid-cols-1 gap-8">
      <Card className="grid grid-cols-1 gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="min-w-0 text-lg font-bold text-[var(--text)]">Project Goal</h2>
          <Button type="button" shortcut="edit" onClick={openEditProject} className="shrink-0">
            <Pencil className="h-4 w-4" />
            Edit project
          </Button>
        </div>
        {project.goal ? <FormattedText text={project.goal} className="max-w-4xl" /> : <p className="max-w-4xl text-sm text-[var(--text-muted)]">Add a project goal to define the main objective.</p>}
      </Card>

      <AiConsolidatedContext project={project} />

      <StatCards features={features} phases={phases} />

      <FlowBacklogAnalytics
        phases={phases}
        activeDrilldown={analyticsDrilldown}
        onDrilldown={setAnalyticsDrilldown}
        onClearDrilldown={() => setAnalyticsDrilldown(null)}
      />

      <ResumeRequiredSection tasks={taskFocus.pendingResume} />

      <WorkTree
        features={features}
        phases={phases}
        activeTasks={activeTasks}
        projectStorageScope={projectStorageScope}
        resumeRequiredIds={resumeRequiredIds}
        analyticsFilter={analyticsDrilldown ? { label: analyticsDrilldown.label, taskIds: analyticsTaskIds } : null}
        onClearAnalyticsFilter={() => setAnalyticsDrilldown(null)}
      />

      <LatestCompletedTasks features={features} phases={phases} />
      <NewAddedTasks features={features} phases={phases} />
    </div>
  );
}
