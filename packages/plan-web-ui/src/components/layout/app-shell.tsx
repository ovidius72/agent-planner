import { useEffect, useState, useMemo } from "react";
import { Link, Outlet, useNavigation } from "react-router-dom";
import { TopNav } from "./top-nav";
import { FormattedText } from "../ui/formatted-text";
import type { ActiveTaskSummary, ServerInfo } from "../../lib/api";
import { EntityBadge, ParentBadge } from "../ui/badges";
import type { Project } from "../../lib/types";

export type LiveStatus = "connecting" | "live" | "reconnecting" | "disconnected";

function ActiveTasksHeader({ activeTasks }: { activeTasks: ActiveTaskSummary[] }) {
    const uniqueTasks = useMemo(() => {
      const seen = new Set();
      return activeTasks.filter((task: ActiveTaskSummary) => {
        const key = `${task.id}-${task.title}-${task.phaseId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }, [activeTasks]);

  if (uniqueTasks.length === 0) return null;

  return (
    <div className="border-t border-[var(--border)] bg-[var(--surface-elevated)]/95 backdrop-blur-xl">
      <div className="page-container py-2.5">
        <div className="grid gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">In-progress tasks ({uniqueTasks.length})</span>
          <div className="grid max-h-[35vh] gap-1.5 overflow-y-auto pr-1">
            {uniqueTasks.map((task) => {
              const to = task.featureId
                ? `/features/${task.featureId}/phases/${task.phaseId}/tasks/${task.id}`
                : "/features";
              return (
                <Link
                  key={task.id}
                  to={to}
                  className="flex min-w-0 items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                >
                  <div className="flex items-center gap-2">
                    {task.status === "in-progress" ? (
                      <span
                        aria-hidden="true"
                        className="inline-block h-2 w-2 rounded-full bg-[var(--accent)]"
                        aria-label="In progress"
                      />
                    ) : null}
                    <EntityBadge type="task" number={task.number} />
                    <ParentBadge type="task" phaseNum={task.phaseNumber} featureNum={task.featureNumber} />
                    <span className="min-w-0 truncate font-medium">{task.title}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppShell({ project, activeTasks, handoffExists, serverInfo }: { project: Project; activeTasks: ActiveTaskSummary[]; handoffExists: boolean; serverInfo?: ServerInfo | undefined }) {
  const navigation = useNavigation();
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");

  useEffect(() => {
    const handleStatus = (event: Event) => {
      const next = (event as CustomEvent<{ status?: LiveStatus }>).detail?.status;
      if (!next) return;
      setLiveStatus(next);
    };

    window.addEventListener("agent-plan:ws-status", handleStatus as EventListener);
    return () => window.removeEventListener("agent-plan:ws-status", handleStatus as EventListener);
  }, []);

  return (
    <div className="page-shell">
      <header className="sticky top-0 z-30">
        <TopNav projectName={project?.name} projectRoot={project?.projectRoot} planRoot={project?.planRoot} handoffExists={handoffExists} liveStatus={liveStatus} />
        <ActiveTasksHeader activeTasks={activeTasks} />
      </header>
      <div className="page-container py-8">
        <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--text-subtle)]">Current project</p>
            <h1 className="text-2xl font-black tracking-tight text-[var(--text)] md:text-3xl"><Link to="/" className="hover:text-[var(--accent)]">{project?.name ?? "Agent Plan"}</Link></h1>
            {project?.projectRoot ? <p className="mt-2 truncate font-mono text-xs text-[var(--text-subtle)]" title={project.projectRoot}>{project.projectRoot}</p> : null}
            {serverInfo ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold uppercase tracking-[0.12em] ${serverInfo.mode === "lan" ? "bg-[color:color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]" : "bg-[var(--surface-elevated)] text-[var(--text-muted)]"}`}>
                  <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
                  {serverInfo.mode === "lan" ? "LAN visible" : "Local only"}
                </span>
                <a href={serverInfo.localUrl} target="_blank" rel="noreferrer" className="font-mono text-[var(--text-subtle)] underline-offset-2 hover:text-[var(--accent)] hover:underline">{serverInfo.localUrl}</a>
                {serverInfo.lanUrl ? (
                  <>
                    <span className="text-[var(--text-subtle)]">·</span>
                    <a href={serverInfo.lanUrl} target="_blank" rel="noreferrer" className="font-mono text-[var(--text-subtle)] underline-offset-2 hover:text-[var(--accent)] hover:underline">{serverInfo.lanUrl}</a>
                  </>
                ) : null}
              </div>
            ) : null}
            {project?.description ? <FormattedText text={project.description} className="mt-2 max-w-3xl" /> : null}
          </div>
          {navigation.state !== "idle" ? <div className="text-sm font-semibold text-[var(--accent)]">Updating…</div> : null}
        </div>
        <Outlet />
      </div>
    </div>
  );
}
