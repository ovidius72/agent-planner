import { redirect } from "react-router-dom";
import { getTask, updateTask } from "../lib/api";
import { optionalNumber, optionalString, requiredParam, requiredString, stringList } from "../lib/forms";
import type { ChecklistItem, TaskStatus } from "../lib/types";

function mergeChecklist(current: ChecklistItem[], nextTitles: string[]): ChecklistItem[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  const byTitle = new Map(current.map((item) => [item.title.trim().toLowerCase(), item]));

  return nextTitles.map((title, index) => {
    const normalized = title.trim().toLowerCase();
    const existing = byId.get(current[index]?.id ?? "") ?? byTitle.get(normalized);
    return existing
      ? { ...existing, title: title.trim() }
      : { id: `check-${index + 1}-${normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item"}`,
          title: title.trim(),
          checked: false };
  });
}

export async function action({ request, params }: { request: Request; params: Record<string, string | undefined> }) {
  const featureId = requiredParam(params, "featureId");
  const phaseId = requiredParam(params, "phaseId");
  const taskId = requiredParam(params, "taskId");
  const current = await getTask(taskId);
  const formData = await request.formData();

  await updateTask({
    ...current,
    phaseId,
    title: requiredString(formData, "title"),
    status: requiredString(formData, "status") as TaskStatus,
    priority: optionalNumber(formData, "priority"),
    description: optionalString(formData, "description"),
    checklist: mergeChecklist(current.checklist, stringList(formData, "checklist")),
  });

  return redirect(`/features/${featureId}/phases/${phaseId}/tasks/${taskId}`);
}
