import { redirect } from "react-router-dom";
import { getPhase, updatePhase } from "../lib/api";
import { optionalString, requiredParam, requiredString, stringList } from "../lib/forms";
import type { PhaseStatus } from "../lib/types";

export async function action({ request, params }: { request: Request; params: Record<string, string | undefined> }) {
  const featureId = requiredParam(params, "featureId");
  const phaseId = requiredParam(params, "phaseId");
  const current = await getPhase(phaseId);
  const formData = await request.formData();

  await updatePhase({
    ...current,
    title: requiredString(formData, "title"),
    status: requiredString(formData, "status") as PhaseStatus,
    summary: optionalString(formData, "summary"),
    description: optionalString(formData, "description"),
    goals: stringList(formData, "goals"),
    nonGoals: stringList(formData, "nonGoals"),
    dependencies: stringList(formData, "dependencies"),
    risks: stringList(formData, "risks"),
    openQuestions: stringList(formData, "openQuestions"),
    completionCriteria: stringList(formData, "completionCriteria"),
  });

  return redirect(`/features/${featureId}/phases/${phaseId}`);
}
