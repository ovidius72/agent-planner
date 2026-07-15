import { useMemo } from "react";
import { ElasticInput, type FieldConfig, type SuggestionItem } from "elastic-input";
import type { Feature, Phase } from "../../lib/types";

const STATUS_VALUES = ["planned", "in-progress", "done", "blocked", "canceled", "rejected", "deferred", "waiting"];

function pad3(n: number): string {
  return String(n > 0 ? n : 0).padStart(3, "0");
}

/**
 * Structured search bar for the Work Tree, powered by elastic-input.
 * Accepts `feature:1 task:10,12,3 id:UUXD1 title:auth status:in-progress`
 * with context-aware autosuggest for field names and values. The parsed
 * query drives useDashboardTree filters (see task-search.ts).
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
  const fields: FieldConfig[] = [
    { name: "feature", label: "Feature", type: "number", description: "Feature number, e.g. 1 (F001)" },
    { name: "phase", label: "Phase", type: "number", description: "Phase number, e.g. 2 (P002)" },
    { name: "task", label: "Task", type: "number", description: "Task number, e.g. 10 (T010). Comma-list supported." },
    { name: "id", label: "Short ID", type: "string", description: "Global 5-char short id, e.g. UUXD1" },
    { name: "status", label: "Status", type: "string", description: "Task status" },
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
    if (field === "status") {
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
        placeholder="Search Work Tree… e.g. feature:1 task:10,12,3 id:UUXD1 title:auth"
      />
    </div>
  );
}