import { getFeature, updateFeature } from "../lib/api";
import { requiredParam, requiredString } from "../lib/forms";
import type { FeatureStatus } from "../lib/types";

export async function action({ request, params }: { request: Request; params: Record<string, string | undefined> }) {
  const featureId = requiredParam(params, "featureId");
  const current = await getFeature(featureId);
  const formData = await request.formData();
  await updateFeature({ ...current, status: requiredString(formData, "status") as FeatureStatus });
  return null;
}
