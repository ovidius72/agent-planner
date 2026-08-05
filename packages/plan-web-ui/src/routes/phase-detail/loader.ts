import { getFeature, getPhase, getRequirements } from "../../lib/api";

export async function loader({ params }: { params: { featureId?: string; phaseId?: string } }) {
  const { featureId, phaseId } = params;
  if (!featureId || !phaseId) throw new Response("featureId and phaseId required", { status: 400 });

  const [feature, phase, requirements] = await Promise.all([getFeature(featureId), getPhase(phaseId), getRequirements()]);
  const linkedRequirements = requirements.filter((requirement) => requirement.linkedPhaseIds.includes(phaseId));
  return { feature, phase: { ...phase, linkedRequirements } };
}
