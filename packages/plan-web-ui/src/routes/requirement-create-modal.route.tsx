import { useCallback, useRef } from "react";
import { Form, useNavigation, useRouteLoaderData } from "react-router-dom";
import { LinkedPhaseSelector } from "../components/requirements/linked-phase-selector";
import { Button } from "../components/ui/button";
import { Field } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { ModalActions } from "../components/ui/modal-actions";
import { ModalShell } from "../components/ui/modal-shell";
import { Select } from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { useShortcut } from "../lib/shortcuts";
import { requirementStatuses } from "../lib/statuses";
import type { Phase } from "../lib/types";

export function RequirementCreateModalRoute() {
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";
  const formRef = useRef<HTMLFormElement>(null);
  const submit = useCallback(() => formRef.current?.requestSubmit(), []);
  useShortcut("submit", submit, { allowInEditable: true });
  const { phases } = useRouteLoaderData("requirements") as { phases: Phase[] };

  return (
    <ModalShell title="Create requirement" description="Capture a top-level outcome that phases can implement and track.">
      <Form ref={formRef} method="post" className="grid gap-4">
        <Field label="Requirement title">
          <Input name="title" placeholder="Self-hosted Claude Code plugin marketplace distribution" required />
        </Field>
        <Field label="Description">
          <Textarea name="description" placeholder="Describe the user/business outcome this requirement represents" />
        </Field>
        <Field label="Status">
          <Select name="status" defaultValue="planned">
            {requirementStatuses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </Field>
        <LinkedPhaseSelector phases={phases} />
        <ModalActions>
          <Button type="submit" variant="primary" disabled={submitting} shortcut="submit">{submitting ? "Creating…" : "Create requirement"}</Button>
        </ModalActions>
      </Form>
    </ModalShell>
  );
}
