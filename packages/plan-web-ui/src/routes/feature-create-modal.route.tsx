import { useCallback, useRef } from "react";
import { useNavigation, Form } from "react-router-dom";
import { ModalShell } from "../components/ui/modal-shell";
import { ModalActions } from "../components/ui/modal-actions";
import { Button } from "../components/ui/button";
import { Field } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { useShortcut } from "../lib/shortcuts";

export function FeatureCreateModalRoute() {
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";
  const formRef = useRef<HTMLFormElement>(null);
  const submit = useCallback(() => formRef.current?.requestSubmit(), []);
  useShortcut("submit", submit, { allowInEditable: true });

  return (
    <ModalShell title="Create feature" description="Top-level container for phases and tasks.">
      <Form ref={formRef} method="post" className="grid gap-4">
        <Field label="Feature name">
          <Input name="name" placeholder="Realizzazione pagina prodotti" required />
        </Field>
        <Field label="Description">
          <Textarea name="description" placeholder="Short context for the feature" />
        </Field>
        <ModalActions>
          <Button type="submit" variant="primary" disabled={submitting} shortcut="submit">{submitting ? "Creating…" : "Create feature"}</Button>
        </ModalActions>
      </Form>
    </ModalShell>
  );
}
