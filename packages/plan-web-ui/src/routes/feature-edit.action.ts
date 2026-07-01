import { redirect } from "react-router-dom";
import { getFeature, updateFeature } from "../lib/api";
import { optionalString, requiredParam, requiredString } from "../lib/forms";
import type { FeatureStatus } from "../lib/types";

export async function action({ request, params }: { request: Request; params: Record<string, string | undefined> }) {
  const featureId = requiredParam(params, "featureId");
  const current = await getFeature(featureId);
  const formData = await request.formData();

  await updateFeature({
    ...current,
    name: requiredString(formData, "name"),
    description: optionalString(formData, "description"),
    startDate: optionalString(formData, "startDate"),
    endDate: optionalString(formData, "endDate"),
    status: requiredString(formData, "status") as FeatureStatus,
    workDone: optionalString(formData, "workDone"),
    workRemaining: optionalString(formData, "workRemaining"),
  });

  return redirect(`/features/${featureId}`);
}
