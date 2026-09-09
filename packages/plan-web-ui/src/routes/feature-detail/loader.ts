import { getDescriptionFreshness, getFeature, getPhases } from "../../lib/api";

export async function loader({ params }: { params: { featureId?: string } }) {
  const featureId = params.featureId;
  if (!featureId) throw new Response("featureId required", { status: 400 });

  const [feature, phases, descriptionFreshness] = await Promise.all([getFeature(featureId), getPhases(featureId), getDescriptionFreshness()]);
  return { feature, phases, descriptionFreshness };
}
