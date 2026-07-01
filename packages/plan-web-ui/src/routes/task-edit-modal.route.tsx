import { useCallback, useRef } from "react";
import { Form, useNavigation, useRouteLoaderData } from "react-router-dom";
import { ModalShell } from "../components/ui/modal-shell";
import { ModalActions } from "../components/ui/modal-actions";
import { Button } from "../components/ui/button";
import { Field } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { taskStatuses } from "../lib/statuses";
import { useShortcut } from "../lib/shortcuts";
import type { Feature, Phase, Task } from "../lib/types";

function joinLines(values: { title: string }[]) {
  return values.map((value) => value.title).join("\n");
}

export function TaskEditModalRoute() {
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";
  const formRef = useRef<HTMLFormElement>(null);
  const submit = useCallback(() => formRef.current?.requestSubmit(), []);
  useShortcut("submit", submit, { allowInEditable: true });
  const data = useRouteLoaderData("task-detail") as { feature: Feature; phase: Phase; task: Task };
  const task = data.task;

  return (
    <ModalShell title="Edit task" description="Update execution details and checklist items.">
      <Form ref={formRef} method="post" className="grid gap-4">
        <Field label="Title"><Input name="title" defaultValue={task.title} required /></Field>
        <Field label="Status">
          <Select name="status" defaultValue={task.status}>
            {taskStatuses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </Field>
        <Field label="Description"><Textarea name="description" defaultValue={task.description} /></Field>
        <Field label="Checklist (one per line)"><Textarea name="checklist" defaultValue={joinLines(task.checklist)} /></Field>
        <ModalActions>
          <Button type="submit" variant="primary" disabled={submitting} shortcut="submit">{submitting ? "Saving…" : "Save task"}</Button>
        </ModalActions>
      </Form>
    </ModalShell>
  );
}
