import { useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { StatusBadge } from "../ui/status-badge";
import { useDashboardTree } from "../../hooks/use-dashboard-tree";
import { formatSequence } from "../../lib/dashboard-tree";
import { featureStatuses, phaseStatuses, taskStatuses } from "../../lib/statuses";
import { repairPlan, type ActiveTaskSummary, type RepairReport } from "../../lib/api";
import type { Feature, Phase } from "../../lib/types";
import { FeatureTreeRow } from "./work-tree-rows";

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

  const isPhaseExpanded = (phaseId: string) => tree.expandedPhaseIds.includes(phaseId);
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
          <Button type="button" variant="secondary" onClick={() => tree.setShowAllFeatures((value) => !value)}>
            {tree.showAllFeatures ? "Show active only" : "Show all features"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-[18px] border border-[var(--border)] bg-[var(--surface-card)] px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
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
            Only active branches
          </button>
          <Button type="button" variant="secondary" onClick={tree.resetFilters}>
            Reset filters
          </Button>
          <Button
            type="button"
            variant="secondary"
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
            {repairing ? "Repairing…" : "Repair plan"}
          </Button>
          {repairMsg ? <span className="text-xs text-[var(--text-muted)]">{repairMsg}</span> : null}
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <div className="grid gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-subtle)]">Feature status</p>
            <div className="flex flex-wrap gap-2">
              {featureStatuses.map((option) => {
                const active = tree.featureStatusFilters.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => tree.toggleFeatureStatusFilter(option.value)}
                    className={`status-chip transition ${active ? `status-${option.value}` : "border border-[var(--border)] bg-transparent text-[var(--text-muted)]"}`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-subtle)]">Phase status</p>
            <div className="flex flex-wrap gap-2">
              {phaseStatuses.map((option) => {
                const active = tree.phaseStatusFilters.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => tree.togglePhaseStatusFilter(option.value)}
                    className={`status-chip transition ${active ? `status-${option.value}` : "border border-[var(--border)] bg-transparent text-[var(--text-muted)]"}`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-subtle)]">Task status</p>
            <div className="flex flex-wrap gap-2">
              {taskStatuses.map((option) => {
                const active = tree.taskStatusFilters.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => tree.toggleTaskStatusFilter(option.value)}
                    className={`status-chip transition ${active ? `status-${option.value}` : "border border-[var(--border)] bg-transparent text-[var(--text-muted)]"}`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3">
        {tree.displayedWorkTree.length > 0 ? (
          tree.displayedWorkTree.map((entry) => (
            <FeatureTreeRow
              key={entry.feature.id}
              entry={entry}
              expanded={tree.expandedFeatureIds.includes(entry.feature.id)}
              recentlyChanged={tree.recentFeatureIds.includes(entry.feature.id)}
              onToggle={() => tree.toggleExpandedFeature(entry.feature.id)}
              isPhaseExpanded={isPhaseExpanded}
              onTogglePhase={tree.toggleExpandedPhase}
              isPhaseRecentlyChanged={isPhaseRecentlyChanged}
              isTaskRecentlyChanged={isTaskRecentlyChanged}
            />
          ))
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
