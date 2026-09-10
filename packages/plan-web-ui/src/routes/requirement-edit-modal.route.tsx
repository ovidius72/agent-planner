import { useCallback, useRef } from "react";
import { Form, useNavigation, useParams, useRouteLoaderData } from "react-router-dom";
import { LinkedPhaseSelector } from "../components/requirements/linked-phase-selector";
import { MacroTaskEditor } from "../components/requirements/macro-task-editor";
import { Button } from "../components/ui/button";
import { Field } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { ModalActions } from "../components/ui/modal-actions";
import { ModalShell } from "../components/ui/modal-shell";
import { Textarea } from "../components/ui/textarea";
import { useShortcut } from "../lib/shortcuts";
import type { Phase, Requirement } from "../lib/types";

export function RequirementEditModalRoute() {
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";
  const formRef = useRef<HTMLFormElement>(null);
  const submit = useCallback(() => formRef.current?.requestSubmit(), []);
  useShortcut("submit", submit, { allowInEditable: true });
  const { requirementId } = useParams();
  const { phases, requirements } = useRouteLoaderData("requirements") as { phases: Phase[]; requirements: Requirement[] };
  const requirement = requirements.find((entry) => entry.id === requirementId);
  if (!requirement) return null;

  return (
    <ModalShell title="Edit requirement" description="Update the product outcome and linked delivery phases. Coding standards and process rules belong in Project Guidelines.">
      <Form ref={formRef} method="post" className="grid gap-4">
        <Field label="Requirement title">
          <Input name="title" defaultValue={requirement.title} required />
        </Field>
        <Field label="Description">
          <Textarea name="description" defaultValue={requirement.description} />
        </Field>
        <MacroTaskEditor initialTasks={requirement.macroTasks} />
        <LinkedPhaseSelector phases={phases} selectedIds={requirement.linkedPhaseIds} />
        <ModalActions>
          <Button type="submit" variant="primary" disabled={submitting} shortcut="submit">{submitting ? "Saving…" : "Save requirement"}</Button>
        </ModalActions>
      </Form>
    </ModalShell>
  );
}
