import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Ban,
  BarChart3,
  ClipboardList,
  CircleCheck,
  CircleX,
  FileText,
  Gauge,
  LayoutDashboard,
  LoaderCircle,
  Moon,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Sun,
  Trash2,
  TrendingUp,
  ChevronRight,
  ListTodo,
} from "lucide-react";
import {
  createPhase,
  createTask,
  deletePhase,
  getPhase,
  getPhases,
  getProject,
  getTask,
  updatePhase,
  updateTask,
  type CreatePhaseInput,
  type CreateTaskInput,
} from "./api";
import type { Phase, Task } from "@agent-plan/core/schema";

// ───────────────────────────────────────────────────────────────────────
// Theme
// ───────────────────────────────────────────────────────────────────────

type ThemeMode = "light" | "dark";

function getInitialTheme(): ThemeMode {
  const saved = localStorage.getItem("agent-plan-theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function useThemeMode() {
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("agent-plan-theme", theme);
  }, [theme]);

  return {
    theme,
    toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
  };
}

// ───────────────────────────────────────────────────────────────────────
// Icons / status helpers
// ───────────────────────────────────────────────────────────────────────

const STATUS_ICONS = {
  draft: FileText,
  discovery: Search,
  planned: ClipboardList,
  "in-progress": LoaderCircle,
  done: CircleCheck,
  blocked: Ban,
  canceled: CircleX,
} as const;

function StatusIcon({ status, className = "" }: { status: string; className?: string }) {
  const Icon = STATUS_ICONS[status as keyof typeof STATUS_ICONS] ?? FileText;
  return <Icon className={className} />;
}

function statusBadgeClass(status: string): string {
  return `badge badge-${status}`;
}

function phaseIconClass(status: string): string {
  switch (status) {
    case "done":
      return "text-emerald-500";
    case "blocked":
    case "canceled":
      return "text-rose-500";
    case "in-progress":
      return "text-amber-500 animate-spin";
    case "planned":
      return "text-sky-500";
    case "discovery":
      return "text-indigo-500";
    default:
      return "text-slate-400";
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "done":
      return "#22c55e";
    case "blocked":
      return "#ef4444";
    case "canceled":
      return "#94a3b8";
    case "in-progress":
      return "#f59e0b";
    case "planned":
      return "#0ea5e9";
    case "discovery":
      return "#6366f1";
    default:
      return "#94a3b8";
  }
}

function statusLabel(status: string): string {
  return status.replace(/-/g, " ");
}

// ───────────────────────────────────────────────────────────────────────
// App router
// ───────────────────────────────────────────────────────────────────────

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/phase/:id" element={<PhaseDetail />} />
      <Route path="/task/:id" element={<TaskDetail />} />
    </Routes>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Dashboard
// ───────────────────────────────────────────────────────────────────────

