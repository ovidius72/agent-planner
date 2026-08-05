import { useCallback, useRef } from "react";
import { Form, useNavigation, useParams, useRouteLoaderData } from "react-router-dom";
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
    <ModalShell title="Edit requirement" description="Update status, scope notes, and linked delivery phases.">
      <Form ref={formRef} method="post" className="grid gap-4">
        <Field label="Requirement title">
          <Input name="title" defaultValue={requirement.title} required />
        </Field>
        <Field label="Description">
          <Textarea name="description" defaultValue={requirement.description} />
        </Field>
        <Field label="Status">
          <Select name="status" defaultValue={requirement.status}>
            {requirementStatuses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </Field>
        <LinkedPhaseSelector phases={phases} selectedIds={requirement.linkedPhaseIds} />
        <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3 text-sm text-[var(--text-muted)]">
          Macro tasks are preserved automatically on save. This screen does not edit the nested macro-task list yet.
        </div>
        <ModalActions>
          <Button type="submit" variant="primary" disabled={submitting} shortcut="submit">{submitting ? "Saving…" : "Save requirement"}</Button>
        </ModalActions>
      </Form>
    </ModalShell>
  );
}
