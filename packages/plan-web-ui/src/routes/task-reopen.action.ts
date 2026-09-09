import { redirect } from "react-router-dom";
import { reopenTask } from "../lib/api";
import { requiredParam } from "../lib/forms";

/** Reopen a completed task through the confirmation-gated lifecycle endpoint. */
export async function action({ params }: { params: Record<string, string | undefined> }) {
  const featureId = requiredParam(params, "featureId");
  const phaseId = requiredParam(params, "phaseId");
  const taskId = requiredParam(params, "taskId");
  await reopenTask(taskId);
  return redirect(`/features/${featureId}/phases/${phaseId}/tasks/${taskId}`);
}