function Dashboard() {
  const queryClient = useQueryClient();
  const { theme, toggle } = useThemeMode();
  const projectQuery = useQuery({ queryKey: ["project"], queryFn: getProject });
  const phasesQuery = useQuery({ queryKey: ["phases"], queryFn: getPhases });

  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreatePhaseInput>({ title: "", summary: "", description: "" });

  const createMutation = useMutation({
    mutationFn: createPhase,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["phases"] });
      await queryClient.invalidateQueries({ queryKey: ["project"] });
      setCreateOpen(false);
      setCreateDraft({ title: "", summary: "", description: "" });
    },
  });

  const project = projectQuery.data;
  const phases = phasesQuery.data ?? [];
  const stats = useMemo(() => buildStats(phases), [phases]);

  if (projectQuery.isLoading) return <AppShell><LoadingState text="Loading project…" /></AppShell>;
  if (projectQuery.error) return <AppShell><ErrorState message={String(projectQuery.error)} /></AppShell>;
  if (!project) return <AppShell><EmptyState message="No project data" /></AppShell>;

  const taskChart = chartBars(stats.taskStatusCounts);

  return (
    <AppShell>
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-24 h-96 w-96 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="absolute right-[-5rem] top-16 h-[28rem] w-[28rem] rounded-full bg-fuchsia-500/15 blur-3xl" />
        <div className="absolute bottom-[-8rem] left-1/3 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl" />
      </div>

      <div className="relative flex items-center justify-between gap-4 mb-10 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-muted">
            <LayoutDashboard className="h-3.5 w-3.5" /> Overview
          </div>
          <h1 className="mt-4 text-4xl font-black tracking-tight bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-cyan-500 bg-clip-text text-transparent">
            {project.name}
          </h1>
          {project.goal && <p className="mt-2 max-w-3xl text-base text-muted">{project.goal}</p>}
        </div>

        <div className="flex items-center gap-2">
          <button className="btn btn-ghost" onClick={toggle} title={`Switch to ${theme === "dark" ? "light" : "dark"}`}>
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            <span className="hidden sm:inline">{theme === "dark" ? "Light" : "Dark"}</span>
          </button>
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New phase
          </button>
        </div>
      </div>

      <StatGrid stats={stats} />

      <div className="grid gap-10 xl:grid-cols-2 mt-12 items-stretch">
        <div className="card">
          <SectionHeader
            icon={<BarChart3 className="h-4 w-4" />}
            title="Phase distribution"
            subtitle="Status split across all phases"
          />
          <div className="mt-12 grid gap-12 md:grid-cols-[300px_minmax(0,1fr)] items-start">
            <DonutChart items={stats.phaseLegend} centerLabel={`${phases.length}`} centerSubLabel="phases" />
            <LegendList items={stats.phaseLegend} />
          </div>
        </div>

        <div className="card">
          <SectionHeader
            icon={<TrendingUp className="h-4 w-4" />}
            title="Task momentum"
            subtitle="Completion, blocked work and recent velocity"
          />
          <div className="mt-12 space-y-10">
            <BarChart title="Tasks by status" bars={taskChart} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <MiniMetric label="Velocity (7d)" value={`${stats.velocity7d}`} icon={<Sparkles className="h-4 w-4" />} />
              <MiniMetric label="Blocked" value={`${stats.blockedTasks}`} icon={<Ban className="h-4 w-4" />} />
            </div>
          </div>
        </div>
      </div>

      <Section title="Scope" count={project.scope.length + project.outOfScope.length} />
      <div className="grid gap-4 md:grid-cols-2">
        <ScopeCard title="In scope" items={project.scope} positive />
        <ScopeCard title="Out of scope" items={project.outOfScope} />
      </div>

      <div className="mt-10">
        <Section title="Phases" count={phases.length} action={<button className="btn" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Create</button>} />
        <div className="space-y-5">
          {phasesQuery.isLoading && <LoadingState text="Loading phases…" />}
          {phases.length === 0 && <EmptyState message="No phases yet." />}
          {phases.map((phase) => (
            <PhaseRow key={phase.id} phase={phase} />
          ))}
        </div>
      </div>

      {createOpen && (
        <Modal title="Create phase" onClose={() => setCreateOpen(false)}>
          <PhaseCreateForm
            draft={createDraft}
            onChange={setCreateDraft}
            onCancel={() => setCreateOpen(false)}
            onSave={() => createMutation.mutate(createDraft)}
            saving={createMutation.isPending}
          />
        </Modal>
      )}
    </AppShell>
  );
}

