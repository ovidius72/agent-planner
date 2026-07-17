import { useCallback, useRef } from "react";
import { Form, useNavigation, useRouteLoaderData } from "react-router-dom";
import { ModalShell } from "../components/ui/modal-shell";
import { ModalActions } from "../components/ui/modal-actions";
import { Button } from "../components/ui/button";
import { Field } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { featureStatuses } from "../lib/statuses";
import { useShortcut } from "../lib/shortcuts";
import type { Feature, Phase } from "../lib/types";

export function FeatureEditModalRoute() {
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";
  const formRef = useRef<HTMLFormElement>(null);
  const submit = useCallback(() => formRef.current?.requestSubmit(), []);
  useShortcut("submit", submit, { allowInEditable: true });
  const data = useRouteLoaderData("feature-detail") as { feature: Feature; phases: Phase[] };
  const feature = data.feature;

  return (
    <ModalShell title="Edit feature" description="Update metadata, planning notes and timeline.">
      <Form ref={formRef} method="post" className="grid gap-4">
        <Field label="Name"><Input name="name" defaultValue={feature.name} required /></Field>
        <Field label="Description"><Textarea name="description" defaultValue={feature.description} /></Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Start date"><Input type="date" name="startDate" defaultValue={feature.startDate} /></Field>
          <Field label="End date"><Input type="date" name="endDate" defaultValue={feature.endDate} /></Field>
        </div>
        <Field label="Status">
          <Select name="status" defaultValue={feature.status}>
            {featureStatuses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </Field>
        <Field label="Priority"><Input type="number" name="priority" defaultValue={feature.priority ?? 0} min={0} /></Field>
        <Field label="Work done"><Textarea name="workDone" defaultValue={feature.workDone} /></Field>
        <Field label="Work remaining"><Textarea name="workRemaining" defaultValue={feature.workRemaining} /></Field>
        <ModalActions>
          <Button type="submit" variant="primary" disabled={submitting} shortcut="submit">{submitting ? "Saving…" : "Save feature"}</Button>
        </ModalActions>
      </Form>
    </ModalShell>
  );
}
