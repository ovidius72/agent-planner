import { getTask, updateTask } from "../lib/api";
import { requiredParam, requiredString } from "../lib/forms";

export async function action({ request, params }: { request: Request; params: Record<string, string | undefined> }) {
  requiredParam(params, "featureId");
  const phaseId = requiredParam(params, "phaseId");
  const taskId = requiredParam(params, "taskId");
  const itemId = requiredParam(params, "itemId");
  const formData = await request.formData();
  const checked = requiredString(formData, "checked") === "true";
  const current = await getTask(taskId);

  await updateTask({
    ...current,
    phaseId,
    checklist: current.checklist.map((item) => item.id === itemId ? { ...item, checked } : item),
  });

  return Response.json({ ok: true, taskId, itemId, checked });
}