function PhaseRow({ phase }: { phase: Phase }) {
  return (
    <Link to={`/phase/${phase.id}`} className="card group flex items-center gap-4 transition-transform hover:-translate-y-0.5 hover:border-[color:var(--accent)]/40">
      <div className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-[color:var(--surface-solid)] border border-[color:var(--border)] ${phaseIconClass(phase.status)}`}>
        <StatusIcon status={phase.status} className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="mono text-subtle">{phase.id}</span>
          <span className="text-base font-semibold group-hover:text-indigo-500 transition-colors">{phase.title}</span>
          <span className={statusBadgeClass(phase.status)}>{statusLabel(phase.status)}</span>
        </div>
        {phase.summary && <p className="mt-1 truncate text-sm text-muted">{phase.summary}</p>}
      </div>
      <ChevronRight className="h-5 w-5 text-subtle group-hover:text-indigo-500 transition-colors" />
    </Link>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Phase detail
// ───────────────────────────────────────────────────────────────────────

function PhaseDetail() {
  const { id } = useParams() as { id: string };
  const navigate = useNavigate();
  const client = useQueryClient();

  const phaseQuery = useQuery({ queryKey: ["phase", id], queryFn: () => getPhase(id) });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Phase | null>(null);
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskDraft, setTaskDraft] = useState<CreateTaskInput>({ title: "", description: "", status: "planned" });

  const updateMutation = useMutation({
    mutationFn: updatePhase,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["phases"] });
      await client.invalidateQueries({ queryKey: ["phase", id] });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deletePhase,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["phases"] });
      navigate("/");
    },
  });
  const createTaskMutation = useMutation({
    mutationFn: ({ phaseId, input }: { phaseId: string; input: CreateTaskInput }) => createTask(phaseId, input),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["phases"] });
      await client.invalidateQueries({ queryKey: ["phase", id] });
      setTaskOpen(false);
      setTaskDraft({ title: "", description: "", status: "planned" });
    },
  });

  const phase = phaseQuery.data;

  if (phaseQuery.isLoading) return <AppShell><LoadingState text="Loading phase…" /></AppShell>;
  if (phaseQuery.error) return <AppShell><ErrorState message={String(phaseQuery.error)} /></AppShell>;
  if (!phase) return <AppShell><EmptyState message="Phase not found" /></AppShell>;

  const startEdit = () => {
    setDraft(phase);
    setEditing(true);
  };

  const handleSave = async () => {
    if (!draft) return;
    await updateMutation.mutateAsync(draft);
    setEditing(false);
    setDraft(null);
  };

  const handleDelete = async () => {
    if (confirm(`Delete phase \"${phase.title}\"? This cannot be undone.`)) {
      await deleteMutation.mutateAsync(id);
    }
  };

  return (
    <AppShell>
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-24 h-96 w-96 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="absolute right-[-5rem] top-16 h-[28rem] w-[28rem] rounded-full bg-fuchsia-500/15 blur-3xl" />
      </div>

      <div className="relative mb-6 flex items-center justify-between gap-4 flex-wrap">
        <Link to="/" className="btn btn-ghost">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <div className="flex items-center gap-2">
          <button className="btn" onClick={() => setTaskOpen(true)}>
            <Plus className="h-4 w-4" /> New task
          </button>
          <button className="btn" onClick={startEdit}>
            <Pencil className="h-4 w-4" /> Edit
          </button>
          <button className="btn btn-danger" onClick={handleDelete}>
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        </div>
      </div>

      <div className="relative mb-8 flex items-start gap-4 flex-wrap">
        <div className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--surface)] border border-[color:var(--border)] ${phaseIconClass(phase.status)}`}>
          <StatusIcon status={phase.status} className="h-7 w-7" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-black tracking-tight">{phase.title}</h1>
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <span className="mono text-subtle">{phase.id}</span>
            <span className={statusBadgeClass(phase.status)}>{statusLabel(phase.status)}</span>
          </div>
        </div>
      </div>

      {editing && draft ? (
        <PhaseEditor
          phase={draft}
          onChange={setDraft}
          onCancel={() => { setEditing(false); setDraft(null); }}
          onSave={handleSave}
          saving={updateMutation.isPending}
        />
      ) : (
        <>
          {(phase.summary || phase.description) && (
            <div className="grid gap-6 lg:grid-cols-2 mb-8">
              {phase.summary && <InfoCard title="Summary">{phase.summary}</InfoCard>}
              {phase.description && <InfoCard title="Description">{phase.description}</InfoCard>}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2 mb-8">
            {phase.goals.length > 0 && <BulletCard title="Goals" items={phase.goals} variant="check" />}
            {phase.nonGoals.length > 0 && <BulletCard title="Non-goals" items={phase.nonGoals} variant="cross" />}
            {phase.dependencies.length > 0 && <BulletCard title="Dependencies" items={phase.dependencies} variant="dot" />}
            {phase.risks.length > 0 && <BulletCard title="Risks" items={phase.risks} variant="dot" />}
            {phase.completionCriteria.length > 0 && <BulletCard title="Completion criteria" items={phase.completionCriteria} variant="check" />}
          </div>

          <Section title="Tasks" count={phase.tasks.length} action={<button className="btn" onClick={() => setTaskOpen(true)}><Plus className="h-4 w-4" /> Add task</button>} />
          <div className="space-y-5">
            {phase.tasks.length === 0 ? (
              <EmptyState message="No tasks yet." />
            ) : (
              phase.tasks.map((task) => <TaskRow key={task.id} task={task} />)
            )}
          </div>
        </>
      )}

      {taskOpen && (
        <Modal title="Create task" onClose={() => setTaskOpen(false)}>
          <TaskCreateForm
            draft={taskDraft}
            onChange={setTaskDraft}
            onCancel={() => setTaskOpen(false)}
            onSave={() => {
              const input: CreateTaskInput = {
                title: taskDraft.title,
                status: taskDraft.status ?? "planned",
              };
              if (taskDraft.description?.trim()) input.description = taskDraft.description.trim();
              createTaskMutation.mutate({ phaseId: phase.id, input });
            }}
            saving={createTaskMutation.isPending}
          />
        </Modal>
      )}
    </AppShell>
  );
}

function TaskRow({ task }: { task: Task }) {
  return (
    <Link to={`/task/${task.id}`} className="card group flex items-center gap-4 transition-transform hover:-translate-y-0.5 hover:border-[color:var(--accent)]/40">
      <div className={`flex h-10 w-10 items-center justify-center rounded-2xl bg-[color:var(--surface-solid)] border border-[color:var(--border)] ${phaseIconClass(task.status)}`}>
        <StatusIcon status={task.status} className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-semibold group-hover:text-indigo-500 transition-colors">{task.title}</span>
          <span className={statusBadgeClass(task.status)}>{statusLabel(task.status)}</span>
        </div>
        {task.description && <p className="mt-1 truncate text-sm text-muted">{task.description}</p>}
      </div>
      <span className="mono text-subtle">{task.id}</span>
      <ChevronRight className="h-5 w-5 text-subtle group-hover:text-indigo-500 transition-colors" />
    </Link>
  );
}

function TaskDetail() {
  const { id } = useParams() as { id: string };
  const navigate = useNavigate();
  const client = useQueryClient();

  const taskQuery = useQuery({
    queryKey: ["task", id],
    queryFn: () => getTask(id),
  });
  const phaseQuery = useQuery({
    queryKey: ["task-phase", taskQuery.data?.phaseId],
    queryFn: () => getPhase(taskQuery.data!.phaseId),
    enabled: !!taskQuery.data?.phaseId,
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Task | null>(null);

  const updateMutation = useMutation({
    mutationFn: updateTask,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["phases"] });
      await client.invalidateQueries({ queryKey: ["phase", taskQuery.data?.phaseId] });
      await client.invalidateQueries({ queryKey: ["task", id] });
      await client.invalidateQueries({ queryKey: ["task-phase", taskQuery.data?.phaseId] });
    },
  });

  const task = taskQuery.data;

  if (taskQuery.isLoading) return <AppShell><LoadingState text="Loading task…" /></AppShell>;
  if (taskQuery.error) return <AppShell><ErrorState message={String(taskQuery.error)} /></AppShell>;
  if (!task) return <AppShell><EmptyState message="Task not found" /></AppShell>;

  const startEdit = () => {
    setDraft(task);
    setEditing(true);
  };

  const handleSave = async () => {
    if (!draft) return;
    await updateMutation.mutateAsync(draft);
    setEditing(false);
    setDraft(null);
  };

  const phaseTitle = phaseQuery.data?.title ?? task.phaseId;

  return (
    <AppShell>
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-24 h-96 w-96 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="absolute right-[-5rem] top-16 h-[28rem] w-[28rem] rounded-full bg-fuchsia-500/15 blur-3xl" />
      </div>

      <div className="relative mb-6 flex items-center justify-between gap-4 flex-wrap">
        <Link to={`/phase/${task.phaseId}`} className="btn btn-ghost">
          <ArrowLeft className="h-4 w-4" /> Back to phase
        </Link>
        <button className="btn" onClick={startEdit}>
          <Pencil className="h-4 w-4" /> Edit
        </button>
      </div>

      <div className="relative mb-8 flex items-start gap-4 flex-wrap">
        <div className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--surface)] border border-[color:var(--border)] ${phaseIconClass(task.status)}`}>
          <StatusIcon status={task.status} className="h-7 w-7" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-black tracking-tight">{task.title}</h1>
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <span className="mono text-subtle">{task.id}</span>
            <span className={statusBadgeClass(task.status)}>{statusLabel(task.status)}</span>
          </div>
        </div>
      </div>

      {editing && draft ? (
        <TaskEditor
          task={draft}
          onChange={setDraft}
          onCancel={() => { setEditing(false); setDraft(null); }}
          onSave={handleSave}
          saving={updateMutation.isPending}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <InfoCard title="Phase">
            <Link className="link font-medium" to={`/phase/${task.phaseId}`}>{phaseTitle}</Link>
          </InfoCard>
          <InfoCard title="Status">
            {statusLabel(task.status)}
          </InfoCard>
          <InfoCard title="Description">
            {task.description || "No description"}
          </InfoCard>
          <InfoCard title="Meta">
            {`Created: ${new Date(task.createdAt).toLocaleString()}\nUpdated: ${new Date(task.updatedAt).toLocaleString()}`}
          </InfoCard>
        </div>
      )}
    </AppShell>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Forms
