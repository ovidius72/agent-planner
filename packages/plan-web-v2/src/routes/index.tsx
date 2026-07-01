import { createHashRouter, type RouteObject } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { Dashboard } from "../pages/Dashboard";
import { Features } from "../pages/Features";
import { FeatureDetail } from "../pages/FeatureDetail";
import { PhaseDetail } from "../pages/PhaseDetail";
import { TaskDetail } from "../pages/TaskDetail";

function L(props: RouteObject) {
  return { ...props, element: <AppShell>{props.element}</AppShell> };
}

export const router = createHashRouter([
  L({ path: "/", element: <Dashboard /> }),
  L({ path: "/features", element: <Features /> }),
  L({ path: "/features/:id", element: <FeatureDetail /> }),
  L({ path: "/phases/:id", element: <PhaseDetail /> }),
  L({ path: "/tasks/:id", element: <TaskDetail /> }),
]);
