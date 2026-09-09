import { useCallback, useRef } from "react";
import { Form, useNavigation, useRouteLoaderData } from "react-router-dom";
import { LinkedPhaseSelector } from "../components/requirements/linked-phase-selector";
import { MacroTaskEditor } from "../components/requirements/macro-task-editor";
import { Button } from "../components/ui/button";
import { Field } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { ModalActions } from "../components/ui/modal-actions";
import { ModalShell } from "../components/ui/modal-shell";
import { Textarea } from "../components/ui/textarea";
import { useShortcut } from "../lib/shortcuts";
import type { Phase } from "../lib/types";

export function RequirementCreateModalRoute() {
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";
  const formRef = useRef<HTMLFormElement>(null);
  const submit = useCallback(() => formRef.current?.requestSubmit(), []);
  useShortcut("submit", submit, { allowInEditable: true });
  const { phases } = useRouteLoaderData("requirements") as { phases: Phase[] };

  return (
    <ModalShell title="Create requirement" description="Capture a user, business, or system outcome. Coding standards and process rules belong in Project Guidelines.">
      <Form ref={formRef} method="post" className="grid gap-4">
        <Field label="Requirement title">
          <Input name="title" placeholder="Self-hosted Claude Code plugin marketplace distribution" required />
        </Field>
        <Field label="Description">
          <Textarea name="description" placeholder="Describe the user/business outcome this requirement represents" />
        </Field>
        <MacroTaskEditor initialTasks={[]} />
        <LinkedPhaseSelector phases={phases} />
        <ModalActions>
          <Button type="submit" variant="primary" disabled={submitting} shortcut="submit">{submitting ? "Creating…" : "Create requirement"}</Button>
        </ModalActions>
      </Form>
    </ModalShell>
  );
}
