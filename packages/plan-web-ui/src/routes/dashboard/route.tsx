import { Link, useLoaderData, useNavigate, useRouteLoaderData } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { FormattedText } from "../../components/ui/formatted-text";
import { AiConsolidatedContext } from "../../components/dashboard/ai-consolidated-context";
import { LatestCompletedTasks } from "../../components/dashboard/latest-completed-tasks";
import { StatCards } from "../../components/dashboard/stat-cards";
import { WorkTree } from "../../components/dashboard/work-tree";
import { useShortcut } from "../../lib/shortcuts";
import type { ActiveTaskSummary } from "../../lib/api";
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
  const { project } = useRouteLoaderData("root") as { project: Project };
  const navigate = useNavigate();
  const openEditProject = () => navigate("/project/edit");
  useShortcut("edit", openEditProject);

  const projectStorageScope = project.projectRoot || project.planRoot || project.name || "default";

  return (
    <div className="grid gap-8">
      <Card className="grid gap-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-lg font-bold text-[var(--text)]">Project Goal</h2>
            {project.goal ? <FormattedText text={project.goal} className="mt-2 max-w-4xl" /> : <p className="mt-2 max-w-4xl text-sm text-[var(--text-muted)]">Add a project goal to define the main objective.</p>}
          </div>
          <Link to="/project/edit">
            <Button type="button" shortcut="edit">Edit project</Button>
          </Link>
        </div>
      </Card>

      <AiConsolidatedContext project={project} />

      <StatCards features={features} phases={phases} />

      <WorkTree
        features={features}
        phases={phases}
        activeTasks={activeTasks}
        projectStorageScope={projectStorageScope}
      />

      <LatestCompletedTasks features={features} phases={phases} />
    </div>
  );
}
