import { Lightbulb, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Form, Link, useFetcher, useLoaderData } from "react-router-dom";
import { createIdea, deleteIdea, getIdeas, updateIdea } from "../../lib/api";
import type { Idea } from "../../lib/types";

export async function loader(): Promise<{ ideas: Idea[] }> {
  return { ideas: await getIdeas() };
}

export async function action({ request }: { request: Request }): Promise<{ ok: true }> {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");
  const title = String(form.get("title") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  if (intent === "create") {
    if (!title) throw new Response("Idea title is required.", { status: 400 });
    await createIdea({ title, description });
  } else if (intent === "update") {
    if (!id || !title) throw new Response("Idea id and title are required.", { status: 400 });
    await updateIdea({ id, title, description });
  } else if (intent === "delete") {
    if (!id) throw new Response("Idea id is required.", { status: 400 });
    await deleteIdea(id);
  } else {
    throw new Response("Unknown Ideas action.", { status: 400 });
  }
  return { ok: true };
}

function IdeaEditor({ idea, onClose }: { idea?: Idea; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="idea-editor-title" className="surface-card w-full max-w-xl rounded-2xl border border-[var(--border)] p-5 shadow-2xl">
        <h2 id="idea-editor-title" className="text-lg font-bold">{idea ? "Edit idea" : "Add idea"}</h2>
        <Form method="post" className="mt-4 space-y-4" onSubmit={onClose}>
          <input type="hidden" name="intent" value={idea ? "update" : "create"} />
          {idea ? <input type="hidden" name="id" value={idea.id} /> : null}
          <label className="block text-sm font-semibold">Title
            <input autoFocus required name="title" defaultValue={idea?.title ?? ""} className="mt-1 h-10 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[var(--text)]" />
          </label>
          <label className="block text-sm font-semibold">Description
            <textarea name="description" defaultValue={idea?.description ?? ""} rows={6} className="mt-1 w-full resize-y rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-3 text-[var(--text)]" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-[var(--border-strong)] px-4 py-2 text-sm font-semibold">Cancel</button>
            <button type="submit" className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">{idea ? "Save idea" : "Add idea"}</button>
          </div>
        </Form>
      </div>
    </div>
  );
}

function DeleteIdeaButton({ idea }: { idea: Idea }) {
  const fetcher = useFetcher();
  return (
    <fetcher.Form method="post" onSubmit={(event) => { if (!window.confirm(`Delete ${`I${String(idea.number).padStart(3, "0")}`} — ${idea.title}?`)) event.preventDefault(); }}>
      <input type="hidden" name="intent" value="delete" />
      <input type="hidden" name="id" value={idea.id} />
      <button type="submit" aria-label={`Delete ${idea.title}`} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-rose-500/30 text-rose-600 hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
    </fetcher.Form>
  );
}

export function IdeasRoute() {
  const { ideas } = useLoaderData() as { ideas: Idea[] };
  const [editor, setEditor] = useState<Idea | "new" | null>(null);
  return (
    <main className="page-container py-6 sm:py-8">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black"><Lightbulb className="h-6 w-6 text-[var(--accent)]" /> Ideas Inbox</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Capture ideas without changing planner work status. Agents handle guided promotion separately.</p>
        </div>
        <button type="button" onClick={() => setEditor("new")} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> Add idea</button>
      </header>

      {ideas.length === 0 ? (
        <section className="surface-card mt-6 rounded-2xl border border-dashed border-[var(--border-strong)] p-8 text-center text-[var(--text-muted)]">No ideas yet. Add one without affecting feature, phase, or task rollups.</section>
      ) : (
        <section aria-label="Ideas" className="mt-6 grid gap-3">
          {ideas.map((idea) => (
            <article key={idea.id} className="surface-card min-w-0 rounded-2xl border border-[var(--border)] p-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-lg bg-[var(--accent-soft)] px-2 py-1 font-mono text-xs font-bold text-[var(--accent)]">I{String(idea.number).padStart(3, "0")}</span>
                    <span className="font-mono text-xs text-[var(--text-muted)]">{idea.shortId}</span>
                    {idea.promotion ? (idea.targetHref ? <Link to={idea.targetHref} className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400">Promoted to {idea.promotion.targetRef}</Link> : <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">Promoted to {idea.promotion.targetRef}</span>) : null}
                  </div>
                  <h2 className="mt-2 break-words text-base font-bold">{idea.title}</h2>
                  {idea.description ? <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--text-muted)]">{idea.description}</p> : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" onClick={() => setEditor(idea)} aria-label={`Edit ${idea.title}`} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-strong)] text-[var(--text-muted)] hover:text-[var(--text)]"><Pencil className="h-4 w-4" /></button>
                  <DeleteIdeaButton idea={idea} />
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
      {editor ? <IdeaEditor {...(editor === "new" ? {} : { idea: editor })} onClose={() => setEditor(null)} /> : null}
    </main>
  );
}
