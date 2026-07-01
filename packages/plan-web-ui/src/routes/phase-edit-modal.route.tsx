import { useCallback, useRef } from "react";
import { Form, useNavigation, useRouteLoaderData } from "react-router-dom";
import { ModalShell } from "../components/ui/modal-shell";
import { ModalActions } from "../components/ui/modal-actions";
import { Button } from "../components/ui/button";
import { Field } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { phaseStatuses } from "../lib/statuses";
import { useShortcut } from "../lib/shortcuts";
import type { Feature, Phase } from "../lib/types";

function joinLines(values: string[]) {
  return values.join("\n");
}

export function PhaseEditModalRoute() {
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";
  const formRef = useRef<HTMLFormElement>(null);
  const submit = useCallback(() => formRef.current?.requestSubmit(), []);
  useShortcut("submit", submit, { allowInEditable: true });
  const data = useRouteLoaderData("phase-detail") as { feature: Feature; phase: Phase };
  const phase = data.phase;

  return (
    <ModalShell title="Edit phase" description="Update scope, constraints and delivery criteria.">
      <Form ref={formRef} method="post" className="grid gap-4">
        <Field label="Title"><Input name="title" defaultValue={phase.title} required /></Field>
        <Field label="Status">
          <Select name="status" defaultValue={phase.status}>
            {phaseStatuses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </Field>
        <Field label="Summary"><Textarea name="summary" defaultValue={phase.summary} /></Field>
        <Field label="Description"><Textarea name="description" defaultValue={phase.description} /></Field>
        <Field label="Goals (one per line)"><Textarea name="goals" defaultValue={joinLines(phase.goals)} /></Field>
        <Field label="Non-goals (one per line)"><Textarea name="nonGoals" defaultValue={joinLines(phase.nonGoals)} /></Field>
        <Field label="Dependencies (one per line)"><Textarea name="dependencies" defaultValue={joinLines(phase.dependencies)} /></Field>
        <Field label="Risks (one per line)"><Textarea name="risks" defaultValue={joinLines(phase.risks)} /></Field>
        <Field label="Open questions (one per line)"><Textarea name="openQuestions" defaultValue={joinLines(phase.openQuestions)} /></Field>
        <Field label="Completion criteria (one per line)"><Textarea name="completionCriteria" defaultValue={joinLines(phase.completionCriteria)} /></Field>
        <ModalActions>
          <Button type="submit" variant="primary" disabled={submitting} shortcut="submit">{submitting ? "Saving…" : "Save phase"}</Button>
        </ModalActions>
      </Form>
    </ModalShell>
  );
}
