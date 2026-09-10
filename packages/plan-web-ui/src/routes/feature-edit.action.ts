import { redirect } from "react-router-dom";
import { getFeature, updateFeature } from "../lib/api";
import { optionalNumber, optionalString, requiredParam, requiredString } from "../lib/forms";

export async function action({ request, params }: { request: Request; params: Record<string, string | undefined> }) {
  const featureId = requiredParam(params, "featureId");
  const current = await getFeature(featureId);
  const formData = await request.formData();

  await updateFeature({
    id: current.id,
    updatedAt: current.updatedAt,
    name: requiredString(formData, "name"),
    description: optionalString(formData, "description"),
    descriptionRef: optionalString(formData, "descriptionRef"),
    startDate: optionalString(formData, "startDate"),
    endDate: optionalString(formData, "endDate"),
    priority: optionalNumber(formData, "priority"),
    workDone: optionalString(formData, "workDone"),
    workRemaining: optionalString(formData, "workRemaining"),
  });

  return redirect(`/features/${featureId}`);
}
