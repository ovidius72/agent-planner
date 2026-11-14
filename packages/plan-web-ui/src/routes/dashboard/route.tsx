import { useMemo, useState } from "react";
import { useLoaderData, useNavigate, useRouteLoaderData } from "react-router-dom";
import { Pencil } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Accordion } from "../../components/ui/accordion";
import { FormattedText } from "../../components/ui/formatted-text";
import { ProjectContext } from "../../components/dashboard/project-context";
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
 * (ProjectContext, StatCards, WorkTree, LatestCompletedTasks).
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
    <div className="grid grid-cols-1 gap-5">
      <Accordion
        title="Project Goal"
        defaultOpen={!project.goal}
        actions={
          <Button type="button" shortcut="edit" iconOnly aria-label="Edit project" title="Edit project" onClick={openEditProject}>
            <Pencil className="h-4 w-4" />
          </Button>
        }
      >
        {project.goal ? <FormattedText text={project.goal} /> : <p className="text-sm text-[var(--text-muted)]">Add a project goal to define the main objective.</p>}
      </Accordion>

      <ProjectContext project={project} />

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
