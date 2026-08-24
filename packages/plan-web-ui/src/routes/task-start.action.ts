import { redirect } from "react-router-dom";
import { startTask } from "../lib/api";
import { requiredParam } from "../lib/forms";

/** Start or resume work via the server lifecycle endpoint, never a generic edit. */
export async function action({ params }: { params: Record<string, string | undefined> }) {
  const featureId = requiredParam(params, "featureId");
  const phaseId = requiredParam(params, "phaseId");
  const taskId = requiredParam(params, "taskId");
  await startTask(taskId);
  return redirect(`/features/${featureId}/phases/${phaseId}/tasks/${taskId}`);
}
