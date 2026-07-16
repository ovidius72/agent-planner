import { useEffect } from "react";
import { isRouteErrorResponse, useLoaderData, useRouteError } from "react-router-dom";
import { AppShell } from "../components/layout/app-shell";
import { getActiveTasks, getProject, getUiConfig, listHandoffs, type ActiveTaskSummary, type UiConfig } from "../lib/api";
import { ShortcutProvider } from "../lib/shortcuts";
import { LiveSyncBridge } from "./live-sync";

export async function loader() {
  const [project, uiConfig, activeTasks, handoffs] = await Promise.all([
    getProject(),
    getUiConfig(),
    getActiveTasks(),
    listHandoffs(),
  ]);
  return { project, uiConfig, activeTasks, handoffs };
}

export function RootRoute() {
  const { project, uiConfig, activeTasks, handoffs } = useLoaderData() as {
    project: Awaited<ReturnType<typeof getProject>>;
    uiConfig: UiConfig;
    activeTasks: ActiveTaskSummary[];
    handoffs: Awaited<ReturnType<typeof listHandoffs>>;
  };

  useEffect(() => {
    document.title = project?.name?.trim() ? `${project.name} · Agent Plan` : "Agent Plan";
  }, [project?.name]);

  return (
    <ShortcutProvider shortcuts={uiConfig.shortcuts}>
      <LiveSyncBridge />
      <AppShell project={project} activeTasks={activeTasks} handoffExists={handoffs.length > 0} serverInfo={uiConfig.server} />
    </ShortcutProvider>
  );
}

export function RootErrorBoundary() {
  const error = useRouteError();
  const isResponse = isRouteErrorResponse(error);
  const isDisconnected = isResponse && error.status === 503;
  const title = isResponse
    ? (isDisconnected ? "Planner web UI disconnected" : `Request failed (${error.status})`)
    : "Planner web UI unavailable";
  const message = isResponse
    ? error.data || error.statusText
    : error instanceof Error
      ? error.message
      : "The planner web UI could not reach its local server.";

  useEffect(() => {
    document.title = "Agent Plan";
  }, []);

  return (
    <div className="page-shell min-h-screen">
      <div className="page-container flex min-h-screen items-center justify-center py-12">
        <div className="surface-card max-w-2xl rounded-[24px] px-8 py-8">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--text-subtle)]">Agent Plan</p>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-[var(--text)] md:text-3xl">{title}</h1>
          <p className="mt-4 text-sm text-[var(--text-muted)]">{String(message)}</p>
          <div className="mt-6 grid gap-2 text-sm text-[var(--text-muted)]">
            {isDisconnected ? (
              <>
                <p>Possible cause: Pi was closed or the local planner web server stopped.</p>
                <p>What to do:</p>
                <ul className="grid gap-1 pl-5">
                  <li className="list-disc">restart Pi or run <code>planner-web start</code></li>
                  <li className="list-disc">reopen this planner UI from the new session if needed</li>
                  <li className="list-disc">then reload this page</li>
                </ul>
              </>
            ) : (
              <>
                <p>The request reached the planner server, but the server rejected it.</p>
                <p>Fix the validation issue above, then try again.</p>
              </>
            )}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex min-h-11 items-center rounded-[14px] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
