import { getFeature, getPhase, getTask } from "../../lib/api";

export async function loader({ params }: { params: { featureId?: string; phaseId?: string; taskId?: string } }) {
  const { featureId, phaseId, taskId } = params;
  if (!featureId || !phaseId || !taskId) throw new Response("featureId, phaseId and taskId required", { status: 400 });

  const [feature, phase, task] = await Promise.all([getFeature(featureId), getPhase(phaseId), getTask(taskId)]);
  return { feature, phase, task };
}
