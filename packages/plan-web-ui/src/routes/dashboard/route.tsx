import { BarChart3, CheckCircle2, ChevronRight, Layers, ListTodo } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLoaderData, useNavigate, useRouteLoaderData } from "react-router-dom";
import { StatCard } from "../../components/dashboard/stat-card";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { FormattedText } from "../../components/ui/formatted-text";
import { StatusBadge } from "../../components/ui/status-badge";
import { EntityBadge, ParentBadge } from "../../components/ui/badges";
import type { ActiveTaskSummary, RepairReport } from "../../lib/api";
import { repairPlan, getIntegrity } from "../../lib/api";
import { featureStatuses, phaseStatuses, taskStatuses } from "../../lib/statuses";
import { useShortcut } from "../../lib/shortcuts";
import type { AcceptedDecision, Feature, FeatureStatus, Phase, PhaseStatus, Project, Task, TaskStatus } from "../../lib/types";

function countTasks(phases: Phase[]) {
  return phases.reduce((total, phase) => total + phase.tasks.length, 0);
}

function countDoneTasks(phases: Phase[]) {
  return phases.reduce(
    (total, phase) => total + phase.tasks.filter((task) => task.status === "done").length,
    0,
  );
}

function formatSequence(value: number | undefined): string {
  return String(value && value > 0 ? value : 0).padStart(3, "0");
}

function buildWorkTree(features: Feature[], phases: Phase[]) {
  const phasesByFeature = new Map<string, Phase[]>();

  for (const phase of phases) {
    if (!phase.featureId) continue;
    const items = phasesByFeature.get(phase.featureId) ?? [];
    items.push(phase);
    phasesByFeature.set(phase.featureId, items);
  }

  return features
    .map((feature) => {
      const featurePhases = phasesByFeature.get(feature.id) ?? [];
      const totalTasks = featurePhases.reduce((total, phase) => total + phase.tasks.length, 0);
      const doneTasks = featurePhases.reduce(
        (total, phase) => total + phase.tasks.filter((task) => task.status === "done").length,
        0,
      );

      const allPhases = featurePhases.map((phase) => {
        const allTasks = [...phase.tasks].sort((left, right) => left.number - right.number || left.createdAt.localeCompare(right.createdAt) || left.title.localeCompare(right.title));
        const hasActiveTask = allTasks.some((task) => task.status === "in-progress");
        return {
          phase,
          totalTasks: phase.tasks.length,
          doneTasks: phase.tasks.filter((task) => task.status === "done").length,
          allTasks,
          hasActiveTask,
        };
      });

      const hasActiveBranch = allPhases.some(({ phase, allTasks }) => (
        phase.status === "in-progress"
        || phase.status === "discovery"
        || allTasks.some((task) => task.status === "in-progress")
      ));

      return {
        feature,
        totalTasks,
        doneTasks,
        allPhases: allPhases.sort((left, right) => left.phase.number - right.phase.number),
        hasActiveTask: allPhases.some((entry) => entry.hasActiveTask),
        isActive: hasActiveBranch,
      };
    })
    .sort((left, right) => left.feature.number - right.feature.number || left.feature.name.localeCompare(right.feature.name));
}

function toggleStatus<T extends string>(values: T[], value: T, all: readonly T[]) {
  if (values.includes(value)) {
    const next = values.filter((entry) => entry !== value);
    return next.length === 0 ? [...all] : next;
  }
  return [...values, value];
}

function matchesStatus<T extends string>(status: T, active: T[]) {
  return active.includes(status);
}

const allFeatureStatusValues = featureStatuses.map((option) => option.value);
const allPhaseStatusValues = phaseStatuses.map((option) => option.value);
const allTaskStatusValues = taskStatuses.map((option) => option.value);

function dashboardStorageKey(scope: string, suffix: string): string {
  return `agent-plan:dashboard:${scope}:${suffix}`;
}

