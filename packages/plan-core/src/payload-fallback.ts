export type PlannerPayloadEntity = "project" | "feature" | "phase" | "task";
export type PlannerPayloadOperation = "update" | "discuss";
export type PlannerPayloadFailureCode = "NO_MUTABLE_FIELDS_RECEIVED" | "DESCRIPTION_MARKDOWN_FALLBACK_REQUIRED";

export interface DescriptionFallbackInput {
  entityId?: string;
  inputField: string;
  storedField: string;
  descriptionRefField: string;
}

export interface NoMutableFieldsReceivedInput {
  entity: PlannerPayloadEntity;
  ref: string;
  operation: PlannerPayloadOperation;
  mutableFields: readonly string[];
  retryCommand: string;
  readBackCommand?: string;
  descriptionFallback?: DescriptionFallbackInput;
}

export interface NoMutableFieldsReceivedResult {
  updated: false;
  discussed?: false;
  reason: "no-mutable-fields";
  errorCode: PlannerPayloadFailureCode;
  suspectedLongTextPayloadLoss: boolean;
  entity: PlannerPayloadEntity;
  ref: string;
  operation: PlannerPayloadOperation;
  mutableFields: string[];
  fallbackDocPath?: string;
  fallbackDescriptionTemplate?: string;
  nextActions: string[];
  message: string;
}

export function normalizeDescriptionRef(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function isPlannerDescriptionRef(value: string): boolean {
  if (!value.startsWith(".planner/docs/")) return false;
  if (value.includes("\\") || value.includes("\0")) return false;
  const parts = value.split("/");
  if (parts.length < 4) return false;
  if (parts[0] !== ".planner" || parts[1] !== "docs") return false;
  return parts.slice(2).every((part) => part.length > 0 && part !== "." && part !== "..");
}

export function suggestedDescriptionRefPath(entity: PlannerPayloadEntity, entityId?: string): string {
  switch (entity) {
    case "project":
      return ".planner/docs/project/description.md";
    case "feature":
      return `.planner/docs/features/${entityId ?? "feature"}.md`;
    case "phase":
      return `.planner/docs/phases/${entityId ?? "phase"}.md`;
    case "task":
      return `.planner/docs/tasks/${entityId ?? "task"}.md`;
  }
}

export function noMutableFieldsReceived(
  input: NoMutableFieldsReceivedInput,
): NoMutableFieldsReceivedResult {
  const mutableFields = [...input.mutableFields];
  const fallbackDocPath = input.descriptionFallback
    ? suggestedDescriptionRefPath(input.entity, input.descriptionFallback.entityId)
    : undefined;

  const nextActions = input.descriptionFallback && fallbackDocPath
    ? [
      `Create a committed markdown file at ${fallbackDocPath} containing the full intended ${input.descriptionFallback.storedField}.`,
      `Retry ${input.retryCommand} with a concise ${input.descriptionFallback.inputField} summary and ${input.descriptionFallback.descriptionRefField} set to ${fallbackDocPath}.`,
      ...(input.readBackCommand
        ? [`Read back ${input.readBackCommand} and confirm the summary plus ${input.descriptionFallback.descriptionRefField} survived.`]
        : []),
      "Continue only after the read-back confirms the markdown reference persisted.",
    ]
    : [
      `Retry ${input.retryCommand} with at least one mutable field: ${mutableFields.join(", ")}.`,
    ];

  const fallbackDescriptionTemplate = fallbackDocPath
    ? `Concise summary here. Full description is stored in ${fallbackDocPath}.`
    : undefined;

  const message = [
    "Not updated — no mutable fields were received.",
    "No planner data was changed.",
    input.descriptionFallback
      ? `If you attempted to send a long ${input.descriptionFallback.inputField}, it may have exceeded the tool payload limit before reaching the planner.`
      : `Provide at least one mutable field for this ${input.operation} operation.`,
    "Next required actions:",
    ...nextActions.map((action, index) => `${index + 1}. ${action}`),
  ].join("\n");

  return {
    updated: false,
    ...(input.operation === "discuss" ? { discussed: false as const } : {}),
    reason: "no-mutable-fields",
    errorCode: input.descriptionFallback ? "DESCRIPTION_MARKDOWN_FALLBACK_REQUIRED" : "NO_MUTABLE_FIELDS_RECEIVED",
    suspectedLongTextPayloadLoss: Boolean(input.descriptionFallback),
    entity: input.entity,
    ref: input.ref,
    operation: input.operation,
    mutableFields,
    ...(fallbackDocPath ? { fallbackDocPath } : {}),
    ...(fallbackDescriptionTemplate ? { fallbackDescriptionTemplate } : {}),
    nextActions,
    message,
  };
}
