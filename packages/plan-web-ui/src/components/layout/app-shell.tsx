import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useNavigate, useNavigation } from "react-router-dom";
import { LocateFixed } from "lucide-react";
import { TopNav } from "./top-nav";
import { FormattedText } from "../ui/formatted-text";
import { ResumeSnapshot } from "../task/resume-snapshot";
import type { ActiveTaskSummary, FocusTaskSummary, ServerInfo, TaskFocusSummary } from "../../lib/api";
import { CopyableBadge, EntityPathBadge, formatEntityPath, ShortIdBadge } from "../ui/badges";
import { StatusBadge } from "../ui/status-badge";
import type { Project } from "../../lib/types";

export type LiveStatus = "connecting" | "live" | "reconnecting" | "disconnected";

function FocusTaskRow({ task }: { task: FocusTaskSummary }) {
  const navigate = useNavigate();
  const to = task.featureId
    ? `/features/${task.featureId}/phases/${task.phaseId}/tasks/${task.id}`
    : "/features";
  return (
    <article
      className={`min-w-0 rounded-[12px] border bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text)] ${task.pendingResume
        ? "border-[var(--accent)]"
        : "border-[var(--border)]"}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <EntityPathBadge
            featureNum={task.featureNumber}
            phaseNum={task.phaseNumber}
            taskNum={task.number}
            featureId={task.featureId}
            phaseId={task.phaseId}
            taskId={task.id}
          />
          <CopyableBadge id={formatEntityPath({ featureNum: task.featureNumber, phaseNum: task.phaseNumber, taskNum: task.number })}>
            <span className="sr-only">Copy task path</span>
          </CopyableBadge>
          {task.shortId ? <ShortIdBadge shortId={task.shortId} /> : null}
          <span className="shrink-0"><StatusBadge status={task.status} /></span>
          <Link to={to} className="min-w-0 flex-1 truncate font-medium hover:text-[var(--accent)]">
            {task.title}
          </Link>
          {task.pendingResume ? (
            <span className="shrink-0 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--accent)]">
              Resume required
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            navigate(`/?locate=T${task.number}`);
          }}
          aria-label={`Locate T${task.number} in work tree`}
          title="Locate in work tree"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-[var(--text-subtle)] transition-colors hover:bg-[var(--accent)] hover:text-white"
        >
          <LocateFixed className="h-4 w-4" />
        </button>
      </div>
      {task.pauseSnapshot ? (
        <div className="mt-2">
          <ResumeSnapshot snapshot={task.pauseSnapshot} pendingResume={task.pendingResume} compact />
        </div>
      ) : task.pendingResume ? (
        <p className="mt-2 text-xs font-medium text-[var(--accent)]">Return to this preserved task before selecting new priority work.</p>
      ) : null}
    </article>
  );
}

export function TaskFocusHeader({ taskFocus }: { taskFocus: TaskFocusSummary }) {
  const focus = useMemo(() => {
    const dedupe = (tasks: FocusTaskSummary[]) => {
      const seen = new Set<string>();
      return tasks.filter((task) => {
        if (seen.has(task.id)) return false;
        seen.add(task.id);
        return true;
      });
    };
    return {
      active: dedupe(taskFocus.active),
      paused: dedupe(taskFocus.paused),
      pendingResume: dedupe(taskFocus.pendingResume),
    };
  }, [taskFocus.active, taskFocus.paused, taskFocus.pendingResume]);

  if (focus.active.length === 0 && focus.paused.length === 0 && focus.pendingResume.length === 0) return null;

  return (
    <div className="relative z-10 border-t border-[var(--border)] bg-[var(--surface-elevated)]/95 backdrop-blur-xl">
      <div className="page-container grid max-h-[45vh] gap-3 overflow-y-auto py-2.5 pr-1">
        {focus.pendingResume.length > 0 ? (
          <section aria-labelledby="resume-task-heading" className="grid gap-1.5">
            <h2 id="resume-task-heading" className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
              Resume required ({focus.pendingResume.length})
            </h2>
            {focus.pendingResume.map((task) => <FocusTaskRow key={task.id} task={task} />)}
          </section>
        ) : null}
        {focus.active.length > 0 ? (
          <section aria-labelledby="active-task-heading" className="grid gap-1.5">
            <h2 id="active-task-heading" className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">
              Active tasks ({focus.active.length})
            </h2>
            {focus.active.map((task) => <FocusTaskRow key={task.id} task={task} />)}
          </section>
        ) : null}
        {focus.paused.length > 0 ? (
          <section aria-labelledby="paused-task-heading" className="grid gap-1.5">
            <h2 id="paused-task-heading" className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">
              Paused tasks ({focus.paused.length})
            </h2>
            {focus.paused.map((task) => <FocusTaskRow key={task.id} task={task} />)}
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** Backward-compatible active-only surface used by existing consumers/tests. */
export function ActiveTasksHeader({ activeTasks }: { activeTasks: ActiveTaskSummary[] }) {
  const active: FocusTaskSummary[] = activeTasks.map((task) => ({
    ...task,
    status: "in-progress",
    pauseSnapshot: null,
    pendingResume: false,
    deviationId: "",
  }));
  return <TaskFocusHeader taskFocus={{ active, paused: [], pendingResume: [] }} />;
}

export function AppShell({ project, taskFocus, serverInfo }: { project: Project; taskFocus: TaskFocusSummary; serverInfo?: ServerInfo | undefined }) {
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
      <header className="sticky top-0 z-30 overflow-visible">
        <TopNav projectName={project?.name} projectRoot={project?.projectRoot} planRoot={project?.planRoot} liveStatus={liveStatus} />
        <TaskFocusHeader taskFocus={taskFocus} />
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
