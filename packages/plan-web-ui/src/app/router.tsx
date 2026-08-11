import { createBrowserRouter } from "react-router-dom";
import { loader as rootLoader, RootErrorBoundary, RootRoute } from "./root";
import { loader as dashboardLoader } from "../routes/dashboard/loader";
import { DashboardRoute } from "../routes/dashboard/route";
import { loader as featuresLoader } from "../routes/features/loader";
import { FeaturesRoute } from "../routes/features/route";
import { loader as requirementsLoader } from "../routes/requirements/loader";
import { RequirementsRoute } from "../routes/requirements/route";
import { loader as featureDetailLoader } from "../routes/feature-detail/loader";
import { FeatureDetailRoute } from "../routes/feature-detail/route";
import { loader as phaseDetailLoader } from "../routes/phase-detail/loader";
import { PhaseDetailRoute } from "../routes/phase-detail/route";
import { loader as taskDetailLoader } from "../routes/task-detail/loader";
import { TaskDetailRoute } from "../routes/task-detail/route";
import { FeatureCreateModalRoute } from "../routes/feature-create-modal.route";
import { FeatureEditModalRoute } from "../routes/feature-edit-modal.route";
import { PhaseCreateModalRoute } from "../routes/phase-create-modal.route";
import { PhaseEditModalRoute } from "../routes/phase-edit-modal.route";
import { TaskCreateModalRoute } from "../routes/task-create-modal.route";
import { TaskEditModalRoute } from "../routes/task-edit-modal.route";
import { ProjectEditRoute } from "../routes/project-edit.route";
import { RequirementCreateModalRoute } from "../routes/requirement-create-modal.route";
import { RequirementEditModalRoute } from "../routes/requirement-edit-modal.route";
import { action as featureCreateAction } from "../routes/feature-create.action";
import { action as featureEditAction } from "../routes/feature-edit.action";
import { action as featureDeleteAction } from "../routes/feature-delete.action";
import { action as featureStatusAction } from "../routes/feature-status.action";
import { action as phaseCreateAction } from "../routes/phase-create.action";
import { action as phaseEditAction } from "../routes/phase-edit.action";
import { action as phaseDeleteAction } from "../routes/phase-delete.action";
import { action as phaseStatusAction } from "../routes/phase-status.action";
import { action as taskCreateAction } from "../routes/task-create.action";
import { action as taskEditAction } from "../routes/task-edit.action";
import { action as taskDeleteAction } from "../routes/task-delete.action";
import { action as taskStatusAction } from "../routes/task-status.action";
import { action as projectEditAction } from "../routes/project-edit.action";
import { action as requirementCreateAction } from "../routes/requirement-create.action";
import { action as requirementEditAction } from "../routes/requirement-edit.action";
import { action as requirementDeleteAction } from "../routes/requirement-delete.action";
import { HandoffRoute, loader as handoffLoader } from "../routes/handoff.route";
import { HandoffArchiveRoute, loader as handoffArchiveLoader } from "../routes/handoff-archive.route";
import { action as taskChecklistToggleAction } from "../routes/task-checklist-toggle.action";

export const router = createBrowserRouter([
  {
    id: "root",
    path: "/",
    loader: rootLoader,
    element: <RootRoute />,
    errorElement: <RootErrorBoundary />,
    children: [
      { index: true, loader: dashboardLoader, element: <DashboardRoute /> },
      {
        path: "features",
        id: "features",
        loader: featuresLoader,
        element: <FeaturesRoute />,
        children: [
          { path: "new", element: <FeatureCreateModalRoute />, action: featureCreateAction },
        ],
      },
      {
        path: "features/:featureId",
        id: "feature-detail",
        loader: featureDetailLoader,
        element: <FeatureDetailRoute />,
        children: [
          { path: "edit", element: <FeatureEditModalRoute />, action: featureEditAction },
          { path: "phases/new", element: <PhaseCreateModalRoute />, action: phaseCreateAction },
        ],
      },
      {
        path: "requirements",
        id: "requirements",
        loader: requirementsLoader,
        element: <RequirementsRoute />,
        children: [
          { path: "new", element: <RequirementCreateModalRoute />, action: requirementCreateAction },
          { path: ":requirementId/edit", element: <RequirementEditModalRoute />, action: requirementEditAction },
        ],
      },
      { path: "project/edit", element: <ProjectEditRoute />, action: projectEditAction },
      { path: "handoff", loader: handoffLoader, element: <HandoffRoute /> },
      { path: "handoff/archive", loader: handoffArchiveLoader, element: <HandoffArchiveRoute /> },
      { path: "features/:featureId/delete", action: featureDeleteAction },
      { path: "requirements/:requirementId/delete", action: requirementDeleteAction },
      { path: "features/:featureId/status", action: featureStatusAction },
      {
        path: "features/:featureId/phases/:phaseId",
        id: "phase-detail",
        loader: phaseDetailLoader,
        element: <PhaseDetailRoute />,
        children: [
          { path: "edit", element: <PhaseEditModalRoute />, action: phaseEditAction },
          { path: "tasks/new", element: <TaskCreateModalRoute />, action: taskCreateAction },
        ],
      },
      { path: "features/:featureId/phases/:phaseId/delete", action: phaseDeleteAction },
      { path: "features/:featureId/phases/:phaseId/status", action: phaseStatusAction },
      {
        path: "features/:featureId/phases/:phaseId/tasks/:taskId",
        id: "task-detail",
        loader: taskDetailLoader,
        element: <TaskDetailRoute />,
        children: [
          { path: "edit", element: <TaskEditModalRoute />, action: taskEditAction },
        ],
      },
      { path: "features/:featureId/phases/:phaseId/tasks/:taskId/delete", action: taskDeleteAction },
      { path: "features/:featureId/phases/:phaseId/tasks/:taskId/status", action: taskStatusAction },
      { path: "features/:featureId/phases/:phaseId/tasks/:taskId/checklist/:itemId/toggle", action: taskChecklistToggleAction },
    ],
  },
]);
