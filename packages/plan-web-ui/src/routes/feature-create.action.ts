import { redirect } from "react-router-dom";
import { createFeature } from "../lib/api";
import { optionalString, requiredString } from "../lib/forms";

export async function action({ request }: { request: Request }) {
  const formData = await request.formData();
  await createFeature({
    name: requiredString(formData, "name"),
    description: optionalString(formData, "description"),
  });
  return redirect("/features");
}
