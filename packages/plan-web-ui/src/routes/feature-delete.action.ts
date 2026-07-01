import { redirect } from "react-router-dom";
import { deleteFeature } from "../lib/api";
import { requiredParam } from "../lib/forms";

export async function action({ params }: { params: Record<string, string | undefined> }) {
  await deleteFeature(requiredParam(params, "featureId"));
  return redirect("/features");
}
