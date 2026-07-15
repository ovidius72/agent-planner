export type FeatureStatus = "planned" | "in-progress" | "done" | "blocked" | "canceled" | "rejected" | "deferred" | "waiting";
export type PhaseStatus = "draft" | "discovery" | "planned" | "in-progress" | "done" | "blocked" | "canceled" | "rejected" | "deferred" | "waiting";
export type TaskStatus = "planned" | "in-progress" | "done" | "blocked" | "canceled" | "rejected" | "deferred" | "waiting";

export interface AcceptedDecision {
  id: string;
  title: string;
  decision: string;
  rationale: string;
  implementationNotes: string;
  acceptedAt: string;
}

export interface Feature {
  id: string;
  number: number;
  shortId: string;
  priority: number;
  name: string;
  description: string;
  status: FeatureStatus;
  discussedAt: string;
  contextReady: boolean;
  contextReadyReason: string;
  startDate: string;
  endDate: string;
  workDone: string;
  workRemaining: string;
  acceptedDecisions: AcceptedDecision[];
  phaseIds: string[];
  dependsOn: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Subtask {
  id: string;
  title: string;
  status: TaskStatus;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistItem {
  id: string;
  title: string;
  checked: boolean;
}

export interface StatusLogEntry {
  id: string;
  date: string;
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
  title: string;
  description: string;
}

export interface Task {
  id: string;
  phaseId: string;
  number: number;
  shortId: string;
  priority: number;
  shortName: string;
  title: string;
  status: TaskStatus;
  description: string;
  notes: string;
  statusLog: StatusLogEntry[];
  decisions: string[];
  acceptedDecisions: AcceptedDecision[];
  checklist: ChecklistItem[];
  subtasks: Subtask[];
  dependsOn: string[];
  startedAt: string;
  completedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Phase {
  id: string;
  featureId?: string;
  number: number;
  shortId: string;
  priority: number;
  slug: string;
  title: string;
  status: PhaseStatus;
  discussedAt: string;
  contextReady: boolean;
  contextReadyReason: string;
  summary: string;
  description: string;
  notes: string;
  goals: string[];
  nonGoals: string[];
  dependencies: string[];
  dependsOn: string[];
  risks: string[];
  openQuestions: string[];
  decisions: string[];
  acceptedDecisions: AcceptedDecision[];
  completionCriteria: string[];
  taskIds: string[];
  tasks: Task[];
  createdAt: string;
  updatedAt: string;
}

export interface HandoffDocument {
  exists: boolean;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  name: string;
  goal: string;
  description: string;
  webPort: number;
  scope: string[];
  outOfScope: string[];
  decisions: string[];
  globalRules: string[];
  technologies: string[];
  tools: string[];
  acceptedDecisions: AcceptedDecision[];
  workflowRules: {
    beforePhaseStart: string[];
    beforeTaskStart: string[];
    afterPhaseComplete: string[];
  };
  planRoot?: string;
  projectRoot?: string;
}
