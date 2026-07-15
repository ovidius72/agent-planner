import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { StatusBadge } from "../ui/status-badge";
import { useDashboardTree } from "../../hooks/use-dashboard-tree";
import { formatSequence } from "../../lib/dashboard-tree";
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
  const [repairing, setRepairing] = useState(false);
  const [repairMsg, setRepairMsg] = useState<string | null>(null);
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
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    // Features scope
    const featureIds = tree.displayedWorkTree.map((e) => e.feature.id);
    if (featureIds.includes(activeId) && featureIds.includes(overId)) {
      await reorder("feature", arrayMove(featureIds, featureIds.indexOf(activeId), featureIds.indexOf(overId))).catch(() => {});
      return;
    }
    // Phases scope (within a feature)
    for (const entry of tree.displayedWorkTree) {
      const phaseIds = entry.allPhases.map((p) => p.phase.id);
      if (phaseIds.includes(activeId) && phaseIds.includes(overId)) {
        await reorder("phase", arrayMove(phaseIds, phaseIds.indexOf(activeId), phaseIds.indexOf(overId))).catch(() => {});
        return;
      }
    }
    // Tasks scope (within a phase)
    for (const entry of tree.displayedWorkTree) {
      for (const pe of entry.allPhases) {
        const taskIds = pe.allTasks.map((t) => t.id);
        if (taskIds.includes(activeId) && taskIds.includes(overId)) {
          await reorder("task", arrayMove(taskIds, taskIds.indexOf(activeId), taskIds.indexOf(overId))).catch(() => {});
          return;
        }
      }
    }
  };

  const isPhaseExpanded = (phaseId: string) =>
    tree.expandedPhaseIds.includes(phaseId);
  const isPhaseRecentlyChanged = (phaseId: string) => tree.recentPhaseIds.includes(phaseId);
  const isTaskRecentlyChanged = (taskId: string) => tree.recentTaskIds.includes(taskId);

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

      <div className="ap-tree-scroll grid gap-3 pr-1" style={{ maxHeight: `calc(100dvh - ${headerH}px - 220px)` }}>
        {tree.displayedWorkTree.length > 0 ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={tree.displayedWorkTree.map((e) => e.feature.id)} strategy={verticalListSortingStrategy}>
              {tree.displayedWorkTree.map((entry) => (
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
