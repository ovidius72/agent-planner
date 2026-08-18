import { redirect } from "react-router-dom";
import { createTask } from "../lib/api";
import { optionalString, requiredParam, requiredString, stringList } from "../lib/forms";
import type { TaskStatus } from "../lib/types";

export async function action({ request, params }: { request: Request; params: Record<string, string | undefined> }) {
  const featureId = requiredParam(params, "featureId");
  const phaseId = requiredParam(params, "phaseId");
  const formData = await request.formData();

  const checklist = stringList(formData, "checklist");
  await createTask(phaseId, {
    title: requiredString(formData, "title"),
    description: optionalString(formData, "description"),
    status: (optionalString(formData, "status") || "planned") as TaskStatus,
    ...(checklist.length ? { checklist } : {}),
  });

  return redirect(`/features/${featureId}/phases/${phaseId}`);
}
