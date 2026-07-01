import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { useFeatures, useUpdateFeature, useCreateFeature } from "../hooks/use-queries";
import { useQuery } from "@tanstack/react-query";
import { getPhases } from "../api";
import { Button } from "../components/ui/Button";
import { Input, Textarea } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { Card } from "../components/ui/Card";
import { FeatureRow } from "../components/features/FeatureRow";
import type { Feature } from "../types";

export function Features() {
  const { data: features, isLoading } = useFeatures();
  const { data: phases } = useQuery({ queryKey: ["phases-all"], queryFn: () => getPhases() });
  const updateFeature = useUpdateFeature();
  const createFeature = useCreateFeature();
  const navigate = useNavigate();

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const allTasks = phases?.flatMap((p) => p.tasks) ?? [];

  const handleStatusChange = (id: string, status: Feature["status"]) => {
    const f = features?.find((x) => x.id === id);
    if (f) updateFeature.mutate({ ...f, status });
  };

  const handleCreate = () => {
    if (!name.trim()) return;
    createFeature.mutate({ name: name.trim(), description: description.trim() || undefined }, {
      onSuccess: () => { setName(""); setDescription(""); setShowCreate(false); },
    });
  };

  if (isLoading) return <div className="py-20 text-center text-[var(--text-muted)]">Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black tracking-tight">Features</h1>
        <Button variant="primary" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> New feature
        </Button>
      </div>

      {features && features.length > 0 ? (
        <div className="space-y-2">
          {features.map((feature) => (
            <div key={feature.id} className="cursor-pointer" onClick={() => navigate(`/features/${feature.id}`)}>
              <FeatureRow
                feature={feature}
                phasesCount={phases?.filter((p) => p.featureId === feature.id).length ?? 0}
                tasksCount={allTasks.filter((t) => {
                  const phase = phases?.find((p) => p.featureId === feature.id);
                  return phase?.tasks.some((pt) => pt.id === t.id);
                }).length}
                onStatusChange={handleStatusChange}
              />
            </div>
          ))}
        </div>
      ) : (
        <Card className="py-12 text-center">
          <p className="text-[var(--text-muted)]">No features yet. Create your first feature.</p>
        </Card>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New feature">
        <div className="space-y-4">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Product page" />
          <Textarea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this feature about?" />
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleCreate} disabled={!name.trim() || createFeature.isPending}>
              {createFeature.isPending ? "Creating…" : "Create"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
