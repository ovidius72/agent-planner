import { getFeature, getPhase, getProject, getTask } from "../../lib/api";

export async function loader({ params }: { params: { featureId?: string; phaseId?: string; taskId?: string } }) {
  const { featureId, phaseId, taskId } = params;
  if (!featureId || !phaseId || !taskId) throw new Response("featureId, phaseId and taskId required", { status: 400 });

  const [feature, phase, task, project] = await Promise.all([
    getFeature(featureId), getPhase(phaseId), getTask(taskId), getProject(),
  ]);
  const pendingResume = task.status !== "done"
    && task.status !== "canceled"
    && task.status !== "rejected"
    && (Boolean(task.pauseSnapshot) || project.workDeviations.some((deviation) =>
      deviation.resumeTaskId === task.id
        && (deviation.state === "resume-required" || deviation.state === "resolved"),
    ));
  return { feature, phase, task, pendingResume };
}
