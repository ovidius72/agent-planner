import { useState } from "react";
import { Form, Link, redirect, useActionData, useLoaderData, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router-dom";
import { FormattedText } from "../components/ui/formatted-text";
import { getPlannerDocument, savePlannerDocument } from "../lib/api";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const path = url.searchParams.get("path") ?? "";
  if (!/^\.planner\/docs\/.+\.md$/i.test(path) || path.includes("/../")) {
    throw new Response("Document path must be a Markdown file under .planner/docs/", { status: 400 });
  }
  const doc = await getPlannerDocument(path);
  return { doc };
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const path = String(form.get("path") ?? "");
  const content = String(form.get("content") ?? "");
  const confirmed = form.get("confirmed") === "true";
  if (!confirmed) return { error: "Saving requires explicit confirmation.", path };
  if (!content.trim()) return { error: "Document content must be non-empty Markdown.", path };
  try {
    await savePlannerDocument(path, content);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), path };
  }
  return redirect(`/docs/view?path=${encodeURIComponent(path)}`);
}

export function DocViewerRoute() {
  const { doc } = useLoaderData() as { doc: { path: string; content: string } };
  const actionData = useActionData() as { error?: string } | undefined;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(doc.content);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/handoff" className="text-sm text-[var(--accent)] underline-offset-2 hover:underline">← Handoffs</Link>
        <h1 className="text-base font-bold text-[var(--text)]">Planner document</h1>
        <code className="rounded border border-[var(--border)] px-2 py-0.5 font-mono text-xs">{doc.path}</code>
        <button type="button" className="rounded border border-[var(--border)] px-2 py-1 text-sm" onClick={() => { setDraft(doc.content); setEditing((value) => !value); }}>
          {editing ? "Preview" : "Edit"}
        </button>
      </div>
      {actionData?.error ? <p role="alert" className="text-sm text-red-600">{actionData.error}</p> : null}
      {!editing ? (
        <div className="rounded-lg border border-[var(--border)] p-4">
          <FormattedText text={doc.content} />
        </div>
      ) : (
        <Form method="put" className="grid gap-3">
          <input type="hidden" name="path" value={doc.path} />
          <label className="grid gap-2 text-sm">
            <span className="font-semibold">Markdown source (dependency-free textarea baseline)</span>
            <textarea name="content" value={draft} onChange={(event) => setDraft(event.target.value)} rows={24} className="rounded-lg border border-[var(--border)] p-3 font-mono text-sm" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="confirmed" value="true" required />
            <span>I confirm overwriting this planner-owned document.</span>
          </label>
          <div>
            <button type="submit" className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-white">Save document</button>
          </div>
          <div className="rounded-lg border border-[var(--border)] p-4">
            <h2 className="mb-2 text-sm font-bold">Live preview</h2>
            <FormattedText text={draft} />
          </div>
        </Form>
      )}
    </div>
  );
}
