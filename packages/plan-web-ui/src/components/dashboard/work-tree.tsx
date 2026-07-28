import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, DragOverlay, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { StatusBadge } from "../ui/status-badge";
import { EntityPathBadge } from "../ui/badges";
import { useDashboardTree } from "../../hooks/use-dashboard-tree";
import { formatSequence, type WorkTreeFeature } from "../../lib/dashboard-tree";
import { reorder, repairPlan, type ActiveTaskSummary, type RepairReport } from "../../lib/api";
import type { Feature, Phase } from "../../lib/types";
import { FeatureTreeRow } from "./work-tree-rows";
import { SortableItem } from "./sortable";
import { SearchBar } from "./search-bar";

/**
 * The collapsible feature → phase → task Work Tree, plus its filter bar
 * (status chips, hide-done/planned, active-only, expand/collapse, repair).
 * All stateful logic lives in useDashboardTree; this component is mostly
 * wiring + presentation.
 */
/** Optimistic reorder: re-sorts each tree level by a transient per-scope order
 *  (set on drag-end) so the tree reorders instantly, before the server broadcast
 *  arrives with the real new priorities. No-op when `pending` is empty. */
function applyOrder(tree: WorkTreeFeature[], pending: Record<string, string[]>): WorkTreeFeature[] {
  if (Object.keys(pending).length === 0) return tree;
  const rankOf = (scope: string) => {
    const po = pending[scope];
    if (!po) return null;
    return new Map(po.map((id, i) => [id, i]));
  };
  const featRank = rankOf("__features__");
  const ordered = featRank
    ? [...tree].sort((a, b) => (featRank.get(a.feature.id) ?? Infinity) - (featRank.get(b.feature.id) ?? Infinity))
    : tree;
  return ordered.map((entry) => {
    const phaseRank = rankOf(`phase-scope:${entry.feature.id}`);
    const allPhases = phaseRank
      ? [...entry.allPhases].sort((a, b) => (phaseRank.get(a.phase.id) ?? Infinity) - (phaseRank.get(b.phase.id) ?? Infinity))
      : entry.allPhases;
    return {
      ...entry,
      allPhases: allPhases.map((pe) => {
        const taskRank = rankOf(`task-scope:${pe.phase.id}`);
        const allTasks = taskRank
          ? [...pe.allTasks].sort((a, b) => (taskRank.get(a.id) ?? Infinity) - (taskRank.get(b.id) ?? Infinity))
          : pe.allTasks;
        return { ...pe, allTasks };
      }),
    };
  });
}

