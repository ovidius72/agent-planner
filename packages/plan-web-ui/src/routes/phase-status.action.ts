import { getPhase, updatePhase } from "../lib/api";
import { requiredParam, requiredString } from "../lib/forms";
import type { PhaseStatus } from "../lib/types";

export async function action({ request, params }: { request: Request; params: Record<string, string | undefined> }) {
  const phaseId = requiredParam(params, "phaseId");
  const current = await getPhase(phaseId);
  const formData = await request.formData();
  await updatePhase({ ...current, status: requiredString(formData, "status") as PhaseStatus });
  return null;
}
