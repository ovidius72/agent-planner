import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  buildWorkTree,
  recentHighlightDurationMs,
  type PlannerWsMessage,
  type WorkTreeFeature,
} from "../lib/dashboard-tree";
import {
  allFeatureStatusValues,
  allPhaseStatusValues,
  allTaskStatusValues,
  matchesStatus,
  toggleStatus,
} from "../lib/dashboard-filters";
import {
  dashboardStorageKey,
  readStoredArray,
  readStoredBoolean,
  writeStoredArray,
} from "../lib/dashboard-storage";
import type { Feature, FeatureStatus, Phase, PhaseStatus, TaskStatus } from "../lib/types";

export type TreeOpenMode = "smart" | "all" | "none";

export interface DashboardTreeApi {
  workTree: WorkTreeFeature[];
  displayedWorkTree: WorkTreeFeature[];
  treeOpenMode: TreeOpenMode;
  setTreeOpenMode: (mode: TreeOpenMode) => void;
  expandAll: () => void;
  expandedFeatureIds: string[];
  expandedPhaseIds: string[];
  toggleExpandedFeature: (featureId: string) => void;
  toggleExpandedPhase: (phaseId: string) => void;
  recentFeatureIds: string[];
  recentPhaseIds: string[];
  recentTaskIds: string[];
  showAllFeatures: boolean;
  setShowAllFeatures: Dispatch<SetStateAction<boolean>>;
  featureStatusFilters: FeatureStatus[];
  phaseStatusFilters: PhaseStatus[];
  taskStatusFilters: TaskStatus[];
  hideDone: boolean;
  setHideDone: Dispatch<SetStateAction<boolean>>;
  hidePlanned: boolean;
  setHidePlanned: Dispatch<SetStateAction<boolean>>;
  onlyActiveBranches: boolean;
  setOnlyActiveBranches: Dispatch<SetStateAction<boolean>>;
  resetFilters: () => void;
  toggleFeatureStatusFilter: (value: FeatureStatus) => void;
  togglePhaseStatusFilter: (value: PhaseStatus) => void;
  toggleTaskStatusFilter: (value: TaskStatus) => void;
}

/**
 * Owns ALL work-tree state for the dashboard: the feature→phase→task tree,
 * expansion mode + per-node expansion, status filters, the hide-done/planned
 * and active-only toggles, recent-change highlights driven by WebSocket
 * events, and localStorage persistence for every piece of UI state.
 *
 * Extracted from the ~800-line DashboardRoute so the route can stay a thin
 * orchestrator. Behavior is preserved exactly, including the rule that done
 * features are collapsed by default in "all" mode.
 */
