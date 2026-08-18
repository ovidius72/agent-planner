import { redirect } from "react-router-dom";
import { createRequirement } from "../lib/api";
import { optionalString, requiredString } from "../lib/forms";
import type { RequirementStatus } from "../lib/types";

export async function action({ request }: { request: Request }) {
  const formData = await request.formData();
  await createRequirement({
    id: crypto.randomUUID(),
    title: requiredString(formData, "title"),
    description: optionalString(formData, "description"),
    status: requiredString(formData, "status") as RequirementStatus,
    linkedPhaseIds: formData.getAll("linkedPhaseIds").filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean),
  });
  return redirect("/requirements");
}
