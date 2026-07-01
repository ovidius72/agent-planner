import { useState } from "react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Input, Select } from "../ui/Input";
import type { Phase } from "../../types";

interface Props {
  phase: Phase;
  onUpdate: (phase: Phase) => void;
  onDelete: (id: string) => void;
}

export function PhaseCard({ phase, onUpdate, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(phase.title);
  const [status, setStatus] = useState(phase.status);

  function handleSave() {
    onUpdate({ ...phase, title, status });
    setEditing(false);
  }

  const tasksDone = phase.tasks.filter((t) => t.status === "done").length;

  return (
    <Card className="space-y-3">
      {editing ? (
        <div className="space-y-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as Phase["status"])}
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
          <div className="flex gap-2">
            <Button variant="primary" onClick={handleSave}>Save</Button>
            <Button onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium">{phase.title}</div>
              <div className="text-xs text-[var(--text-muted)]">{phase.id}</div>
            </div>
            <span className={`badge status-${phase.status}`}>{phase.status}</span>
          </div>
          {phase.summary && (
            <p className="text-sm text-[var(--text-muted)] line-clamp-2">{phase.summary}</p>
          )}
          <div className="flex items-center justify-between text-xs text-[var(--text-subtle)]">
            <span>{tasksDone}/{phase.tasks.length} task</span>
            <div className="flex gap-2">
              <Button variant="ghost" className="text-xs py-0.5 px-2" onClick={() => setEditing(true)}>Edit</Button>
              <Button variant="ghost" className="text-xs py-0.5 px-2 text-red-400" onClick={() => onDelete(phase.id)}>Delete</Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
