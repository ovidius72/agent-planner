import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getTask, getPhases } from "../api";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Input";
import type { Task } from "../types";

export function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: task, isLoading } = useQuery({
    queryKey: ["task", id],
    queryFn: () => getTask(id!),
    enabled: !!id,
  });
  const { data: phases } = useQuery({
    queryKey: ["phases-all"],
    queryFn: () => getPhases(),
  });

  if (isLoading) return <div className="py-20 text-center text-[var(--text-muted)]">Loading…</div>;
  if (!task) return <div className="py-20 text-center text-[var(--text-muted)]">Task not found</div>;

  const parentPhase = phases?.find((p) => p.id === task.phaseId);

  return (
    <div className="space-y-8">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
        <ArrowLeft size={16} /> Back
      </button>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight">{task.title}</h1>
            <Badge status={task.status} />
          </div>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{task.id}</p>
          {parentPhase && (
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Phase: <span className="cursor-pointer text-[var(--accent)] hover:underline" onClick={() => navigate(`/phases/${parentPhase.id}`)}>{parentPhase.title}</span>
            </p>
          )}
        </div>
      </div>

      {task.description && (
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wider">Description</h3>
          <p className="text-sm whitespace-pre-wrap">{task.description}</p>
        </Card>
      )}

      {task.checklist.length > 0 && (
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wider">Checklist</h3>
          <ul className="space-y-1 text-sm">
            {task.checklist.map((item, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="h-4 w-4 rounded border border-[var(--border-strong)]" />
                {item}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {task.subtasks.length > 0 && (
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wider">Subtasks</h3>
          <div className="space-y-2">
            {task.subtasks.map((st) => (
              <div key={st.id} className="flex items-center gap-3">
                <Badge status={st.status} />
                <span className="text-sm">{st.title}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
