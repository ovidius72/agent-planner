import { getTask, updateTask } from "../lib/api";
import { requiredParam, requiredString } from "../lib/forms";
import type { TaskStatus } from "../lib/types";

export async function action({ request, params }: { request: Request; params: Record<string, string | undefined> }) {
  const phaseId = requiredParam(params, "phaseId");
  const taskId = requiredParam(params, "taskId");
  const current = await getTask(taskId);
  const formData = await request.formData();
  await updateTask({ ...current, phaseId, status: requiredString(formData, "status") as TaskStatus });
  return null;
}
