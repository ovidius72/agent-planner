/* ─── Domain types matching the server API ───────────────────────────── */

export type FeatureStatus = "planned" | "in-progress" | "done" | "blocked" | "canceled";
export type PhaseStatus = "draft" | "discovery" | "planned" | "in-progress" | "done" | "blocked" | "canceled";
export type TaskStatus = "planned" | "in-progress" | "done" | "blocked" | "canceled";

export interface Feature {
  id: string;
  name: string;
  description: string;
  status: FeatureStatus;
  startDate: string;
  endDate: string;
  workDone: string;
  workRemaining: string;
  phaseIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  phaseId: string;
  shortName: string;
  title: string;
  status: TaskStatus;
  description: string;
  checklist: string[];
  subtasks: Subtask[];
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

export interface Phase {
  id: string;
  featureId?: string;
  number: number;
  slug: string;
  title: string;
  status: PhaseStatus;
  summary: string;
  description: string;
  goals: string[];
  nonGoals: string[];
  dependencies: string[];
  risks: string[];
  openQuestions: string[];
  completionCriteria: string[];
  taskIds: string[];
  tasks: Task[];
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  name: string;
  goal: string;
  scope: string[];
  outOfScope: string[];
  decisions: string[];
  globalRules: string[];
  technologies: string[];
  tools: string[];
  workflowRules: {
    beforePhaseStart: string[];
    beforeTaskStart: string[];
    afterPhaseComplete: string[];
  };
}

export interface Manifest {
  schemaVersion: number;
  projectId: string;
  projectName: string;
  createdAt: string;
  updatedAt: string;
}
