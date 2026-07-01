import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Plus } from "lucide-react";
import { usePhase, useUpdatePhase, useCreateTask } from "../hooks/use-queries";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Modal } from "../components/ui/Modal";
import { Input, Textarea, Select } from "../components/ui/Input";
import type { Task } from "../types";

export function PhaseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: phase, isLoading } = usePhase(id!);
  const updatePhase = useUpdatePhase();
  const createTask = useCreateTask();

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [status, setStatus] = useState(phase?.status ?? "draft");

  const [showCreateTask, setShowCreateTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");

  if (isLoading) return <div className="py-20 text-center text-[var(--text-muted)]">Loading…</div>;
  if (!phase) return <div className="py-20 text-center text-[var(--text-muted)]">Phase not found</div>;

  const tasksDone = phase.tasks.filter((t) => t.status === "done").length;

  function handleSave() {
    updatePhase.mutate({ ...phase, title, summary, status: status as typeof phase.status }, {
      onSuccess: () => setEditing(false),
    });
  }

  function handleCreateTask() {
    if (!taskTitle.trim()) return;
    createTask.mutate({ phaseId: phase.id, title: taskTitle.trim() }, {
      onSuccess: () => { setTaskTitle(""); setShowCreateTask(false); },
    });
  }

  function handleTaskStatusChange(task: Task, newStatus: Task["status"]) {
    updatePhase.mutate({
      ...phase,
      tasks: phase.tasks.map((t) => t.id === task.id ? { ...t, status: newStatus } : t),
    });
  }

  return (
    <div className="space-y-8">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
        <ArrowLeft size={16} /> Back
      </button>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight">{phase.title}</h1>
            <Badge status={phase.status} />
          </div>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{phase.id}</p>
          {phase.summary && <p className="mt-2 text-[var(--text-muted)]">{phase.summary}</p>}
        </div>
        <Button onClick={() => { setTitle(phase.title); setSummary(phase.summary); setStatus(phase.status); setEditing(true); }}>Edit</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="text-center py-4">
          <div className="text-2xl font-black">{phase.tasks.length}</div>
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Tasks</div>
        </Card>
        <Card className="text-center py-4">
          <div className="text-2xl font-black">{tasksDone}</div>
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Done</div>
        </Card>
        <Card className="text-center py-4">
          <div className="text-2xl font-black">{phase.tasks.length ? Math.round((tasksDone / phase.tasks.length) * 100) : 0}%</div>
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Progress</div>
        </Card>
      </div>

      {/* Tasks */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Tasks</h2>
          <Button variant="primary" onClick={() => setShowCreateTask(true)}>
            <Plus size={16} /> New task
          </Button>
        </div>

        {phase.tasks.length > 0 ? (
          <div className="space-y-2">
            {phase.tasks.map((task) => (
              <div
                key={task.id}
                className="glass-compact grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-3"
              >
                <div
                  className="min-w-0 cursor-pointer"
                  onClick={() => navigate(`/tasks/${task.id}`)}
                >
                  <div className="truncate text-sm font-medium">{task.title}</div>
                  <div className="truncate text-xs text-[var(--text-muted)]">{task.id}</div>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    value={task.status}
                    onChange={(e) => handleTaskStatusChange(task, e.target.value as Task["status"])}
                    className="input-base w-auto px-2 py-1 text-xs"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {["planned", "in-progress", "done", "blocked", "canceled"].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Card className="py-10 text-center">
            <p className="text-[var(--text-muted)]">No tasks yet.</p>
          </Card>
        )}
      </div>

      {/* Goals, desc etc */}
      {phase.description && (
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wider">Description</h3>
          <p className="text-sm whitespace-pre-wrap">{phase.description}</p>
        </Card>
      )}

      {phase.goals.length > 0 && (
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wider">Goals</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {phase.goals.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        </Card>
      )}

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit phase">
        <div className="space-y-4">
          <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            options={[
              { value: "draft", label: "Draft" },
              { value: "discovery", label: "Discovery" },
              { value: "planned", label: "Planned" },
              { value: "in-progress", label: "In Progress" },
              { value: "done", label: "Done" },
              { value: "blocked", label: "Blocked" },
              { value: "canceled", label: "Canceled" },
            ]}
          />
          <Textarea label="Summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} disabled={updatePhase.isPending}>Save</Button>
          </div>
        </div>
      </Modal>

      <Modal open={showCreateTask} onClose={() => setShowCreateTask(false)} title="New task">
        <div className="space-y-4">
          <Input label="Title" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="e.g. Implement endpoint" />
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setShowCreateTask(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleCreateTask} disabled={!taskTitle.trim() || createTask.isPending}>
              {createTask.isPending ? "Creating…" : "Create"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
