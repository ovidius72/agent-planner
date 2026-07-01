import { redirect } from "react-router-dom";
import { deletePhase } from "../lib/api";
import { requiredParam } from "../lib/forms";

export async function action({ params }: { params: Record<string, string | undefined> }) {
  const featureId = requiredParam(params, "featureId");
  const phaseId = requiredParam(params, "phaseId");
  await deletePhase(phaseId);
  return redirect(`/features/${featureId}`);
}
