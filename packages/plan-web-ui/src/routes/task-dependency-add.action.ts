import { redirect } from "react-router-dom";
import { addTaskDependency } from "../lib/api";
import { requiredParam } from "../lib/forms";

export async function action({ request, params }: { request: Request; params: Record<string, string | undefined> }) {
  const featureId = requiredParam(params, "featureId");
  const phaseId = requiredParam(params, "phaseId");
  const taskId = requiredParam(params, "taskId");
  const form = await request.formData();
  await addTaskDependency(taskId, phaseId, String(form.get("dependsOn") ?? ""));
  return redirect(`/features/${featureId}/phases/${phaseId}/tasks/${taskId}`);
}
