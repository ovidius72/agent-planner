import { ArrowLeft } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Form, Link, useNavigation, useRevalidator, useRouteLoaderData } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Field } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import {
  applyProjectContextMigration,
  previewProjectContextMigration,
  type LegacyProjectContextMigrationPreview,
} from "../lib/api";
import { useShortcut } from "../lib/shortcuts";
import type { Project } from "../lib/types";

function MigrationPreview({ preview }: { preview: LegacyProjectContextMigrationPreview }) {
  return (
    <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3 text-sm text-[var(--text-muted)]">
      <p className="font-semibold text-[var(--text)]">Migration preview</p>
      <ul className="mt-2 grid gap-1 pl-5">
        <li className="list-disc">{preview.guidelineAdditions.length} Project Guidelines addition(s); {preview.skippedGuidelineDuplicates} duplicate(s) skipped.</li>
        <li className="list-disc">{preview.acceptedDecisionAdditions.length} accepted decision addition(s); {preview.skippedDecisionDuplicates} duplicate(s) skipped.</li>
        <li className="list-disc">Applying clears only: {preview.fieldsClearedOnApply.join(", ") || "nothing"}.</li>
      </ul>
      {preview.guidelineAdditions.length > 0 ? (
        <ul className="mt-3 grid gap-1 border-t border-[var(--border)] pt-3 pl-5">
          {preview.guidelineAdditions.map((addition) => <li key={`${addition.source}:${addition.text}`} className="list-disc">{addition.text}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

export function ProjectEditRoute() {
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";
  const revalidator = useRevalidator();
  const formRef = useRef<HTMLFormElement>(null);
  const [migrationPreview, setMigrationPreview] = useState<LegacyProjectContextMigrationPreview | null>(null);
  const [migrationPending, setMigrationPending] = useState(false);
  const [migrationNotice, setMigrationNotice] = useState("");
  const [migrationError, setMigrationError] = useState("");
  const submit = useCallback(() => formRef.current?.requestSubmit(), []);
  useShortcut("submit", submit, { allowInEditable: true });
  const { project } = useRouteLoaderData("root") as { project: Project };

  const showMigrationPreview = useCallback(async () => {
    setMigrationError("");
    setMigrationNotice("");
    try {
      const preview = await previewProjectContextMigration();
      setMigrationPreview(preview);
      if (!preview.hasLegacyContext) setMigrationNotice("No legacy project context requires migration.");
    } catch (error) {
      setMigrationError(error instanceof Response ? await error.text() : "Could not load the migration preview.");
    }
  }, []);

  const applyMigration = useCallback(async () => {
    setMigrationPending(true);
    setMigrationError("");
    setMigrationNotice("");
    try {
      const result = await applyProjectContextMigration();
      setMigrationPreview(result.preview);
      setMigrationNotice(result.applied ? "Legacy project context migrated and read back successfully." : "No legacy project context required migration.");
      revalidator.revalidate();
    } catch (error) {
      setMigrationError(error instanceof Response ? await error.text() : "Could not apply the migration.");
    } finally {
      setMigrationPending(false);
    }
  }, [revalidator]);

  return (
    <div className="grid gap-8">
      <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent)] hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </Link>

      <Card className="grid gap-5">
        <div>
          <h2 className="text-xl font-black tracking-tight text-[var(--text)]">Edit project context</h2>
          <p className="mt-2 text-sm text-[var(--text-muted)]">Update human-authored overview and Project Guidelines content. Freshness and agent read attestations remain planner-managed.</p>
        </div>

        <Form ref={formRef} method="post" className="grid gap-4">
          <Field label="Project name">
            <Input name="name" defaultValue={project.name} placeholder="Project name" required />
          </Field>
          <Field label="Short description">
            <Textarea name="description" defaultValue={project.description} placeholder="Summarize the project in a few lines for the dashboard overview" />
          </Field>
          <Field label="Project goal">
            <Textarea name="goal" defaultValue={project.goal} placeholder="Define the main objective, success criteria, and overall direction of the project" />
          </Field>
          <Field label="Project Guidelines">
            <Textarea name="projectGuidelines" defaultValue={project.projectGuidelines.content} placeholder="Coding standards, formatting, styling, and verification rules agents must follow" />
          </Field>
          <div className="flex justify-end gap-3">
            <Link to="/"><Button type="button" variant="ghost">Cancel</Button></Link>
            <Button type="submit" variant="primary" disabled={submitting} shortcut="submit">
              {submitting ? "Saving…" : "Save project context"}
            </Button>
          </div>
        </Form>
      </Card>

      <Card className="grid gap-4" aria-labelledby="legacy-context-migration-title">
        <div>
          <h2 id="legacy-context-migration-title" className="text-lg font-bold text-[var(--text)]">Legacy context migration</h2>
          <p className="mt-2 text-sm text-[var(--text-muted)]">Review a deduplicated preview before explicitly migrating legacy rules and decisions. Opening this page never migrates data.</p>
        </div>
        {migrationPreview ? <MigrationPreview preview={migrationPreview} /> : null}
        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={showMigrationPreview} disabled={migrationPending}>Preview migration</Button>
          {migrationPreview?.hasLegacyContext ? (
            <Button type="button" variant="primary" onClick={applyMigration} disabled={migrationPending}>
              {migrationPending ? "Applying…" : "Apply previewed migration"}
            </Button>
          ) : null}
        </div>
        <p aria-live="polite" className="text-sm text-[var(--text-muted)]">{migrationNotice}</p>
        {migrationError ? <p role="alert" className="text-sm font-semibold text-[var(--color-status-blocked)]">{migrationError}</p> : null}
      </Card>
    </div>
  );
}
