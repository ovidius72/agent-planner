import { getFeature, getFeatures, getPhase, getRequirements } from "../../lib/api";

export async function loader({ params }: { params: { featureId?: string; phaseId?: string } }) {
  const { featureId, phaseId } = params;
  if (!featureId || !phaseId) throw new Response("featureId and phaseId required", { status: 400 });

  const [feature, features, phase, requirements] = await Promise.all([getFeature(featureId), getFeatures(), getPhase(phaseId), getRequirements()]);
  const linkedRequirements = requirements.filter((requirement) => requirement.linkedPhaseIds.includes(phaseId));
  return { feature, features, phase: { ...phase, linkedRequirements } };
}
