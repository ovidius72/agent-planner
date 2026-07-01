import { useCallback, useRef } from "react";
import { Form, useNavigation } from "react-router-dom";
import { ModalShell } from "../components/ui/modal-shell";
import { ModalActions } from "../components/ui/modal-actions";
import { Button } from "../components/ui/button";
import { Field } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { useShortcut } from "../lib/shortcuts";

export function PhaseCreateModalRoute() {
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";
  const formRef = useRef<HTMLFormElement>(null);
  const submit = useCallback(() => formRef.current?.requestSubmit(), []);
  useShortcut("submit", submit, { allowInEditable: true });

  return (
    <ModalShell title="Create phase" description="A phase belongs to the current feature.">
      <Form ref={formRef} method="post" className="grid gap-4">
        <Field label="Phase title"><Input name="title" placeholder="Creazione APIs" required /></Field>
        <Field label="Summary"><Textarea name="summary" placeholder="Brief phase summary" /></Field>
        <Field label="Description"><Textarea name="description" placeholder="Initial implementation notes" /></Field>
        <ModalActions>
          <Button type="submit" variant="primary" disabled={submitting} shortcut="submit">{submitting ? "Creating…" : "Create phase"}</Button>
        </ModalActions>
      </Form>
    </ModalShell>
  );
}
