import { redirect } from "react-router-dom";
import { createRequirement, type MacroTaskInput } from "../lib/api";
import { optionalString, requiredString, submittedMacroTasks } from "../lib/forms";
import type { RequirementStatus } from "../lib/types";

export async function action({ request }: { request: Request }) {
  const formData = await request.formData();
  await createRequirement({
    title: requiredString(formData, "title"),
    description: optionalString(formData, "description"),
    status: requiredString(formData, "status") as RequirementStatus,
    macroTasks: submittedMacroTasks(formData) as MacroTaskInput[],
    linkedPhaseIds: formData.getAll("linkedPhaseIds").filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean),
  });
  return redirect("/requirements");
}
