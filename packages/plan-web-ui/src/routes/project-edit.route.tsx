import { ArrowLeft } from "lucide-react";
import { useCallback, useRef } from "react";
import { Form, Link, useNavigation, useRouteLoaderData } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Field } from "../components/ui/field";
import { Textarea } from "../components/ui/textarea";
import { useShortcut } from "../lib/shortcuts";
import type { Project } from "../lib/types";

export function ProjectEditRoute() {
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";
  const formRef = useRef<HTMLFormElement>(null);
  const submit = useCallback(() => formRef.current?.requestSubmit(), []);
  useShortcut("submit", submit, { allowInEditable: true });
  const { project } = useRouteLoaderData("root") as { project: Project };

  return (
    <div className="grid gap-8">
      <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent)] hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </Link>

      <Card className="grid gap-5">
        <div>
          <h2 className="text-xl font-black tracking-tight text-[var(--text)]">Edit project goal</h2>
          <p className="mt-2 text-sm text-[var(--text-muted)]">Define the main objective of the project. This long-form goal appears in the Project Goal card on the dashboard.</p>
        </div>

        <Form ref={formRef} method="post" className="grid gap-4">
          <Field label="Project goal">
            <Textarea
              name="goal"
              defaultValue={project.goal}
              placeholder="Define the main objective, success criteria, and overall direction of the project"
            />
          </Field>
          <div className="flex justify-end gap-3">
            <Link to="/">
              <Button type="button" variant="ghost">Cancel</Button>
            </Link>
            <Button type="submit" variant="primary" disabled={submitting} shortcut="submit">
              {submitting ? "Saving…" : "Save goal"}
            </Button>
          </div>
        </Form>
      </Card>
    </div>
  );
}
