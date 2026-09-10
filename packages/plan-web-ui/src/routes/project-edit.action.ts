import { redirect } from "react-router-dom";
import { getProject, updateProject } from "../lib/api";
import { optionalString } from "../lib/forms";

export async function action({ request }: { request: Request }) {
  const current = await getProject();
  const formData = await request.formData();

  await updateProject({
    name: optionalString(formData, "name") || current.name,
    description: optionalString(formData, "description"),
    goal: optionalString(formData, "goal"),
    projectGuidelines: { content: optionalString(formData, "projectGuidelines") },
    expectedGuidelinesUpdatedAt: current.projectGuidelines.updatedAt,
  });

  return redirect("/");
}
