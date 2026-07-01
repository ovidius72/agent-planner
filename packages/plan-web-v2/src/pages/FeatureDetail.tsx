import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getPhases } from "../api";
import {
  useFeature,
  useUpdateFeature,
  useDeleteFeature,
  useCreatePhase,
  useUpdatePhase,
  useDeletePhase,
} from "../hooks/use-queries";
import { Button } from "../components/ui/Button";
import { Input, Textarea, Select } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { PhaseCard } from "../components/phases/PhaseCard";
import type { Feature, Phase } from "../types";

export function FeatureDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: feature, isLoading } = useFeature(id!);
  const { data: phases } = useQuery({
    queryKey: ["phases", id],
    queryFn: () => getPhases(id),
    enabled: !!id,
  });
  const updateFeature = useUpdateFeature();
  const deleteFeatureMut = useDeleteFeature();
  const createPhase = useCreatePhase();
  const updatePhase = useUpdatePhase();
  const deletePhase = useDeletePhase();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Feature["status"]>("planned");
  const [workDone, setWorkDone] = useState("");
  const [workRemaining, setWorkRemaining] = useState("");

  const [showCreatePhase, setShowCreatePhase] = useState(false);
  const [phaseTitle, setPhaseTitle] = useState("");

  if (isLoading) return <div className="py-20 text-center text-[var(--text-muted)]">Loading…</div>;
  if (!feature)
    return <div className="py-20 text-center text-[var(--text-muted)]">Feature not found</div>;

  const f = feature;
  const allTasks = phases?.flatMap((p) => p.tasks) ?? [];
  const doneTasks = allTasks.filter((t) => t.status === "done").length;

  function startEdit() {
    setName(f.name);
    setDescription(f.description);
    setStatus(f.status);
    setWorkDone(f.workDone);
    setWorkRemaining(f.workRemaining);
    setEditing(true);
  }

  function handleSave() {
    updateFeature.mutate(
      { ...f, name, description, status, workDone, workRemaining },
      {
        onSuccess: () => setEditing(false),
      },
    );
  }

  function handleDelete() {
    if (confirm("Delete this feature and all its phases?")) {
      deleteFeatureMut.mutate(f.id, { onSuccess: () => navigate("/features") });
    }
  }

  function handleCreatePhase() {
    if (!phaseTitle.trim()) return;
    createPhase.mutate(
      { title: phaseTitle.trim(), featureId: f.id },
      {
        onSuccess: () => {
          setPhaseTitle("");
          setShowCreatePhase(false);
        },
      },
    );
  }

  function handleUpdatePhase(phase: Phase) {
    updatePhase.mutate(phase);
  }

  function handleDeletePhase(phaseId: string) {
    if (confirm("Delete this phase?")) deletePhase.mutate(phaseId);
  }

  return (
    <div className="space-y-8">
      {/* Back */}
      <button
        onClick={() => navigate("/features")}
        className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
      >
        <ArrowLeft size={16} /> Back to features
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight">{f.name}</h1>
            <Badge status={f.status} />
          </div>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{f.id}</p>
          {f.description && <p className="mt-2 text-[var(--text-muted)]">{f.description}</p>}
        </div>
        <div className="flex gap-2 shrink-0">
          <Button onClick={startEdit}>Edit</Button>
          <Button variant="danger" onClick={handleDelete}>
            <Trash2 size={16} />
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card className="text-center py-4">
          <div className="text-2xl font-black">{phases?.length ?? 0}</div>
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Phases</div>
        </Card>
        <Card className="text-center py-4">
          <div className="text-2xl font-black">{allTasks.length}</div>
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Tasks</div>
        </Card>
        <Card className="text-center py-4">
          <div className="text-2xl font-black">{doneTasks}</div>
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Done</div>
        </Card>
        <Card className="text-center py-4">
          <div className="text-2xl font-black">
            {allTasks.length ? Math.round((doneTasks / allTasks.length) * 100) : 0}%
          </div>
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Progress</div>
        </Card>
      </div>

      {/* Work logs */}
      {(f.workDone || f.workRemaining) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {f.workDone && (
            <Card>
              <h3 className="mb-2 text-sm font-semibold text-[var(--text-muted)]">Work done</h3>
              <p className="text-sm whitespace-pre-wrap">{f.workDone}</p>
            </Card>
          )}
          {f.workRemaining && (
            <Card>
              <h3 className="mb-2 text-sm font-semibold text-[var(--text-muted)]">
                Work remaining
              </h3>
              <p className="text-sm whitespace-pre-wrap">{f.workRemaining}</p>
            </Card>
          )}
        </div>
      )}

      {/* Phases */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Phases</h2>
          <Button variant="primary" onClick={() => setShowCreatePhase(true)}>
            <Plus size={16} /> New phase
          </Button>
        </div>
        {phases && phases.length > 0 ? (
          <div className="space-y-4">
            {phases.map((phase) => (
              <PhaseCard
                key={phase.id}
                phase={phase}
                onUpdate={handleUpdatePhase}
                onDelete={handleDeletePhase}
              />
            ))}
          </div>
        ) : (
          <Card className="py-10 text-center">
            <p className="text-[var(--text-muted)]">No phases yet.</p>
          </Card>
        )}
      </div>

      {/* Edit feature modal */}
      <Modal open={editing} onClose={() => setEditing(false)} title="Edit feature">
        <div className="space-y-4">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Textarea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value as Feature["status"])}
            options={[
              { value: "planned", label: "Planned" },
              { value: "in-progress", label: "In Progress" },
              { value: "done", label: "Done" },
              { value: "blocked", label: "Blocked" },
              { value: "canceled", label: "Canceled" },
            ]}
          />
          <Textarea label="Done" value={workDone} onChange={(e) => setWorkDone(e.target.value)} />
          <Textarea
            label="Remaining"
            value={workRemaining}
            onChange={(e) => setWorkRemaining(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} disabled={updateFeature.isPending}>
              Save
            </Button>
          </div>
        </div>
      </Modal>

      {/* Create phase modal */}
      <Modal open={showCreatePhase} onClose={() => setShowCreatePhase(false)} title="New phase">
        <div className="space-y-4">
          <Input
            label="Title"
            value={phaseTitle}
            onChange={(e) => setPhaseTitle(e.target.value)}
            placeholder="e.g. API implementation"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setShowCreatePhase(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleCreatePhase}
              disabled={!phaseTitle.trim() || createPhase.isPending}
            >
              {createPhase.isPending ? "Creating…" : "Create"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