// ───────────────────────────────────────────────────────────────────────

function PhaseCreateForm({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  draft: CreatePhaseInput;
  onChange: (draft: CreatePhaseInput) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <FormStack>
      <Field label="Title">
        <input className="input" value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} placeholder="Authentication core" />
      </Field>
      <Field label="Summary">
        <input className="input" value={draft.summary ?? ""} onChange={(e) => onChange({ ...draft, summary: e.target.value })} placeholder="What this phase delivers" />
      </Field>
      <Field label="Description">
        <textarea className="textarea" rows={5} value={draft.description ?? ""} onChange={(e) => onChange({ ...draft, description: e.target.value })} placeholder="Short description…" />
      </Field>
      <div className="flex gap-3 pt-4">
        <button className="btn btn-primary" onClick={onSave} disabled={saving || !draft.title.trim()}>{saving ? "Creating…" : "Create phase"}</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </FormStack>
  );
}

function TaskCreateForm({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  draft: CreateTaskInput;
  onChange: (draft: CreateTaskInput) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <FormStack>
      <Field label="Title">
        <input className="input" value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} placeholder="Create OAuth flow" />
      </Field>
      <Field label="Status">
        <select className="select" value={draft.status ?? "planned"} onChange={(e) => onChange({ ...draft, status: e.target.value as Task["status"] })}>
          {(["planned", "in-progress", "done", "blocked", "canceled"] as const).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      <Field label="Description">
        <textarea className="textarea" rows={4} value={draft.description ?? ""} onChange={(e) => onChange({ ...draft, description: e.target.value })} placeholder="Optional details…" />
      </Field>
      <div className="flex gap-3 pt-4">
        <button className="btn btn-primary" onClick={onSave} disabled={saving || !draft.title.trim()}>{saving ? "Creating…" : "Create task"}</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </FormStack>
  );
}

