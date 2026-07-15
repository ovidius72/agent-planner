import { useMemo, useRef } from "react";
import { ElasticInput, type FieldConfig, type SuggestionItem, type ElasticInputAPI } from "elastic-input";
import type { Feature, Phase } from "../../lib/types";

const STATUS_VALUES = ["planned", "in-progress", "done", "blocked", "canceled", "rejected", "deferred", "waiting"];

/** Caret offset (in characters) within the contentEditable editor. */
function getCaretCharOffset(editor: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return editor.textContent?.length ?? 0;
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(editor);
  pre.setEnd(range.endContainer, range.endOffset);
  return pre.toString().length;
}

/**
 * Terminal-style keybindings for the elastic-input editor:
 *   Ctrl+H → delete char backward (Backspace)
 *   Ctrl+J → next suggestion (ArrowDown)
 *   Ctrl+K → previous suggestion (ArrowUp)
 *   Ctrl+U → delete word backward
 * elastic-input fires `onKeyDown` before its internal handling and skips it
 * when `preventDefault()` is called. For H/J/K we cancel the original Ctrl-*
 * event and re-dispatch the corresponding plain key for elastic-input to
 * process. For U we delete a whitespace-delimited word via the imperative API.
 */
function useSearchKeyDown(apiRef: React.MutableRefObject<ElasticInputAPI | null>) {
  return (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(e.ctrlKey && !e.metaKey && !e.altKey)) return;
    const key = e.key.toLowerCase();
    // elastic-input attaches onKeyDown to the contentEditable editor itself.
    const ct = e.currentTarget as HTMLElement;
    const editor = ct.isContentEditable ? ct : (ct.querySelector("[contenteditable='true'], [contenteditable]") as HTMLElement | null) ?? ct;
    const api = apiRef.current;

    // Ctrl+H → delete char backward (via imperative API: reliable across React).
    if (key === "h" && api) {
      e.preventDefault();
      const value = api.getValue();
      let caret = getCaretCharOffset(editor);
      if (caret < 0 || caret > value.length) caret = value.length;
      if (caret > 0) {
        api.setValue(value.slice(0, caret - 1) + value.slice(caret));
        api.setSelection(caret - 1, caret - 1);
      }
      return;
    }
    // Ctrl+U → delete word backward (whitespace-delimited) via imperative API.
    if (key === "u" && api) {
      e.preventDefault();
      const value = api.getValue();
      let caret = getCaretCharOffset(editor);
      if (caret < 0 || caret > value.length) caret = value.length;
      if (caret === 0) return;
      let i = caret;
      while (i > 0 && /\s/.test(value[i - 1] ?? "")) i--;
      if (i === caret) {
        while (i > 0 && !/\s/.test(value[i - 1] ?? "")) i--;
      }
      if (i < caret) {
        api.setValue(value.slice(0, i) + value.slice(caret));
        api.setSelection(i, i);
      }
      return;
    }
    // Ctrl+J/K → navigate suggestions: re-dispatch ArrowDown/ArrowUp so
    // elastic-input's internal handler moves the highlighted item.
    const mapped = key === "j" ? "ArrowDown" : key === "k" ? "ArrowUp" : null;
    if (!mapped) return;
    e.preventDefault();
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: mapped, bubbles: true, cancelable: true }));
  };
}

function pad3(n: number): string {
  return String(n > 0 ? n : 0).padStart(3, "0");
}

/**
 * Structured search bar for the Work Tree, powered by elastic-input.
 * Accepts `feature:1 task:10,12,3 id:UUXD1 title:auth status:in-progress
 * feature-status:done phase-status:in-progress` with context-aware autosuggest
 * for field names and values. The parsed query drives useDashboardTree
 * filters (see task-search.ts).
 */
export function SearchBar({
  features,
  phases,
  query,
  onQuery,
}: {
  features: Feature[];
  phases: Phase[];
  query: string;
  onQuery: (q: string) => void;
}) {
  const apiRef = useRef<ElasticInputAPI | null>(null);
  const onKeyDown = useSearchKeyDown(apiRef);

  const fields: FieldConfig[] = [
    { name: "feature", label: "Feature", type: "number", description: "Feature number, e.g. 1 (F001)" },
    { name: "phase", label: "Phase", type: "number", description: "Phase number, e.g. 2 (P002)" },
    { name: "task", label: "Task", type: "number", description: "Task number, e.g. 10 (T010). Comma-list supported." },
    { name: "id", label: "Short ID", type: "string", description: "Global 5-char short id, e.g. UUXD1" },
    { name: "status", label: "Status", type: "string", description: "Task status" },
    { name: "feature-status", label: "Feature status", type: "string", description: "Status of the feature" },
    { name: "phase-status", label: "Phase status", type: "string", description: "Status of the phase" },
    { name: "title", label: "Title", type: "string", description: "Substring match on title" },
  ];

  const data = useMemo(() => {
    const featureNums = [...new Set(features.map((f) => f.number))].sort((a, b) => a - b);
    const phaseNums = [...new Set(phases.map((p) => p.number))].sort((a, b) => a - b);
    const taskNums = [...new Set(phases.flatMap((p) => p.tasks.map((t) => t.number)))].sort((a, b) => a - b);
    const shortIds = [
      ...new Set(
        [
          ...features.map((f) => f.shortId),
          ...phases.flatMap((p) => [p.shortId, ...p.tasks.map((t) => t.shortId)]),
        ].filter(Boolean),
      ),
    ] as string[];
    const titles = [...new Set(phases.flatMap((p) => p.tasks.map((t) => t.title)))];
    return { featureNums, phaseNums, taskNums, shortIds, titles };
  }, [features, phases]);

  async function fetchSuggestions(field: string, partial: string): Promise<SuggestionItem[]> {
    const p = partial.toLowerCase();
    if (field === "feature") {
      return data.featureNums.filter((n) => String(n).startsWith(partial)).slice(0, 20).map((n) => ({ text: String(n), label: `F${pad3(n)}` }));
    }
    if (field === "phase") {
      return data.phaseNums.filter((n) => String(n).startsWith(partial)).slice(0, 20).map((n) => ({ text: String(n), label: `P${pad3(n)}` }));
    }
    if (field === "task") {
      return data.taskNums.filter((n) => String(n).startsWith(partial)).slice(0, 20).map((n) => ({ text: String(n), label: `T${pad3(n)}` }));
    }
    if (field === "id") {
      return data.shortIds.filter((id) => id.toLowerCase().startsWith(p)).slice(0, 20).map((id) => ({ text: id, label: id }));
    }
    if (field === "status" || field === "feature-status" || field === "phase-status") {
      return STATUS_VALUES.filter((s) => s.startsWith(p)).map((s) => ({ text: s, label: s }));
    }
    if (field === "title") {
      return data.titles.filter((t) => t.toLowerCase().includes(p)).slice(0, 20).map((t) => ({ text: t, label: t.length > 44 ? t.slice(0, 44) + "…" : t }));
    }
    return [];
  }

  return (
    <div className="search-bar">
      <ElasticInput
        fields={fields}
        value={query}
        onChange={(q) => onQuery(q)}
        onSearch={(q) => onQuery(q)}
        fetchSuggestions={fetchSuggestions}
        onKeyDown={onKeyDown}
        inputRef={(api) => {
          apiRef.current = api;
        }}
        placeholder="Search Work Tree… e.g. feature:1 id:UUXD1 title:auth status:in-progress"
      />
    </div>
  );
}