export function WorkTree({
  features,
  phases,
  activeTasks,
  projectStorageScope,
}: {
  features: Feature[];
  phases: Phase[];
  activeTasks: ActiveTaskSummary[];
  projectStorageScope: string;
}) {
  const tree = useDashboardTree({ features, phases, projectStorageScope });
  // Optimistic reorder: a transient per-scope order applied on drag-end so the
  // tree reorders instantly (no snap-back to original) before the server
  // broadcast arrives with the real new priorities. Cleared when the data
  // refresh changes tree.displayedWorkTree.
  const [pendingOrder, setPendingOrder] = useState<Record<string, string[]>>({});
  useEffect(() => { setPendingOrder({}); }, [tree.displayedWorkTree]);
  const orderedTree = useMemo(
    () => applyOrder(tree.displayedWorkTree, pendingOrder),
    [tree.displayedWorkTree, pendingOrder],
  );
  const [repairing, setRepairing] = useState(false);
  const [repairMsg, setRepairMsg] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const handleDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));
  const [headerH, setHeaderH] = useState(0);
  useEffect(() => {
    const header = document.querySelector("header");
    if (!header) return;
    const update = () => setHeaderH(header.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(header);
    window.addEventListener("resize", update);
    return () => { ro.disconnect(); window.removeEventListener("resize", update); };
  }, []);
  // After a filter/search change, if the sticky bar scrolled out of view above
  // the header (the tree shrank below the scroll position), gently re-pin it.
  // Fires only on user-facing filter changes, not on data/WebSocket updates.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const bar = document.querySelector(".ap-search-sticky");
      const header = document.querySelector("header");
      if (!bar || !header) return;
      const rect = bar.getBoundingClientRect();
      if (rect.top < 0) {
        const target = rect.top + window.scrollY - header.offsetHeight;
        window.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
      }
    }, 60);
    return () => window.clearTimeout(id);
  }, [tree.searchQuery, tree.hideDone, tree.hidePlanned, tree.onlyActiveBranches]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    // Features scope
    const featureIds = orderedTree.map((e) => e.feature.id);
    if (featureIds.includes(activeId) && featureIds.includes(overId)) {
      const next = arrayMove(featureIds, featureIds.indexOf(activeId), featureIds.indexOf(overId));
      const ni = next.indexOf(activeId);
      const beforeId = ni > 0 ? (next[ni - 1] ?? null) : null;
      const afterId = ni < next.length - 1 ? (next[ni + 1] ?? null) : null;
      setPendingOrder((prev) => ({ ...prev, "__features__": next })); // optimistic: reorder now
      await reorder("feature", activeId, beforeId, afterId).catch(() => {});
      return;
    }
    // Phases scope (within a feature)
    for (const entry of orderedTree) {
      const phaseIds = entry.allPhases.map((p) => p.phase.id);
      if (phaseIds.includes(activeId) && phaseIds.includes(overId)) {
        const next = arrayMove(phaseIds, phaseIds.indexOf(activeId), phaseIds.indexOf(overId));
        const ni = next.indexOf(activeId);
        const beforeId = ni > 0 ? (next[ni - 1] ?? null) : null;
        const afterId = ni < next.length - 1 ? (next[ni + 1] ?? null) : null;
        setPendingOrder((prev) => ({ ...prev, [`phase-scope:${entry.feature.id}`]: next }));
        await reorder("phase", activeId, beforeId, afterId).catch(() => {});
        return;
      }
    }
    // Tasks scope (within a phase)
    for (const entry of orderedTree) {
      for (const pe of entry.allPhases) {
        const taskIds = pe.allTasks.map((t) => t.id);
        if (taskIds.includes(activeId) && taskIds.includes(overId)) {
          const next = arrayMove(taskIds, taskIds.indexOf(activeId), taskIds.indexOf(overId));
          const ni = next.indexOf(activeId);
          const beforeId = ni > 0 ? (next[ni - 1] ?? null) : null;
          const afterId = ni < next.length - 1 ? (next[ni + 1] ?? null) : null;
          setPendingOrder((prev) => ({ ...prev, [`task-scope:${pe.phase.id}`]: next }));
          await reorder("task", activeId, beforeId, afterId).catch(() => {});
          return;
        }
      }
    }
  };

  const isPhaseExpanded = (phaseId: string) =>
    tree.expandedPhaseIds.includes(phaseId);
  const isPhaseRecentlyChanged = (phaseId: string) => tree.recentPhaseIds.includes(phaseId);
  const isTaskRecentlyChanged = (taskId: string) => tree.recentTaskIds.includes(taskId);

  // Floating drag preview for the DragOverlay: finds the active entity (feature /
  // phase / task) by id and renders a compact badge + title + status card. The
  // original row stays in place (faded via .ap-sortable--dragging) while this
  // clone follows the cursor — cleaner than transforming the row in-place.
  const renderDragPreview = () => {
    if (!activeId) return null;
    for (const entry of orderedTree) {
      if (entry.feature.id === activeId) {
        return (
          <div className="ap-drag-overlay surface-card min-w-0 max-w-md px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <EntityPathBadge featureNum={entry.feature.number} />
              <StatusBadge status={entry.feature.status} />
            </div>
            <div className="mt-1 break-words font-mono text-sm font-semibold [overflow-wrap:anywhere]">{entry.feature.name}</div>
          </div>
        );
      }
      for (const pe of entry.allPhases) {
        if (pe.phase.id === activeId) {
          return (
            <div className="ap-drag-overlay surface-card min-w-0 max-w-md px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <EntityPathBadge featureNum={entry.feature.number} phaseNum={pe.phase.number} />
                <StatusBadge status={pe.phase.status} />
              </div>
              <div className="mt-1 break-words font-mono text-sm font-semibold [overflow-wrap:anywhere]">{pe.phase.title}</div>
            </div>
          );
        }
        for (const t of pe.allTasks) {
          if (t.id === activeId) {
            return (
              <div className="ap-drag-overlay surface-card min-w-0 max-w-md px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <EntityPathBadge featureNum={entry.feature.number} phaseNum={pe.phase.number} taskNum={t.number} />
                  <StatusBadge status={t.status} />
                </div>
                <div className="mt-1 break-words font-mono text-sm font-semibold [overflow-wrap:anywhere]">{t.title}</div>
              </div>
            );
          }
        }
      }
    }
    return null;
  };

  return (
    <Card className="grid gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-bold text-[var(--text)]">Work Tree</h2>
          <p className="text-sm text-[var(--text-muted)]">Collapsible feature → phase → task tree. Click a feature or phase row to collapse/expand.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={() => tree.expandAll()}>
            Expand all
          </Button>
          <Button type="button" variant="secondary" onClick={() => tree.setTreeOpenMode("none")}>
            Collapse all
          </Button>
        </div>
      </div>

      <div className="ap-search-sticky z-20" style={{ top: headerH }}>
      <SearchBar features={features} phases={phases} query={tree.searchQuery} onQuery={tree.setSearchQuery} />
      {tree.searchActive ? (
        <p className="text-xs text-[var(--text-muted)]">
          {tree.matchedTaskIds.size} match{tree.matchedTaskIds.size === 1 ? "" : "es"} — clear the box to reset.
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-2 rounded-[14px] border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 sm:rounded-[18px] sm:px-4 sm:py-3">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => tree.setHideDone((value) => !value)}
            className={`status-chip transition ${tree.hideDone ? "status-done" : "border border-[var(--border)] bg-transparent text-[var(--text-muted)]"}`}
          >
            Hide done
          </button>
          <button
            type="button"
            onClick={() => tree.setHidePlanned((value) => !value)}
            className={`status-chip transition ${tree.hidePlanned ? "status-planned" : "border border-[var(--border)] bg-transparent text-[var(--text-muted)]"}`}
          >
            Hide planned
          </button>
          <button
            type="button"
            onClick={() => tree.setOnlyActiveBranches((value) => !value)}
            className={`status-chip transition ${tree.onlyActiveBranches ? "status-in-progress" : "border border-[var(--border)] bg-transparent text-[var(--text-muted)]"}`}
          >
            Only active
          </button>
          <Button type="button" variant="secondary" className="!min-h-9 !px-3 !py-1 !text-xs sm:!min-h-11 sm:!px-4 sm:!py-2 sm:!text-sm" onClick={tree.resetFilters}>
            Reset
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="!min-h-9 !px-3 !py-1 !text-xs sm:!min-h-11 sm:!px-4 sm:!py-2 sm:!text-sm"
            disabled={repairing}
            onClick={async () => {
              setRepairing(true);
              setRepairMsg(null);
              try {
                const report: RepairReport = await repairPlan();
                const m = report.migrated;
                const dup = report.integrity.duplicatePhaseIds.length;
                const dang = report.integrity.danglingPhaseIds.length;
                setRepairMsg(`Repair done: renamed ${m.renamed}, repaired ${m.repaired} refs, inferred ${m.inferred}. Integrity: ${dup} duplicate, ${dang} dangling.`);
              } catch (e) {
                setRepairMsg(`Repair failed: ${e instanceof Error ? e.message : String(e)}`);
              } finally {
                setRepairing(false);
              }
            }}
          >
            {repairing ? "Repairing…" : "Repair"}
          </Button>
          {repairMsg ? <span className="hidden text-xs text-[var(--text-muted)] sm:inline sm:truncate">{repairMsg}</span> : null}
        </div>
      </div>
      </div>

      <div className="grid gap-3">
        {orderedTree.length > 0 ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedTree.map((e) => e.feature.id)} strategy={verticalListSortingStrategy}>
              {orderedTree.map((entry) => (
                <SortableItem key={entry.feature.id} id={entry.feature.id}>
                  <FeatureTreeRow
                    entry={entry}
                    expanded={tree.expandedFeatureIds.includes(entry.feature.id)}
                    recentlyChanged={tree.recentFeatureIds.includes(entry.feature.id)}
                    onToggle={() => tree.toggleExpandedFeature(entry.feature.id)}
                    isPhaseExpanded={isPhaseExpanded}
                    onTogglePhase={tree.toggleExpandedPhase}
                    isPhaseRecentlyChanged={isPhaseRecentlyChanged}
                    isTaskRecentlyChanged={isTaskRecentlyChanged}
                    highlightedTaskIds={tree.searchActive ? tree.matchedTaskIds : undefined}
                  />
                </SortableItem>
              ))}
            </SortableContext>
            <DragOverlay dropAnimation={{ duration: 150, easing: "ease" }}>{renderDragPreview()}</DragOverlay>
          </DndContext>
        ) : activeTasks.length > 0 ? (
          activeTasks.map((task) => {
            const to = task.featureId
              ? `/features/${task.featureId}/phases/${task.phaseId}/tasks/${task.id}`
              : "/features";
            return (
              <Link
                key={task.id}
                to={to}
                className="surface-card grid gap-1 px-4 py-3 transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex min-w-0 items-center gap-2 truncate text-sm font-semibold text-[var(--text)]">
                    {task.status === "in-progress" ? (
                      <span aria-hidden="true" className="ap-progress-dot" />
                    ) : null}
                    <span className="truncate">T{formatSequence(task.number)} — {task.title}</span>
                  </span>
                  <StatusBadge status={task.status} />
                </div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  {task.phaseId}
                </div>
              </Link>
            );
          })
        ) : (
          <p className="py-4 text-center text-sm text-[var(--text-muted)]">
            No work items match the current filters.
          </p>
        )}
      </div>
    </Card>
  );
}
