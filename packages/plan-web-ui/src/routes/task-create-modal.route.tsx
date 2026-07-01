import { useCallback, useRef } from "react";
import { Form, useNavigation } from "react-router-dom";
import { ModalShell } from "../components/ui/modal-shell";
import { ModalActions } from "../components/ui/modal-actions";
import { Button } from "../components/ui/button";
import { Field } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { taskStatuses } from "../lib/statuses";
import { useShortcut } from "../lib/shortcuts";

export function TaskCreateModalRoute() {
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";
  const formRef = useRef<HTMLFormElement>(null);
  const submit = useCallback(() => formRef.current?.requestSubmit(), []);
  useShortcut("submit", submit, { allowInEditable: true });

  return (
    <ModalShell title="Create task" description="A task belongs to the current phase.">
      <Form ref={formRef} method="post" className="grid gap-4">
        <Field label="Task title"><Input name="title" placeholder="Integrazione custom fetcher" required /></Field>
        <Field label="Description"><Textarea name="description" placeholder="Initial task context" /></Field>
        <Field label="Status">
          <Select name="status" defaultValue="planned">
            {taskStatuses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </Field>
        <ModalActions>
          <Button type="submit" variant="primary" disabled={submitting} shortcut="submit">{submitting ? "Creating…" : "Create task"}</Button>
        </ModalActions>
      </Form>
    </ModalShell>
  );
}
