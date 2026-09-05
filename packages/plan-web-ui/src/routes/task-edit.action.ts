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
      ? { ...existing, number: index + 1, title: title.trim() }
      : { id: `check-${index + 1}-${normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item"}`,
          number: index + 1,
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
  const status = requiredString(formData, "status") as TaskStatus;
  if (status === "in-progress" && current.status !== "in-progress") {
    throw new Response("Use Start task or Resume task to enter in-progress.", { status: 400 });
  }

  await updateTask({
    id: current.id,
    updatedAt: current.updatedAt,
    phaseId,
    title: requiredString(formData, "title"),
    status,
    priority: optionalNumber(formData, "priority"),
    description: optionalString(formData, "description"),
    descriptionRef: optionalString(formData, "descriptionRef"),
    notes: optionalString(formData, "notes"),
    decisions: stringList(formData, "decisions"),
    motivation: optionalString(formData, "motivation"),
    checklist: mergeChecklist(current.checklist, stringList(formData, "checklist")),
  });

  return redirect(`/features/${featureId}/phases/${phaseId}/tasks/${taskId}`);
}
