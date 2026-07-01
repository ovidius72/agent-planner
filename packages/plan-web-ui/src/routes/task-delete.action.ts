import { redirect } from "react-router-dom";
import { deleteTask } from "../lib/api";
import { requiredParam } from "../lib/forms";

export async function action({ params }: { params: Record<string, string | undefined> }) {
  const featureId = requiredParam(params, "featureId");
  const phaseId = requiredParam(params, "phaseId");
  const taskId = requiredParam(params, "taskId");
  await deleteTask(taskId);
  return redirect(`/features/${featureId}/phases/${phaseId}`);
}
