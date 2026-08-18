import { redirect } from "react-router-dom";
import { deleteRequirement } from "../lib/api";
import { requiredParam } from "../lib/forms";

export async function action({ params }: { params: Record<string, string | undefined> }) {
  await deleteRequirement(requiredParam(params, "requirementId"));
  return redirect("/requirements");
}