function TaskEditor({
  task,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  task: Task;
  onChange: (task: Task) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const set = <K extends keyof Task>(key: K, value: Task[K]) => onChange({ ...task, [key]: value });
  return (
    <div className="card max-w-5xl">
      <h2 className="mb-6 text-xl font-bold">Edit task</h2>
      <FormStack>
        <Field label="Title"><input className="input" value={task.title} onChange={(e) => set("title", e.target.value)} /></Field>
        <Field label="Status">
          <select className="select" value={task.status} onChange={(e) => set("status", e.target.value as Task["status"])}>
            {(["planned", "in-progress", "done", "blocked", "canceled"] as const).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Description"><textarea className="textarea" rows={5} value={task.description ?? ""} onChange={(e) => set("description", e.target.value)} /></Field>
        <div className="flex gap-3 pt-4"><button className="btn btn-primary" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button><button className="btn" onClick={onCancel}>Cancel</button></div>
      </FormStack>
    </div>
  );
}

function PhaseEditor({
  phase,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  phase: Phase;
  onChange: (phase: Phase) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const set = <K extends keyof Phase>(key: K, value: Phase[K]) => onChange({ ...phase, [key]: value });
  const setArr = (key: "goals" | "nonGoals" | "dependencies" | "risks" | "completionCriteria", value: string) =>
    onChange({ ...phase, [key]: value.split("\n").map((s) => s.trim()).filter(Boolean) });

  return (
    <div className="card max-w-3xl">
      <h2 className="mb-6 text-xl font-bold">Edit phase</h2>
      <FormStack>
        <Field label="Title"><input className="input" value={phase.title} onChange={(e) => set("title", e.target.value)} /></Field>
        <Field label="Status">
          <select className="select" value={phase.status} onChange={(e) => set("status", e.target.value as Phase["status"])}>
            {(["draft", "discovery", "planned", "in-progress", "done", "blocked", "canceled"] as const).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Summary"><textarea className="textarea" rows={2} value={phase.summary ?? ""} onChange={(e) => set("summary", e.target.value)} /></Field>
        <Field label="Description"><textarea className="textarea" rows={4} value={phase.description ?? ""} onChange={(e) => set("description", e.target.value)} /></Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Goals (one per line)"><textarea className="textarea" rows={3} value={phase.goals.join("\n")} onChange={(e) => setArr("goals", e.target.value)} /></Field>
          <Field label="Non-goals (one per line)"><textarea className="textarea" rows={3} value={phase.nonGoals.join("\n")} onChange={(e) => setArr("nonGoals", e.target.value)} /></Field>
          <Field label="Dependencies (one per line)"><textarea className="textarea" rows={3} value={phase.dependencies.join("\n")} onChange={(e) => setArr("dependencies", e.target.value)} /></Field>
          <Field label="Risks (one per line)"><textarea className="textarea" rows={3} value={phase.risks.join("\n")} onChange={(e) => setArr("risks", e.target.value)} /></Field>
        </div>
        <Field label="Completion criteria (one per line)"><textarea className="textarea" rows={3} value={phase.completionCriteria.join("\n")} onChange={(e) => setArr("completionCriteria", e.target.value)} /></Field>
        <div className="flex gap-3 pt-4"><button className="btn btn-primary" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button><button className="btn" onClick={onCancel}>Cancel</button></div>
      </FormStack>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Charts / stats
// ───────────────────────────────────────────────────────────────────────

type Stats = ReturnType<typeof buildStats>;

function buildStats(phases: Phase[]) {
  const tasks = phases.flatMap((phase) => phase.tasks.map((task) => ({ ...task, phaseId: phase.id })));
  const phaseStatusCounts = countBy(phases, (phase) => phase.status);
  const taskStatusCounts = countBy(tasks, (task) => task.status);
  const totalTasks = tasks.length;
  const doneTasks = taskStatusCounts.done ?? 0;
  const blockedTasks = taskStatusCounts.blocked ?? 0;
  const activePhases = phases.filter((phase) => ["discovery", "planned", "in-progress"].includes(phase.status)).length;
  const completion = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const recentCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const velocity7d = tasks.filter((task) => task.status === "done" && Date.parse(task.updatedAt) >= recentCutoff).length;
  const phaseLegend = sortStatusKeys(phaseStatusCounts).map((status) => ({
    status,
    count: phaseStatusCounts[status] ?? 0,
    color: statusColor(status),
  }));
  return {
    totalPhases: phases.length,
    totalTasks,
    doneTasks,
    blockedTasks,
    activePhases,
    completion,
    velocity7d,
    phaseStatusCounts,
    taskStatusCounts,
    phaseLegend,
  };
}

function countBy<T>(items: T[], getKey: (item: T) => string) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = getKey(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function sortStatusKeys(counts: Record<string, number>): string[] {
  const order = ["draft", "discovery", "planned", "in-progress", "done", "blocked", "canceled"];
  return Object.keys(counts).sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

function chartGradient(counts: Record<string, number>): string {
  const entries = sortStatusKeys(counts).map((status) => ({ status, count: counts[status] ?? 0 })).filter((entry) => entry.count > 0);
  if (entries.length === 0) return "conic-gradient(#94a3b8 0 100%)";
  let acc = 0;
  const total = entries.reduce((sum, entry) => sum + entry.count, 0);
  const parts = entries.map((entry) => {
    const start = acc;
    acc += (entry.count / total) * 100;
    return `${statusColor(entry.status)} ${start}% ${acc}%`;
  });
  return `conic-gradient(${parts.join(", ")})`;
}

function chartBars(counts: Record<string, number>) {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0) || 1;
  return sortStatusKeys(counts).map((status) => ({
    status,
    value: counts[status] ?? 0,
    percent: Math.round(((counts[status] ?? 0) / total) * 100),
    color: statusColor(status),
  }));
}

function StatGrid({ stats }: { stats: Stats }) {
  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard title="Total phases" value={`${stats.totalPhases}`} icon={<LayoutDashboard className="h-4 w-4" />} sub={`Active: ${stats.activePhases}`} />
      <MetricCard title="Total tasks" value={`${stats.totalTasks}`} icon={<ListTodo className="h-4 w-4" />} sub={`Done: ${stats.doneTasks}`} />
      <MetricCard title="Completion" value={`${stats.completion}%`} icon={<Gauge className="h-4 w-4" />} sub={`Blocked: ${stats.blockedTasks}`} />
      <MetricCard title="Velocity (7d)" value={`${stats.velocity7d}`} icon={<Sparkles className="h-4 w-4" />} sub="Tasks moved to done" />
    </div>
  );
}

function MetricCard({ title, value, sub, icon }: { title: string; value: string; sub: string; icon: ReactNode }) {
  return (
    <div className="card flex items-start justify-between gap-6">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-subtle">{title}</div>
        <div className="mt-2 text-3xl font-black tracking-tight">{value}</div>
        <div className="mt-1 text-sm text-muted">{sub}</div>
      </div>
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[color:var(--surface-solid)] border border-[color:var(--border)] text-indigo-500">
        {icon}
      </div>
    </div>
  );
}

function DonutChart({ items, centerLabel, centerSubLabel }: { items: { status: string; count: number; color: string }[]; centerLabel: string; centerSubLabel: string }) {
  const total = items.reduce((sum, item) => sum + item.count, 0) || 1;
  let acc = 0;
  const gradient = items.length
    ? `conic-gradient(${items
        .map((item) => {
          const start = acc;
          acc += (item.count / total) * 100;
          return `${item.color} ${start}% ${acc}%`;
        })
        .join(", ")})`
    : "conic-gradient(#94a3b8 0 100%)";

  return (
    <div className="relative mx-auto flex h-60 w-60 items-center justify-center">
      <div className="absolute inset-0 rounded-full" style={{ background: gradient }} />
      <div className="absolute inset-[18px] rounded-full border border-[color:var(--border)] bg-[color:var(--surface-solid)]/80 backdrop-blur flex flex-col items-center justify-center text-center shadow-inner">
        <div className="text-4xl font-black tracking-tight">{centerLabel}</div>
        <div className="text-sm text-muted">{centerSubLabel}</div>
      </div>
    </div>
  );
}

function LegendList({ items }: { items: { status: string; count: number; color: string }[] }) {
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.status} className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] px-6 py-5">
          <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
          <div className="min-w-0">
            <div className="truncate font-medium capitalize">{statusLabel(item.status)}</div>
            <div className="text-sm text-muted">{item.count} phases</div>
          </div>
          <span className="mono justify-self-end whitespace-nowrap text-subtle">{item.count}</span>
        </div>
      ))}
    </div>
  );
}

