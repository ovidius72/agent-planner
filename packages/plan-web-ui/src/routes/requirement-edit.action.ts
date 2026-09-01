import { redirect } from "react-router-dom";
import { getRequirements, updateRequirement, type MacroTaskInput } from "../lib/api";
import { optionalString, requiredParam, requiredString, submittedMacroTasks } from "../lib/forms";
import type { RequirementStatus } from "../lib/types";

export async function action({ request, params }: { request: Request; params: Record<string, string | undefined> }) {
  const requirementId = requiredParam(params, "requirementId");
  const current = (await getRequirements()).find((entry) => entry.id === requirementId);
  if (!current) throw new Response(`Requirement not found: ${requirementId}`, { status: 404 });
  const formData = await request.formData();

  await updateRequirement({
    ...current,
    title: requiredString(formData, "title"),
    description: optionalString(formData, "description"),
    status: requiredString(formData, "status") as RequirementStatus,
    macroTasks: formData.has("macroTasks") ? submittedMacroTasks(formData) as MacroTaskInput[] : current.macroTasks,
    linkedPhaseIds: formData.getAll("linkedPhaseIds").filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean),
  });

  return redirect("/requirements");
}
