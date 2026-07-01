import { getFeature, getPhase } from "../../lib/api";

export async function loader({ params }: { params: { featureId?: string; phaseId?: string } }) {
  const { featureId, phaseId } = params;
  if (!featureId || !phaseId) throw new Response("featureId and phaseId required", { status: 400 });

  const [feature, phase] = await Promise.all([getFeature(featureId), getPhase(phaseId)]);
  return { feature, phase };
}
