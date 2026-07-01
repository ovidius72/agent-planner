import { redirect } from "react-router-dom";
import { createPhase } from "../lib/api";
import { optionalString, requiredParam, requiredString } from "../lib/forms";

export async function action({ request, params }: { request: Request; params: Record<string, string | undefined> }) {
  const featureId = requiredParam(params, "featureId");
  const formData = await request.formData();

  await createPhase({
    featureId,
    title: requiredString(formData, "title"),
    summary: optionalString(formData, "summary"),
    description: optionalString(formData, "description"),
  });

  return redirect(`/features/${featureId}`);
}
