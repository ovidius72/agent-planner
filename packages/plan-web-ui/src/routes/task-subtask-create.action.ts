import { redirect } from "react-router-dom";
import { createSubtask } from "../lib/api";
import { requiredParam } from "../lib/forms";

export async function action({ request, params }: { request: Request; params: Record<string, string | undefined> }) {
  const featureId = requiredParam(params, "featureId");
  const phaseId = requiredParam(params, "phaseId");
  const taskId = requiredParam(params, "taskId");
  const form = await request.formData();
  await createSubtask(taskId, phaseId, { title: String(form.get("title") ?? ""), description: String(form.get("description") ?? "") });
  return redirect(`/features/${featureId}/phases/${phaseId}/tasks/${taskId}`);
}