function readStoredArray<T extends string>(key: string, fallback: T[], allowed: readonly T[]): T[] {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return fallback;
    const schemaKey = `${key}-schema`;
    const currentSchema = allowed.slice().sort().join(",");
    const savedSchema = window.localStorage.getItem(schemaKey);
    if (savedSchema !== currentSchema) {
      window.localStorage.setItem(schemaKey, currentSchema);
      return fallback;
    }
    const valid = parsed.filter((entry): entry is T => typeof entry === "string" && allowed.includes(entry as T));
    return valid.length > 0 ? valid : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredArray<T extends string>(key: string, values: T[], allowed: readonly T[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(values));
  window.localStorage.setItem(`${key}-schema`, allowed.slice().sort().join(","));
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const stored = window.localStorage.getItem(key);
  return stored === null ? fallback : stored === "true";
}

function formatDateTime(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

function completionValueClassName(completion: number): string {
  if (completion >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (completion >= 30) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

const recentHighlightDurationMs = 4200;

type PlannerWsMessage = {
  type?: string;
  data?: {
    action?: string;
    id?: string;
    featureId?: string;
    phaseId?: string;
    taskId?: string;
  };
};

function AcceptedDecisionsBlock({ decisions }: { decisions: AcceptedDecision[] }) {
  if (decisions.length === 0) return null;

  return (
    <details className="group rounded-[18px] border border-[var(--border)] bg-[var(--surface-card)] px-4 py-4">
      <summary className="cursor-pointer select-none font-semibold text-[var(--text)]">
        Accepted decisions ({decisions.length})
      </summary>
      <div className="mt-4 grid gap-3">
        {decisions.map((entry) => (
          <div key={entry.id} className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3">
            <p className="text-sm font-semibold text-[var(--text)]">{entry.title}</p>
            {entry.decision ? <div className="mt-2 text-sm text-[var(--text-muted)]"><span className="font-semibold text-[var(--text)]">Decision:</span> <FormattedText text={entry.decision} /></div> : null}
            {entry.rationale ? <div className="mt-1 text-sm text-[var(--text-muted)]"><span className="font-semibold text-[var(--text)]">Rationale:</span> <FormattedText text={entry.rationale} /></div> : null}
            {entry.implementationNotes ? <div className="mt-1 text-sm text-[var(--text-muted)]"><span className="font-semibold text-[var(--text)]">Implementation:</span> <FormattedText text={entry.implementationNotes} /></div> : null}
          </div>
        ))}
      </div>
    </details>
  );
}

export function DashboardRoute() {
  const { features, phases, activeTasks } = useLoaderData() as {
    features: Feature[];
    phases: Phase[];
    activeTasks: ActiveTaskSummary[];
  };
  const { project } = useRouteLoaderData("root") as { project: Project };
  const navigate = useNavigate();
  const openEditProject = () => navigate("/project/edit");
  useShortcut("edit", openEditProject);

  const scope = project.scope ?? [];
  const outOfScope = project.outOfScope ?? [];
  const technologies = project.technologies ?? [];
  const tools = project.tools ?? [];
  const projectStorageScope = project.projectRoot || project.planRoot || project.name || "default";
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
  const globalRules = project.globalRules ?? [];
  const decisions = project.decisions ?? [];
  const acceptedDecisions = project.acceptedDecisions ?? [];
  const workflowRules = {
    beforePhaseStart: project.workflowRules?.beforePhaseStart ?? [],
    beforeTaskStart: project.workflowRules?.beforeTaskStart ?? [],
    afterPhaseComplete: project.workflowRules?.afterPhaseComplete ?? [],
  };

  const {
    doneFeatures,
    remainingFeatures,
    donePhases,
    remainingPhases,
    totalTasks,
    doneTasks,
    remainingTasks,
    completion,
    workTree,
    latestCompletedTasks,
  } = useMemo(() => {
    const doneFeatures = features.filter((feature) => feature.status === "done").length;
    const remainingFeatures = Math.max(features.length - doneFeatures, 0);
    const donePhases = phases.filter((phase) => phase.status === "done").length;
    const remainingPhases = Math.max(phases.length - donePhases, 0);
    const totalTasks = countTasks(phases);
    const doneTasks = countDoneTasks(phases);
    const remainingTasks = Math.max(totalTasks - doneTasks, 0);
    const completion = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
    const workTree = buildWorkTree(features, phases);
    const featureNameById = new Map(features.map((feature) => [feature.id, feature.name]));
    const latestCompletedTasks = phases
      .flatMap((phase) => phase.tasks
        .filter((task) => task.status === "done")
        .map((task) => ({
          task,
          phase,
          feature: features.find((f) => f.id === phase.featureId),
          featureName: phase.featureId ? (featureNameById.get(phase.featureId) ?? phase.featureId) : "Unlinked feature",
          completedAt: task.completedAt || task.updatedAt,
        })))
      .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
      .slice(0, 3);

    return {
      doneFeatures,
      remainingFeatures,
      donePhases,
      remainingPhases,
      totalTasks,
      doneTasks,
      remainingTasks,
      completion,
      workTree,
      latestCompletedTasks,
    };
  }, [features, phases]);

  const [showAllFeatures, setShowAllFeatures] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem(showAllFeaturesStorageKey);
    return stored === null ? true : stored === "true";
  });
  const [treeOpenMode, setTreeOpenMode] = useState<"smart" | "all" | "none">(() => {
    if (typeof window === "undefined") return "all";
    const stored = window.localStorage.getItem(treeOpenModeStorageKey);
    return stored === "smart" || stored === "none" || stored === "all" ? stored : "all";
  });
  const [expandedFeatureIds, setExpandedFeatureIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = window.localStorage.getItem(expandedFeaturesStorageKey);
      return stored ? JSON.parse(stored) as string[] : [];
    } catch {
      return [];
    }
  });
  const [expandedPhaseIds, setExpandedPhaseIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = window.localStorage.getItem(expandedPhasesStorageKey);
      return stored ? JSON.parse(stored) as string[] : [];
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
  const [repairing, setRepairing] = useState(false);
  const [repairMsg, setRepairMsg] = useState<string | null>(null);
  const [recentFeatureIds, setRecentFeatureIds] = useState<string[]>([]);
  const [recentPhaseIds, setRecentPhaseIds] = useState<string[]>([]);
  const [recentTaskIds, setRecentTaskIds] = useState<string[]>([]);
  const highlightTimeoutsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(showAllFeaturesStorageKey, String(showAllFeatures));
  }, [showAllFeatures]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(treeOpenModeStorageKey, treeOpenMode);
  }, [treeOpenMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(expandedFeaturesStorageKey, JSON.stringify(expandedFeatureIds));
  }, [expandedFeatureIds]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(expandedPhasesStorageKey, JSON.stringify(expandedPhaseIds));
  }, [expandedPhaseIds]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    writeStoredArray(featureStatusFiltersStorageKey, featureStatusFilters, allFeatureStatusValues);
  }, [featureStatusFilters]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    writeStoredArray(phaseStatusFiltersStorageKey, phaseStatusFilters, allPhaseStatusValues);
  }, [phaseStatusFilters]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    writeStoredArray(taskStatusFiltersStorageKey, taskStatusFilters, allTaskStatusValues);
  }, [taskStatusFilters]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(hideDoneStorageKey, String(hideDone));
  }, [hideDone]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(hidePlannedStorageKey, String(hidePlanned));
  }, [hidePlanned]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(onlyActiveBranchesStorageKey, String(onlyActiveBranches));
  }, [onlyActiveBranches]);

  useEffect(() => {
    return () => {
      Object.values(highlightTimeoutsRef.current).forEach((timeoutId) => window.clearTimeout(timeoutId));
      highlightTimeoutsRef.current = {};
    };
  }, []);

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
        setter((current) => current.includes(id) ? current : [...current, id]);
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
          setExpandedFeatureIds((current) => current.includes(featureId) ? current : [...current, featureId]);
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
          setExpandedFeatureIds((current) => current.includes(featureId) ? current : [...current, featureId]);
        }
        if (phaseId) {
          setExpandedPhaseIds((current) => current.includes(phaseId) ? current : [...current, phaseId]);
        }
      }
    };

    window.addEventListener("agent-plan:ws-event", onPlannerEvent as EventListener);
    return () => {
      window.removeEventListener("agent-plan:ws-event", onPlannerEvent as EventListener);
    };
  }, []);

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

  const displayedWorkTree = useMemo(() => {
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

  useEffect(() => {
    if (treeOpenMode === "none") {
      setExpandedFeatureIds([]);
      setExpandedPhaseIds([]);
      return;
    }

    if (treeOpenMode === "all") {
      setExpandedFeatureIds(displayedWorkTree.map(({ feature }) => feature.id));
      setExpandedPhaseIds(displayedWorkTree.flatMap(({ allPhases }) => allPhases.map(({ phase }) => phase.id)));
      return;
    }

    const validFeatureIds = new Set(displayedWorkTree.map(({ feature }) => feature.id));
    const validPhaseIds = new Set(displayedWorkTree.flatMap(({ allPhases }) => allPhases.map(({ phase }) => phase.id)));
    setExpandedFeatureIds((current) => current.filter((id) => validFeatureIds.has(id)));
    setExpandedPhaseIds((current) => current.filter((id) => validPhaseIds.has(id)));
  }, [displayedWorkTree, treeOpenMode]);

  const toggleExpandedFeature = (featureId: string) => {
    setTreeOpenMode("smart");
    setExpandedFeatureIds((current) => current.includes(featureId)
      ? current.filter((entry) => entry !== featureId)
      : [...current, featureId]);
  };

  const toggleExpandedPhase = (phaseId: string) => {
    setTreeOpenMode("smart");
    setExpandedPhaseIds((current) => current.includes(phaseId)
      ? current.filter((entry) => entry !== phaseId)
      : [...current, phaseId]);
  };

  return (
    <div className="grid gap-8">
      <Card className="grid gap-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-lg font-bold text-[var(--text)]">Project Goal</h2>
            {project.goal ? <FormattedText text={project.goal} className="mt-2 max-w-4xl" /> : <p className="mt-2 max-w-4xl text-sm text-[var(--text-muted)]">Add a project goal to define the main objective.</p>}
          </div>
          <Link to="/project/edit">
            <Button type="button" shortcut="edit">Edit project</Button>
          </Link>
        </div>
      </Card>

      {(scope.length > 0 || outOfScope.length > 0 || technologies.length > 0 || tools.length > 0 || globalRules.length > 0 || decisions.length > 0 || acceptedDecisions.length > 0 || workflowRules.beforePhaseStart.length > 0 || workflowRules.beforeTaskStart.length > 0 || workflowRules.afterPhaseComplete.length > 0) ? (
        <Card className="grid gap-4">
          <details className="group">
            <summary className="cursor-pointer select-none text-lg font-bold text-[var(--text)]">
              AI Consolidated Context
            </summary>
            <div className="mt-4 grid gap-4">
              {scope.length > 0 ? (
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-subtle)]">In scope</h3>
                  <ul className="mt-2 grid gap-2 pl-5 text-sm text-[var(--text-muted)]">
                    {scope.map((item) => <li key={item} className="list-disc">{item}</li>)}
                  </ul>
                </div>
              ) : null}

              {outOfScope.length > 0 ? (
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-subtle)]">Out of scope</h3>
                  <ul className="mt-2 grid gap-2 pl-5 text-sm text-[var(--text-muted)]">
                    {outOfScope.map((item) => <li key={item} className="list-disc">{item}</li>)}
                  </ul>
                </div>
              ) : null}

              {(technologies.length > 0 || tools.length > 0) ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {technologies.length > 0 ? (
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-subtle)]">Technologies</h3>
                      <ul className="mt-2 grid gap-2 pl-5 text-sm text-[var(--text-muted)]">
                        {technologies.map((item) => <li key={item} className="list-disc">{item}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  {tools.length > 0 ? (
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-subtle)]">Tools</h3>
                      <ul className="mt-2 grid gap-2 pl-5 text-sm text-[var(--text-muted)]">
                        {tools.map((item) => <li key={item} className="list-disc">{item}</li>)}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {globalRules.length > 0 ? (
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-subtle)]">Global rules</h3>
                  <ul className="mt-2 grid gap-2 pl-5 text-sm text-[var(--text-muted)]">
                    {globalRules.map((item) => <li key={item} className="list-disc">{item}</li>)}
                  </ul>
                </div>
              ) : null}

              {(workflowRules.beforePhaseStart.length > 0 || workflowRules.beforeTaskStart.length > 0 || workflowRules.afterPhaseComplete.length > 0) ? (
                <details className="group rounded-[18px] border border-[var(--border)] bg-[var(--surface-card)] px-4 py-4">
                  <summary className="cursor-pointer select-none font-semibold text-[var(--text)]">
                    Workflow rules
                  </summary>
                  <div className="mt-4 grid gap-4 text-sm text-[var(--text-muted)]">
                    {workflowRules.beforePhaseStart.length > 0 ? (
                      <div>
                        <h3 className="font-semibold text-[var(--text)]">Before phase start</h3>
                        <ul className="mt-2 grid gap-2 pl-5">
                          {workflowRules.beforePhaseStart.map((item) => <li key={item} className="list-disc">{item}</li>)}
                        </ul>
                      </div>
                    ) : null}
                    {workflowRules.beforeTaskStart.length > 0 ? (
                      <div>
                        <h3 className="font-semibold text-[var(--text)]">Before task start</h3>
                        <ul className="mt-2 grid gap-2 pl-5">
                          {workflowRules.beforeTaskStart.map((item) => <li key={item} className="list-disc">{item}</li>)}
                        </ul>
                      </div>
                    ) : null}
                    {workflowRules.afterPhaseComplete.length > 0 ? (
                      <div>
                        <h3 className="font-semibold text-[var(--text)]">After phase complete</h3>
                        <ul className="mt-2 grid gap-2 pl-5">
                          {workflowRules.afterPhaseComplete.map((item) => <li key={item} className="list-disc">{item}</li>)}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </details>
              ) : null}

              {decisions.length > 0 ? (
                <details className="group rounded-[18px] border border-[var(--border)] bg-[var(--surface-card)] px-4 py-4">
                  <summary className="cursor-pointer select-none font-semibold text-[var(--text)]">
                    Legacy decisions ({decisions.length})
                  </summary>
                  <ul className="mt-4 grid gap-2 pl-5 text-sm text-[var(--text-muted)]">
                    {decisions.map((item) => <li key={item} className="list-disc">{item}</li>)}
                  </ul>
                </details>
              ) : null}

              <AcceptedDecisionsBlock decisions={acceptedDecisions} />
            </div>
          </details>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-4">
        <StatCard
          title="Features"
          value={String(features.length)}
          valueSuffix="total"
          subtitle={<><span className="font-semibold text-emerald-600 dark:text-emerald-400">{doneFeatures} done</span><span> · </span><span className="font-semibold text-amber-600 dark:text-amber-400">{remainingFeatures} left</span></>}
          icon={<Layers className="h-4 w-4" />}
        />
        <StatCard
          title="Phases"
          value={String(phases.length)}
          valueSuffix="total"
          subtitle={<><span className="font-semibold text-emerald-600 dark:text-emerald-400">{donePhases} done</span><span> · </span><span className="font-semibold text-amber-600 dark:text-amber-400">{remainingPhases} left</span></>}
          icon={<BarChart3 className="h-4 w-4" />}
        />
        <StatCard
          title="Tasks"
          value={String(totalTasks)}
          valueSuffix="total"
          subtitle={<><span className="font-semibold text-emerald-600 dark:text-emerald-400">{doneTasks} done</span><span> · </span><span className="font-semibold text-amber-600 dark:text-amber-400">{remainingTasks} left</span></>}
          icon={<ListTodo className="h-4 w-4" />}
        />
        <StatCard
          title="Completion"
          value={`${completion}%`}
          subtitle="Task completion rate"
          valueClassName={completionValueClassName(completion)}
          iconClassName={completionValueClassName(completion)}
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
      </div>

      <Card className="grid gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-lg font-bold text-[var(--text)]">Work Tree</h2>
            <p className="text-sm text-[var(--text-muted)]">Collapsible feature → phase → task tree. Click a feature or phase row to collapse/expand.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => setTreeOpenMode("all")}>
              Expand all
            </Button>
            <Button type="button" variant="secondary" onClick={() => setTreeOpenMode("none")}>
              Collapse all
            </Button>
            <Button type="button" variant="secondary" onClick={() => setShowAllFeatures((value) => !value)}>
              {showAllFeatures ? "Show active only" : "Show all features"}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 rounded-[18px] border border-[var(--border)] bg-[var(--surface-card)] px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setHideDone((value) => !value)}
              className={`status-chip transition ${hideDone ? "status-done" : "border border-[var(--border)] bg-transparent text-[var(--text-muted)]"}`}
            >
              Hide done
            </button>
            <button
              type="button"
              onClick={() => setHidePlanned((value) => !value)}
              className={`status-chip transition ${hidePlanned ? "status-planned" : "border border-[var(--border)] bg-transparent text-[var(--text-muted)]"}`}
            >
              Hide planned
            </button>
            <button
              type="button"
              onClick={() => setOnlyActiveBranches((value) => !value)}
              className={`status-chip transition ${onlyActiveBranches ? "status-in-progress" : "border border-[var(--border)] bg-transparent text-[var(--text-muted)]"}`}
            >
              Only active branches
            </button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowAllFeatures(true);
                setHideDone(false);
                setHidePlanned(false);
                setFeatureStatusFilters(allFeatureStatusValues);
                setPhaseStatusFilters(allPhaseStatusValues);
                setTaskStatusFilters(allTaskStatusValues);
                setOnlyActiveBranches(false);
                setTreeOpenMode("all");
              }}
            >
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
                  const report = await repairPlan();
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
                  const active = featureStatusFilters.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setFeatureStatusFilters((current) => toggleStatus(current, option.value, allFeatureStatusValues))}
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
                  const active = phaseStatusFilters.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setPhaseStatusFilters((current) => toggleStatus(current, option.value, allPhaseStatusValues))}
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
                  const active = taskStatusFilters.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setTaskStatusFilters((current) => toggleStatus(current, option.value, allTaskStatusValues))}
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
          {displayedWorkTree.length > 0 ? (
            displayedWorkTree.map(({ feature, totalTasks: featureTotal, doneTasks: featureDone, allPhases, hasActiveTask }) => {
              const featureExpanded = expandedFeatureIds.includes(feature.id);
              const featureRecentlyChanged = recentFeatureIds.includes(feature.id);
              return (
                <div key={feature.id} className={`surface-card px-4 py-3 transition-colors ${feature.status === "in-progress" ? "ap-in-progress" : hasActiveTask ? "border-[color:var(--color-status-in-progress)]/40 bg-[color:color-mix(in_srgb,var(--color-status-in-progress)_7%,transparent)]" : ""} ${feature.status === "done" ? "!opacity-70 !bg-[color:color-mix(in_srgb,var(--color-status-done)_10%,transparent)] !border-[color:color-mix(in_srgb,var(--color-status-done)_35%,transparent)]" : ""} ${featureRecentlyChanged ? "ring-1 ring-[color:color-mix(in_srgb,var(--accent)_55%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)]" : ""}`}>
                  <div className={`flex items-start justify-between gap-3 rounded-[12px] px-1 py-1 transition-colors hover:bg-[var(--accent-soft)] ${featureRecentlyChanged ? "bg-[color:color-mix(in_srgb,var(--accent)_10%,transparent)]" : ""}`}>
                    <div className="flex min-w-0 items-start gap-2 font-mono text-sm font-semibold">
                      <button
                        type="button"
                        onClick={() => toggleExpandedFeature(feature.id)}
                        className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-subtle)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text)]"
                        aria-label={featureExpanded ? `Collapse feature ${feature.name}` : `Expand feature ${feature.name}`}
                        aria-expanded={featureExpanded}
                      >
                        <ChevronRight className={`h-4 w-4 transition ${featureExpanded ? "rotate-90" : "rotate-0"}`} />
                      </button>
                      <span className="text-[var(--text-subtle)]">└─</span>
                      <Link to={`/features/${feature.id}`} className="entity-link--feature inline-flex min-w-0 items-center gap-2 truncate underline-offset-4 hover:underline">
                        {hasActiveTask ? (
                          <span aria-hidden="true" className="ap-progress-dot" />
                        ) : null}
                        <div className="flex items-center gap-2">
                          <EntityBadge type="feature" number={feature.number} />
                          <span className="truncate">{feature.name}</span>
                        </div>
                      </Link>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {featureRecentlyChanged ? <span className="rounded-full bg-[color:color-mix(in_srgb,var(--accent)_16%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">Updated</span> : null}
                      <span className="text-xs text-[var(--text-muted)]">({featureDone}/{featureTotal || 0})</span>
                      <StatusBadge status={feature.status} />
                    </div>
                  </div>

                  {featureExpanded && allPhases.length > 0 ? (
                    <div className="mt-3 ml-4 grid gap-2 border-l border-[var(--border)] pl-4">
                      {allPhases.map(({ phase, totalTasks: phaseTotal, doneTasks: phaseDone, allTasks, hasActiveTask: phaseHasActiveTask }, phaseIndex) => {
                        const phasePrefix = phaseIndex === allPhases.length - 1 ? "└─" : "├─";
                        const phaseExpanded = expandedPhaseIds.includes(phase.id);
                        const phaseRecentlyChanged = recentPhaseIds.includes(phase.id);
                        return (
                          <div key={phase.id} className={`grid gap-2 transition-colors ${phase.status === "in-progress" ? "ap-in-progress rounded-[12px]" : phaseHasActiveTask ? "rounded-[12px] border border-[color:color-mix(in_srgb,var(--color-status-in-progress)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--color-status-in-progress)_6%,transparent)] px-2 py-2" : ""} ${phase.status === "done" ? "rounded-[12px] opacity-70 bg-[color:color-mix(in_srgb,var(--color-status-done)_6%,transparent)] px-2 py-2" : ""} ${phaseRecentlyChanged ? "rounded-[12px] ring-1 ring-[color:color-mix(in_srgb,var(--accent)_55%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)] px-2 py-2" : ""}`}>
                            <div className={`flex items-start justify-between gap-3 rounded-[10px] px-1 py-1 transition-colors hover:bg-[var(--accent-soft)] ${phaseRecentlyChanged ? "bg-[color:color-mix(in_srgb,var(--accent)_8%,transparent)]" : ""}`}>
                              <div className="flex min-w-0 items-start gap-2 font-mono text-sm">
                                <button
                                  type="button"
                                  onClick={() => toggleExpandedPhase(phase.id)}
                                  className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-subtle)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text)]"
                                  aria-label={phaseExpanded ? `Collapse phase ${phase.title}` : `Expand phase ${phase.title}`}
                                  aria-expanded={phaseExpanded}
                                >
                                  <ChevronRight className={`h-4 w-4 transition ${phaseExpanded ? "rotate-90" : "rotate-0"}`} />
                                </button>
                                <span className="text-[var(--text-subtle)]">{phasePrefix}</span>
                                <Link to={`/features/${feature.id}/phases/${phase.id}`} className="entity-link--phase inline-flex min-w-0 items-center gap-2 truncate underline-offset-4 hover:underline">
                                  {phaseHasActiveTask ? (
                                    <span aria-hidden="true" className="ap-progress-dot" />
                                  ) : null}
                                  <div className="flex items-center gap-2">
                                  <EntityBadge type="phase" number={phase.number} />
                                  <ParentBadge type="phase" featureNum={feature?.number} />
                                  <span className="truncate">{phase.title}</span>
                                </div>
                                </Link>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                {phaseRecentlyChanged ? <span className="rounded-full bg-[color:color-mix(in_srgb,var(--accent)_16%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">Updated</span> : null}
                                <span className="text-xs text-[var(--text-muted)]">({phaseDone}/{phaseTotal || 0})</span>
                                <StatusBadge status={phase.status} />
                              </div>
                            </div>

                            {phaseExpanded ? (
                              allTasks.length > 0 ? (
                                <div className="ml-4 grid gap-1 border-l border-[var(--border)] pl-4">
                                  {allTasks.map((task: Task, taskIndex: number) => {
                                    const taskPrefix = taskIndex === allTasks.length - 1 ? "└─" : "├─";
                                    const taskRecentlyChanged = recentTaskIds.includes(task.id);
                                    return (
                                      <div key={task.id} className={`flex items-start justify-between gap-3 rounded-[10px] px-1 py-1 font-mono text-sm transition-colors hover:bg-[var(--accent-soft)] ${task.status === "in-progress" ? "ap-in-progress" : ""} ${task.status === "done" ? "opacity-60 bg-[color:color-mix(in_srgb,var(--color-status-done)_6%,transparent)]" : ""} ${task.status === "done" ? "text-[var(--text-muted)]" : ""} ${taskRecentlyChanged ? "ring-1 ring-[color:color-mix(in_srgb,var(--accent)_55%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)]" : ""}`}>
                                        <Link
                                          to={`/features/${feature.id}/phases/${phase.id}/tasks/${task.id}`}
                                          className="min-w-0 text-[var(--text-muted)] transition hover:text-[var(--accent)]"
                                        >
                                          <span className="text-[var(--text-subtle)]">│  {taskPrefix} </span>
                                          <span className="inline-flex items-center gap-2">
                                            {task.status === "in-progress" ? (
                                              <span aria-hidden="true" className="ap-progress-dot" />
                                            ) : null}
                                            <div className="flex items-center gap-2">
                                              <EntityBadge type="task" number={task.number} />
                                              <ParentBadge type="task" phaseNum={phase.number} featureNum={feature?.number} />
                                              <span className="entity-link--task underline-offset-4 hover:underline">{task.title}</span>
                                            </div>
                                          </span>
                                        </Link>
                                        <div className="flex shrink-0 items-center gap-2">
                                          {taskRecentlyChanged ? <span className="rounded-full bg-[color:color-mix(in_srgb,var(--accent)_16%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">Updated</span> : null}
                                          <span className="shrink-0"><StatusBadge status={task.status} /></span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className="ml-4 font-mono text-xs text-[var(--text-subtle)]">│  └─ no tasks</p>
                              )
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })
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

      <Card className="grid gap-4">
        <div>
          <h2 className="text-lg font-bold text-[var(--text)]">Latest completed tasks</h2>
          <p className="text-sm text-[var(--text-muted)]">Most recently completed tasks, ordered by completion timestamp.</p>
        </div>

        <div className="grid gap-3">
          {latestCompletedTasks.length > 0 ? latestCompletedTasks.map(({ task, phase, feature, featureName, completedAt }) => (
            <Link
              key={task.id}
              to={phase.featureId ? `/features/${phase.featureId}/phases/${phase.id}/tasks/${task.id}` : "/features"}
              className="surface-card grid gap-1 px-4 py-3 transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <EntityBadge type="task" number={task.number} />
                  <ParentBadge type="task" phaseNum={phase.number} featureNum={feature?.number} />
                  <span className="entity-link--task truncate text-sm font-semibold underline-offset-4 hover:underline">{task.title}</span>
                </div>
                <StatusBadge status={task.status} />
              </div>
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <ParentBadge type="phase" featureNum={feature?.number} />
                <span>{featureName} · {phase.title}</span>
              </div>
              <div className="text-[11px] text-[var(--text-subtle)]">Completed {formatDateTime(completedAt)}</div>
            </Link>
          )) : (
            <p className="py-4 text-center text-sm text-[var(--text-muted)]">No completed tasks yet.</p>
          )}
        </div>
      </Card>

    </div>
  );
}