function BarChart({ title, bars }: { title: string; bars: { status: string; value: number; percent: number; color: string }[] }) {
  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold text-muted uppercase tracking-[0.22em]">{title}</div>
      <div className="space-y-4">
        {bars.map((bar) => (
          <div key={bar.status} className="grid grid-cols-[120px_1fr_64px] items-center gap-6 py-2">
            <div className="text-sm font-medium capitalize">{statusLabel(bar.status)}</div>
            <div className="h-4 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
              <div className="h-full rounded-full" style={{ width: `${Math.max(bar.percent, bar.value > 0 ? 4 : 0)}%`, backgroundColor: bar.color }} />
            </div>
            <div className="mono text-right text-subtle">{bar.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniMetric({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="card-compact flex items-center justify-between gap-3">
      <div>
        <div className="text-xs uppercase tracking-[0.22em] text-subtle">{label}</div>
        <div className="mt-1 text-2xl font-black">{value}</div>
      </div>
      <div className="text-indigo-500">{icon}</div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Shared UI
// ───────────────────────────────────────────────────────────────────────

function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="m-auto w-[calc(100%-4rem)] max-w-[1120px] py-10">
        {children}
      </div>
    </div>
  );
}

function Section({ title, count, action }: { title: string; count?: number; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-lg font-bold">{title}</h2>
        {count !== undefined && <span className="text-sm text-subtle">{count}</span>}
      </div>
      {action}
    </div>
  );
}

function SectionHeader({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[color:var(--surface-solid)] border border-[color:var(--border)] text-indigo-500">{icon}</div>
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="text-sm text-muted">{subtitle}</p>
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={onClose} aria-label="Close modal" />
      <div className="relative z-10 w-full max-w-3xl rounded-3xl border border-[color:var(--border)] bg-[color:var(--surface-solid)] p-12 shadow-2xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <h3 className="text-lg font-bold">{title}</h3>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FormStack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-7">{children}</div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-subtle">{title}</div>
      <div className="text-sm leading-relaxed text-[color:var(--text)]/95 whitespace-pre-line">{children}</div>
    </div>
  );
}

function BulletCard({ title, items, variant }: { title: string; items: string[]; variant: "check" | "cross" | "dot" }) {
  const mark = { check: CircleCheck, cross: CircleX, dot: Sparkles }[variant];
  const tone = { check: "text-emerald-500", cross: "text-rose-500", dot: "text-indigo-500" }[variant];
  const Mark = mark;
  return (
    <div className="card">
      <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-subtle">
        <Mark className={`h-4 w-4 ${tone}`} /> {title}
      </div>
      <ul className="space-y-3">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <span className={`${tone} mt-0.5`}>•</span>
            <span className="leading-relaxed">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScopeCard({ title, items, positive }: { title: string; items: string[]; positive?: boolean }) {
  return (
    <div className="card">
      <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-subtle">
        {positive ? <CircleCheck className="h-4 w-4 text-emerald-500" /> : <CircleX className="h-4 w-4 text-rose-500" />}
        {title}
      </div>
      {items.length === 0 ? (
        <EmptyState message="Nothing defined" />
      ) : (
        <ul className="space-y-3">
          {items.map((s, i) => (
            <li key={i} className="flex gap-2 text-sm leading-relaxed">
              {positive ? <CircleCheck className="mt-0.5 h-4 w-4 text-emerald-500" /> : <CircleX className="mt-0.5 h-4 w-4 text-rose-500" />}
              <span>{s}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LoadingState({ text }: { text: string }) {
  return <div className="py-10 text-center text-muted">{text}</div>;
}

function EmptyState({ message }: { message: string }) {
  return <div className="py-8 text-center italic text-subtle">{message}</div>;
}

function ErrorState({ message }: { message: string }) {
  return <div className="py-10 text-center text-rose-500">Error: {message}</div>;
}
