/**
 * Canonical field-level semantic capability contract.
 * Each human-owned field declares where it is read, mutated, loaded into agent
 * context, documented, and behaviorally verified. System-owned and derived
 * fields are explicit exceptions rather than silent parity gaps.
 */

const allHarnesses = ["core", "pi", "mcp", "http", "web-ui", "agent-load", "docs", "behavioral-test"];

const field = (entity, name, operations, rationale = "") => ({
  entity,
  name,
  operations,
  surfaces: Object.fromEntries(allHarnesses.map((harness) => [harness, true])),
  ...(rationale ? { exception: rationale } : {}),
});

export const fieldCapabilityManifest = [
  field("project", "name", ["read", "create", "update"]),
  field("project", "goal", ["read", "update"]),
  field("project", "description", ["read", "update"]),
  field("project", "descriptionRef", ["read", "update"]),
  field("project", "projectGuidelines", ["read", "update", "agent-context"]),
  field("project", "scope", ["read", "update"]),
  field("project", "outOfScope", ["read", "update"]),
  field("project", "technologies", ["read", "update"]),
  field("project", "tools", ["read", "update"]),
  field("project", "contentLanguage", ["read", "update"]),
  field("project", "chatLanguage", ["read", "update"]),
  field("project", "acceptedDecisions", ["read", "create", "update", "delete", "agent-context"]),

  field("feature", "name", ["read", "create", "update"]),
  field("feature", "description", ["read", "update"]),
  field("feature", "descriptionRef", ["read", "update"]),
  field("feature", "priority", ["read", "update"]),
  field("feature", "planningContext", ["read", "update", "agent-context"]),
  field("feature", "acceptedDecisions", ["read", "create", "update", "delete", "agent-context"]),
  field("feature", "dependsOn", ["read", "update"]),

  field("phase", "title", ["read", "create", "update"]),
  field("phase", "description", ["read", "update"]),
  field("phase", "descriptionRef", ["read", "update"]),
  field("phase", "priority", ["read", "update"]),
  field("phase", "planningContext", ["read", "update", "agent-context"]),
  field("phase", "acceptedDecisions", ["read", "create", "update", "delete", "agent-context"]),
  field("phase", "dependsOn", ["read", "update"]),
  field("phase", "handoff", ["read", "create", "update", "delete", "agent-context"]),

  field("task", "title", ["read", "create", "update"]),
  field("task", "description", ["read", "update"]),
  field("task", "descriptionRef", ["read", "update"]),
  field("task", "priority", ["read", "update"]),
  field("task", "notes", ["read", "update", "agent-context"]),
  field("task", "decisions", ["read", "update", "agent-context"]),
  field("task", "acceptedDecisions", ["read", "create", "update", "delete", "agent-context"]),
  field("task", "checklist", ["read", "update"]),
  field("task", "subtasks", ["read", "create", "update", "delete", "agent-context"]),
  field("task", "dependsOn", ["read", "create", "update", "delete", "agent-context"]),

  field("requirement", "title", ["read", "create", "update"]),
  field("requirement", "description", ["read", "create", "update"]),
  field("requirement", "macroTasks", ["read", "create", "update", "delete"]),
  field("requirement", "linkedPhaseIds", ["read", "update"]),
  field("idea", "title", ["read", "create", "update"]),
  field("idea", "description", ["read", "create", "update"]),

  field("feature", "status", [], "Derived from child phases; never persisted or directly mutated."),
  field("phase", "status", [], "Derived from child tasks; lifecycle transitions are governed by task state."),
  field("requirement", "status", [], "Removed from the canonical contract; legacy persisted values are stripped."),
  field("task", "id", [], "Planner-owned identity; semantic operations preserve it and callers cannot forge it."),
];

export const fieldCapabilityByKey = new Map(fieldCapabilityManifest.map((entry) => [`${entry.entity}.${entry.name}`, entry]));
