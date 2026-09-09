import { redirect } from "react-router-dom";
import { createAcceptedDecision, deleteAcceptedDecision, updateAcceptedDecision, type AcceptedDecisionTargetType } from "../lib/api";
import { optionalString, requiredString } from "../lib/forms";

function targetType(formData: FormData): AcceptedDecisionTargetType {
  const value = requiredString(formData, "targetType");
  if (value === "project" || value === "feature" || value === "phase" || value === "task") return value;
  throw new Response(`Unsupported accepted decision target: ${value}`, { status: 400 });
}

function returnTo(formData: FormData): string {
  const value = optionalString(formData, "returnTo");
  return value?.startsWith("/") ? value : "/";
}

export async function action({ request }: { request: Request }) {
  const formData = await request.formData();
  const intent = requiredString(formData, "intent");
  const target = {
    targetType: targetType(formData),
    targetRef: optionalString(formData, "targetRef"),
  };

  if (intent === "create") {
    await createAcceptedDecision({
      ...target,
      title: requiredString(formData, "title"),
      decision: optionalString(formData, "decision") ?? "",
      rationale: optionalString(formData, "rationale") ?? "",
      implementationNotes: optionalString(formData, "implementationNotes") ?? "",
    });
    return redirect(returnTo(formData));
  }

  const id = requiredString(formData, "decisionId");
  if (intent === "update") {
    await updateAcceptedDecision({
      ...target,
      id,
      title: requiredString(formData, "title"),
      decision: optionalString(formData, "decision") ?? "",
      rationale: optionalString(formData, "rationale") ?? "",
      implementationNotes: optionalString(formData, "implementationNotes") ?? "",
    });
    return redirect(returnTo(formData));
  }

  if (intent === "delete") {
    await deleteAcceptedDecision({ ...target, id });
    return redirect(returnTo(formData));
  }

  throw new Response(`Unsupported accepted decision action: ${intent}`, { status: 400 });
}