export function useDashboardTree({
  features,
  phases,
  projectStorageScope,
}: {
  features: Feature[];
  phases: Phase[];
  projectStorageScope: string;
}): DashboardTreeApi {
  const showAllFeaturesStorageKey = dashboardStorageKey(projectStorageScope, "show-all-features");
  const treeOpenModeStorageKey = dashboardStorageKey(projectStorageScope, "tree-open-mode");
  const expandedFeaturesStorageKey = dashboardStorageKey(projectStorageScope, "expanded-features");
  const expandedPhasesStorageKey = dashboardStorageKey(projectStorageScope, "expanded-phases");
  const featureStatusFiltersStorageKey = dashboardStorageKey(projectStorageScope, "feature-status-filters");
  const phaseStatusFiltersStorageKey = dashboardStorageKey(projectStorageScope, "phase-status-filters");
  const taskStatusFiltersStorageKey = dashboardStorageKey(projectStorageScope, "task-status-filters");
  const hideDoneStorageKey = dashboardStorageKey(projectStorageScope, "hide-done");
  const hidePlannedStorageKey = dashboardStorageKey(projectStorageScope, "hide-planned");
  const onlyActiveBranchesStorageKey = dashboardStorageKey(projectStorageScope, "only-active-branches");

  const workTree = useMemo(() => buildWorkTree(features, phases), [features, phases]);

  const [showAllFeatures, setShowAllFeatures] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem(showAllFeaturesStorageKey);
    return stored === null ? true : stored === "true";
  });
  const [treeOpenMode, setTreeOpenMode] = useState<TreeOpenMode>(() => {
    if (typeof window === "undefined") return "all";
    const stored = window.localStorage.getItem(treeOpenModeStorageKey);
    return stored === "smart" || stored === "none" || stored === "all" ? stored : "all";
  });
  const [expandedFeatureIds, setExpandedFeatureIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = window.localStorage.getItem(expandedFeaturesStorageKey);
      return stored ? (JSON.parse(stored) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [expandedPhaseIds, setExpandedPhaseIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = window.localStorage.getItem(expandedPhasesStorageKey);
      return stored ? (JSON.parse(stored) as string[]) : [];
    } catch {
      return [];
    }
  });

  const [featureStatusFilters, setFeatureStatusFilters] = useState<FeatureStatus[]>(() => readStoredArray(featureStatusFiltersStorageKey, allFeatureStatusValues, allFeatureStatusValues));
  const [phaseStatusFilters, setPhaseStatusFilters] = useState<PhaseStatus[]>(() => readStoredArray(phaseStatusFiltersStorageKey, allPhaseStatusValues, allPhaseStatusValues));
  const [taskStatusFilters, setTaskStatusFilters] = useState<TaskStatus[]>(() => readStoredArray(taskStatusFiltersStorageKey, allTaskStatusValues, allTaskStatusValues));
  const [hideDone, setHideDone] = useState(() => readStoredBoolean(hideDoneStorageKey, false));
  const [hidePlanned, setHidePlanned] = useState(() => readStoredBoolean(hidePlannedStorageKey, false));
  const [onlyActiveBranches, setOnlyActiveBranches] = useState(() => readStoredBoolean(onlyActiveBranchesStorageKey, false));
  const [recentFeatureIds, setRecentFeatureIds] = useState<string[]>([]);
  const [recentPhaseIds, setRecentPhaseIds] = useState<string[]>([]);
  const [recentTaskIds, setRecentTaskIds] = useState<string[]>([]);
  const highlightTimeoutsRef = useRef<Record<string, number>>({});

  // ── Persistence ────────────────────────────────────────────────────────
  useEffect(() => { if (typeof window === "undefined") return; window.localStorage.setItem(showAllFeaturesStorageKey, String(showAllFeatures)); }, [showAllFeatures, showAllFeaturesStorageKey]);
  useEffect(() => { if (typeof window === "undefined") return; window.localStorage.setItem(treeOpenModeStorageKey, treeOpenMode); }, [treeOpenMode, treeOpenModeStorageKey]);
  useEffect(() => { if (typeof window === "undefined") return; window.localStorage.setItem(expandedFeaturesStorageKey, JSON.stringify(expandedFeatureIds)); }, [expandedFeatureIds, expandedFeaturesStorageKey]);
  useEffect(() => { if (typeof window === "undefined") return; window.localStorage.setItem(expandedPhasesStorageKey, JSON.stringify(expandedPhaseIds)); }, [expandedPhaseIds, expandedPhasesStorageKey]);
  useEffect(() => { if (typeof window === "undefined") return; writeStoredArray(featureStatusFiltersStorageKey, featureStatusFilters, allFeatureStatusValues); }, [featureStatusFilters, featureStatusFiltersStorageKey]);
  useEffect(() => { if (typeof window === "undefined") return; writeStoredArray(phaseStatusFiltersStorageKey, phaseStatusFilters, allPhaseStatusValues); }, [phaseStatusFilters, phaseStatusFiltersStorageKey]);
  useEffect(() => { if (typeof window === "undefined") return; writeStoredArray(taskStatusFiltersStorageKey, taskStatusFilters, allTaskStatusValues); }, [taskStatusFilters, taskStatusFiltersStorageKey]);
  useEffect(() => { if (typeof window === "undefined") return; window.localStorage.setItem(hideDoneStorageKey, String(hideDone)); }, [hideDone, hideDoneStorageKey]);
  useEffect(() => { if (typeof window === "undefined") return; window.localStorage.setItem(hidePlannedStorageKey, String(hidePlanned)); }, [hidePlanned, hidePlannedStorageKey]);
  useEffect(() => { if (typeof window === "undefined") return; window.localStorage.setItem(onlyActiveBranchesStorageKey, String(onlyActiveBranches)); }, [onlyActiveBranches, onlyActiveBranchesStorageKey]);

  // Clear pending highlight timers on unmount so we never setState after teardown.
  useEffect(() => {
    return () => {
      Object.values(highlightTimeoutsRef.current).forEach((timeoutId) => window.clearTimeout(timeoutId));
      highlightTimeoutsRef.current = {};
    };
  }, []);

  // ── Effective filters (hide-done/planned fold into the status filters) ──
  const effectiveFeatureStatusFilters = useMemo(() => {
    let next = [...featureStatusFilters];
    if (hideDone) next = next.filter((status) => status !== "done");
    if (hidePlanned) next = next.filter((status) => status !== "planned");
    return next;
  }, [featureStatusFilters, hideDone, hidePlanned]);

  const effectivePhaseStatusFilters = useMemo(() => {
    let next = [...phaseStatusFilters];
    if (hideDone) next = next.filter((status) => status !== "done");
    if (hidePlanned) next = next.filter((status) => status !== "planned" && status !== "draft");
    return next;
  }, [phaseStatusFilters, hideDone, hidePlanned]);

  const effectiveTaskStatusFilters = useMemo(() => {
    let next = [...taskStatusFilters];
    if (hideDone) next = next.filter((status) => status !== "done");
    if (hidePlanned) next = next.filter((status) => status !== "planned");
    return next;
  }, [taskStatusFilters, hideDone, hidePlanned]);

  // ── The filtered, active-only-pruned tree actually rendered ────────────
  const displayedWorkTree = useMemo<WorkTreeFeature[]>(() => {
    const activeOnly = !showAllFeatures || onlyActiveBranches;
    const base = showAllFeatures ? workTree : workTree.filter((entry) => entry.isActive);

    return base
      .filter(({ feature }) => matchesStatus(feature.status, effectiveFeatureStatusFilters))
      .map((entry) => ({
        ...entry,
        allPhases: entry.allPhases
          .filter(({ phase, hasActiveTask }) => {
            if (!matchesStatus(phase.status, effectivePhaseStatusFilters)) return false;
            if (!activeOnly) return true;
            return phase.status === "in-progress" || phase.status === "discovery" || hasActiveTask;
          })
          .map((phaseEntry) => ({
            ...phaseEntry,
            allTasks: phaseEntry.allTasks.filter((task) => {
              if (!matchesStatus(task.status, effectiveTaskStatusFilters)) return false;
              if (!activeOnly) return true;
              return true; // Show all tasks of an active phase
            }),
          }))
          .filter((phaseEntry) => phaseEntry.allTasks.length > 0 || showAllFeatures || !activeOnly),
      }))
      .filter(({ hasActiveTask, allPhases }) => {
        if (activeOnly) return hasActiveTask || allPhases.some((phaseEntry) => phaseEntry.hasActiveTask);
        return allPhases.length > 0 || showAllFeatures;
      });
  }, [effectiveFeatureStatusFilters, effectivePhaseStatusFilters, effectiveTaskStatusFilters, onlyActiveBranches, showAllFeatures, workTree]);

  // ── Sync expansion state with the open mode ────────────────────────────
  useEffect(() => {
    if (treeOpenMode === "none") {
      setExpandedFeatureIds([]);
      setExpandedPhaseIds([]);
      return;
    }

    if (treeOpenMode === "all") {
      // Done features are collapsed by default: they're finished work, so we
      // don't auto-expand them. Users can still expand them manually by
      // clicking the chevron (which switches to "smart" mode for that node).
      setExpandedFeatureIds(
        displayedWorkTree
          .filter(({ feature }) => feature.status !== "done")
          .map(({ feature }) => feature.id),
      );
      setExpandedPhaseIds(displayedWorkTree.flatMap(({ allPhases }) => allPhases.map(({ phase }) => phase.id)));
      return;
    }

    // "smart": keep user-controlled expansion, just drop ids that no longer exist.
    const validFeatureIds = new Set(displayedWorkTree.map(({ feature }) => feature.id));
    const validPhaseIds = new Set(displayedWorkTree.flatMap(({ allPhases }) => allPhases.map(({ phase }) => phase.id)));
    setExpandedFeatureIds((current) => current.filter((id) => validFeatureIds.has(id)));
    setExpandedPhaseIds((current) => current.filter((id) => validPhaseIds.has(id)));
  }, [displayedWorkTree, treeOpenMode]);

  const toggleExpandedFeature = (featureId: string) => {
    setTreeOpenMode("smart");
    setExpandedFeatureIds((current) => (current.includes(featureId)
      ? current.filter((entry) => entry !== featureId)
      : [...current, featureId]));
  };

  const toggleExpandedPhase = (phaseId: string) => {
    setTreeOpenMode("smart");
    setExpandedPhaseIds((current) => (current.includes(phaseId)
      ? current.filter((entry) => entry !== phaseId)
      : [...current, phaseId]));
  };

  // Explicit "Expand all": expand every visible feature (done included) and
  // phase, then switch to manual/smart mode so the auto-expand effect (which
  // collapses done by default) doesn't override the user's explicit choice.
  const expandAll = () => {
    setTreeOpenMode("smart");
    setExpandedFeatureIds(displayedWorkTree.map(({ feature }) => feature.id));
    setExpandedPhaseIds(displayedWorkTree.flatMap(({ allPhases }) => allPhases.map(({ phase }) => phase.id)));
  };

  // ── Live updates: highlight + auto-expand nodes touched by WS events ───
  useEffect(() => {
    const markRecent = (kind: "feature" | "phase" | "task", ids: Array<string | undefined>) => {
      const validIds = ids.filter((id): id is string => Boolean(id));
      for (const id of validIds) {
        const key = `${kind}:${id}`;
        const setter = kind === "feature"
          ? setRecentFeatureIds
          : kind === "phase"
            ? setRecentPhaseIds
            : setRecentTaskIds;
        setter((current) => (current.includes(id) ? current : [...current, id]));
        if (highlightTimeoutsRef.current[key] !== undefined) {
          window.clearTimeout(highlightTimeoutsRef.current[key]);
        }
        highlightTimeoutsRef.current[key] = window.setTimeout(() => {
          setter((current) => current.filter((entry) => entry !== id));
          delete highlightTimeoutsRef.current[key];
        }, recentHighlightDurationMs);
      }
    };

    const onPlannerEvent = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<PlannerWsMessage>;
      const message = event.detail;
      if (!message?.type) return;
      if (message.type === "features-updated") {
        const featureId = message.data?.featureId ?? message.data?.id;
        markRecent("feature", [featureId]);
        if (featureId) {
          setTreeOpenMode("smart");
          setExpandedFeatureIds((current) => (current.includes(featureId) ? current : [...current, featureId]));
        }
        return;
      }
      if (message.type === "phases-updated") {
        const featureId = message.data?.featureId;
        const phaseId = message.data?.phaseId ?? message.data?.id;
        markRecent("phase", [phaseId]);
        markRecent("feature", [featureId]);
        markRecent("task", [message.data?.taskId]);
        setTreeOpenMode("smart");
        if (featureId) {
          setExpandedFeatureIds((current) => (current.includes(featureId) ? current : [...current, featureId]));
        }
        if (phaseId) {
          setExpandedPhaseIds((current) => (current.includes(phaseId) ? current : [...current, phaseId]));
        }
      }
    };

    window.addEventListener("agent-plan:ws-event", onPlannerEvent as EventListener);
    return () => {
      window.removeEventListener("agent-plan:ws-event", onPlannerEvent as EventListener);
    };
  }, []);

  const resetFilters = () => {
    setShowAllFeatures(true);
    setHideDone(false);
    setHidePlanned(false);
    setFeatureStatusFilters(allFeatureStatusValues);
    setPhaseStatusFilters(allPhaseStatusValues);
    setTaskStatusFilters(allTaskStatusValues);
    setOnlyActiveBranches(false);
    setTreeOpenMode("all");
  };

  const toggleFeatureStatusFilter = (value: FeatureStatus) =>
    setFeatureStatusFilters((current) => toggleStatus(current, value, allFeatureStatusValues));
  const togglePhaseStatusFilter = (value: PhaseStatus) =>
    setPhaseStatusFilters((current) => toggleStatus(current, value, allPhaseStatusValues));
  const toggleTaskStatusFilter = (value: TaskStatus) =>
    setTaskStatusFilters((current) => toggleStatus(current, value, allTaskStatusValues));

  return {
    workTree,
    displayedWorkTree,
    treeOpenMode,
    setTreeOpenMode,
    expandAll,
    expandedFeatureIds,
    expandedPhaseIds,
    toggleExpandedFeature,
    toggleExpandedPhase,
    recentFeatureIds,
    recentPhaseIds,
    recentTaskIds,
    showAllFeatures,
    setShowAllFeatures,
    featureStatusFilters,
    phaseStatusFilters,
    taskStatusFilters,
    hideDone,
    setHideDone,
    hidePlanned,
    setHidePlanned,
    onlyActiveBranches,
    setOnlyActiveBranches,
    resetFilters,
    toggleFeatureStatusFilter,
    togglePhaseStatusFilter,
    toggleTaskStatusFilter,
  };
}
