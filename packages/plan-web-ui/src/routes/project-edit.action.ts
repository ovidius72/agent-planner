import { redirect } from "react-router-dom";
import { getProject, updateProject } from "../lib/api";
import { optionalString } from "../lib/forms";

export async function action({ request }: { request: Request }) {
  const current = await getProject();
  const formData = await request.formData();

  await updateProject({
    ...current,
    goal: optionalString(formData, "goal"),
  });

  return redirect("/");
}
