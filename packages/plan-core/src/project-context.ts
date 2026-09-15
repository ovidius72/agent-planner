import { createHash } from "node:crypto";
import { z } from "zod";
import {
  AcceptedDecisionSchema,
  DescriptionRefSchema,
  MacroTaskSchema,
  type Project,
  type RequirementsDocument,
  TimestampSchema,
} from "./schema.js";
import { renderAcceptedDecisionsSection } from "./task-context.js";

export const PROJECT_CONTEXT_DELIVERY_VERSION = 1;
export const DEFAULT_PROJECT_CONTEXT_CHUNK_CHARS = 16_000;

export const ProjectContextReadAttestationSchema = z.object({
  sessionId: z.string().min(1),
  createdAt: TimestampSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});

export const ProjectContextReadStateDocumentSchema = z.object({
  version: z.literal(PROJECT_CONTEXT_DELIVERY_VERSION).default(PROJECT_CONTEXT_DELIVERY_VERSION),
  sessionInfo: z.array(ProjectContextReadAttestationSchema).default([]),
});

export type ProjectContextReadAttestation = z.infer<typeof ProjectContextReadAttestationSchema>;
export type ProjectContextReadStateDocument = z.infer<typeof ProjectContextReadStateDocumentSchema>;

const ProjectContextRequirementSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string().default(""),
  macroTasks: z.array(MacroTaskSchema).default([]),
  linkedPhaseIds: z.array(z.string().min(1)).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const ProjectContextSnapshotSchema = z.object({
  version: z.literal(PROJECT_CONTEXT_DELIVERY_VERSION),
  project: z.object({
    name: z.string().min(1),
    goal: z.string(),
    description: z.string(),
    descriptionRef: DescriptionRefSchema.optional(),
    scope: z.array(z.string().min(1)),
    outOfScope: z.array(z.string().min(1)),
    technologies: z.array(z.string().min(1)),
    tools: z.array(z.string().min(1)),
    contentLanguage: z.string(),
    chatLanguage: z.string(),
    projectGuidelines: z.object({
      content: z.string(),
      updatedAt: z.string(),
    }),
    acceptedDecisions: z.array(AcceptedDecisionSchema),
  }),
  requirements: z.array(ProjectContextRequirementSchema),
});

export type ProjectContextSnapshot = z.infer<typeof ProjectContextSnapshotSchema>;

export const ProjectContextChunkSchema = z.object({
  version: z.literal(PROJECT_CONTEXT_DELIVERY_VERSION),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.literal("partial"),
  complete: z.literal(false),
  truncated: z.boolean(),
  deliveredChunks: z.literal(1),
  index: z.number().int().nonnegative(),
  totalChunks: z.number().int().positive(),
  cursor: z.string().min(1).optional(),
  nextCursor: z.string().min(1).optional(),
  content: z.string(),
});

export type ProjectContextChunk = z.infer<typeof ProjectContextChunkSchema>;

export interface ProjectContextDeliveryEvidence {
  version: typeof PROJECT_CONTEXT_DELIVERY_VERSION;
  fingerprint: string;
  status: "complete";
  complete: true;
  truncated: false;
  chunked: boolean;
  deliveredChunks: number;
  totalChunks: number;
  serializedChars: number;
}

export interface CompleteProjectContextDelivery {
  snapshot: ProjectContextSnapshot;
  chunks: ProjectContextChunk[];
  evidence: ProjectContextDeliveryEvidence;
}

export type ProjectContextReadState = "missing" | "stale" | "valid";
export type ProjectContextDeliveryErrorCode =
  | "PROJECT_CONTEXT_DELIVERY_INCOMPLETE"
  | "PROJECT_CONTEXT_DELIVERY_INVALID"
  | "PROJECT_CONTEXT_DELIVERY_STALE";

export class ProjectContextDeliveryError extends Error {
  readonly code: ProjectContextDeliveryErrorCode;

  constructor(code: ProjectContextDeliveryErrorCode, message: string) {
    super(message);
    this.name = "ProjectContextDeliveryError";
    this.code = code;
  }
}

/** Build the content-only project snapshot used by every harness. */
export function createProjectContextSnapshot(
  project: Project,
  requirements: RequirementsDocument,
): ProjectContextSnapshot {
  return ProjectContextSnapshotSchema.parse({
    version: PROJECT_CONTEXT_DELIVERY_VERSION,
    project: {
      name: project.name,
      goal: project.goal,
      description: project.description,
      ...(project.descriptionRef ? { descriptionRef: project.descriptionRef } : {}),
      scope: project.scope,
      outOfScope: project.outOfScope,
      technologies: project.technologies,
      tools: project.tools,
      contentLanguage: project.contentLanguage,
      chatLanguage: project.chatLanguage,
      projectGuidelines: {
        content: project.projectGuidelines.content,
        updatedAt: project.projectGuidelines.updatedAt,
      },
      acceptedDecisions: project.acceptedDecisions,
    },
    requirements: requirements.requirements.map((requirement) => ({
      id: requirement.id,
      title: requirement.title,
      description: requirement.description,
      macroTasks: requirement.macroTasks,
      linkedPhaseIds: requirement.linkedPhaseIds,
      createdAt: requirement.createdAt,
      updatedAt: requirement.updatedAt,
    })),
  });
}

export function serializeProjectContext(snapshot: ProjectContextSnapshot): string {
  return JSON.stringify(ProjectContextSnapshotSchema.parse(snapshot));
}

export function projectContextFingerprint(snapshot: ProjectContextSnapshot): string {
  return createHash("sha256").update(serializeProjectContext(snapshot), "utf8").digest("hex");
}

/**
 * Split canonical JSON without dropping data. Individual chunks never assert
 * completeness; only verifyProjectContextChunks can produce complete evidence.
 */
export function createProjectContextChunks(
  snapshot: ProjectContextSnapshot,
  maxChars = DEFAULT_PROJECT_CONTEXT_CHUNK_CHARS,
): ProjectContextChunk[] {
  if (!Number.isInteger(maxChars) || maxChars < 1) {
    throw new ProjectContextDeliveryError("PROJECT_CONTEXT_DELIVERY_INVALID", "Project-context chunk size must be a positive integer.");
  }
  const serialized = serializeProjectContext(snapshot);
  const fingerprint = projectContextFingerprint(snapshot);
  const parts = serialized.length === 0
    ? [""]
    : Array.from({ length: Math.ceil(serialized.length / maxChars) }, (_, index) => serialized.slice(index * maxChars, (index + 1) * maxChars));
  return parts.map((content, index) => ({
    version: PROJECT_CONTEXT_DELIVERY_VERSION,
    fingerprint,
    status: "partial" as const,
    complete: false as const,
    truncated: parts.length > 1,
    deliveredChunks: 1 as const,
    index,
    totalChunks: parts.length,
    ...(parts.length > 1 ? { cursor: `${fingerprint}:${index}` } : {}),
    ...(index + 1 < parts.length ? { nextCursor: `${fingerprint}:${index + 1}` } : {}),
    content,
  }));
}

/** Verify an exact, ordered, complete chunk sequence and reconstruct its DTO. */
export function verifyProjectContextChunks(chunks: ProjectContextChunk[]): CompleteProjectContextDelivery {
  if (chunks.length === 0) {
    throw new ProjectContextDeliveryError("PROJECT_CONTEXT_DELIVERY_INCOMPLETE", "Project-context delivery contains no chunks.");
  }
  let parsedChunks: ProjectContextChunk[];
  try {
    parsedChunks = ProjectContextChunkSchema.array().parse(chunks);
  } catch (error) {
    throw new ProjectContextDeliveryError(
      "PROJECT_CONTEXT_DELIVERY_INVALID",
      `Project-context chunk metadata is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const first = parsedChunks[0]!;
  const receivedIndexes = parsedChunks.map((chunk) => chunk.index);
  if (parsedChunks.length !== first.totalChunks || parsedChunks.some((chunk, index) => chunk.index !== index)) {
    throw new ProjectContextDeliveryError(
      "PROJECT_CONTEXT_DELIVERY_INCOMPLETE",
      `Project-context delivery is incomplete: received ordered chunks [${receivedIndexes.join(", ")}], expected indexes 0 through ${first.totalChunks - 1}.`,
    );
  }
  const chunked = first.totalChunks > 1;
  if (parsedChunks.some((chunk) => chunk.version !== PROJECT_CONTEXT_DELIVERY_VERSION
    || chunk.fingerprint !== first.fingerprint
    || chunk.totalChunks !== first.totalChunks
    || chunk.truncated !== chunked
    || (chunked ? chunk.cursor !== `${first.fingerprint}:${chunk.index}` : chunk.cursor !== undefined)
    || (chunk.index + 1 < chunk.totalChunks
      ? chunk.nextCursor !== `${first.fingerprint}:${chunk.index + 1}`
      : chunk.nextCursor !== undefined))) {
    throw new ProjectContextDeliveryError("PROJECT_CONTEXT_DELIVERY_INVALID", "Project-context chunks have inconsistent version, fingerprint, truncation, cursor, or sequence metadata.");
  }
  const serialized = parsedChunks.map((chunk) => chunk.content).join("");
  let snapshot: ProjectContextSnapshot;
  try {
    snapshot = ProjectContextSnapshotSchema.parse(JSON.parse(serialized));
  } catch (error) {
    throw new ProjectContextDeliveryError(
      "PROJECT_CONTEXT_DELIVERY_INVALID",
      `Project-context chunks do not reconstruct a valid canonical snapshot: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const fingerprint = projectContextFingerprint(snapshot);
  if (fingerprint !== first.fingerprint) {
    throw new ProjectContextDeliveryError("PROJECT_CONTEXT_DELIVERY_INVALID", "Project-context fingerprint does not match the reconstructed canonical snapshot.");
  }
  return {
    snapshot,
    chunks: parsedChunks,
    evidence: {
      version: PROJECT_CONTEXT_DELIVERY_VERSION,
      fingerprint,
      status: "complete",
      complete: true,
      truncated: false,
      chunked,
      deliveredChunks: parsedChunks.length,
      totalChunks: parsedChunks.length,
      serializedChars: serialized.length,
    },
  };
}

export function createCompleteProjectContextDelivery(
  project: Project,
  requirements: RequirementsDocument,
  maxChars = DEFAULT_PROJECT_CONTEXT_CHUNK_CHARS,
): CompleteProjectContextDelivery {
  const snapshot = createProjectContextSnapshot(project, requirements);
  return verifyProjectContextChunks(createProjectContextChunks(snapshot, maxChars));
}

export function projectContextReadState(
  snapshot: ProjectContextSnapshot,
  attestations: ProjectContextReadAttestation[] | undefined,
  sessionId: string,
): ProjectContextReadState {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) return "missing";
  const attestation = attestations?.find((entry) => entry.sessionId === normalizedSessionId);
  if (!attestation) return "missing";
  return attestation.fingerprint === projectContextFingerprint(snapshot) ? "valid" : "stale";
}

/** Render the complete snapshot without applying a transport truncation policy. */
export function renderProjectContext(snapshot: ProjectContextSnapshot): string {
  const { project, requirements } = snapshot;
  const lines = [
    `Project context v${snapshot.version}`,
    `Name: ${project.name}`,
    `Short description: ${project.description || "(not set)"}`,
    `Description reference: ${project.descriptionRef ?? "(not set)"}`,
    `Goal: ${project.goal || "(not set)"}`,
    `Scope: ${project.scope.join("; ") || "(none)"}`,
    `Out of scope: ${project.outOfScope.join("; ") || "(none)"}`,
    `Technologies: ${project.technologies.join("; ") || "(none)"}`,
    `Tools: ${project.tools.join("; ") || "(none)"}`,
    `Content language: ${project.contentLanguage || "(not set)"}`,
    `Chat language: ${project.chatLanguage || "(not set)"}`,
    "",
    "Project Guidelines:",
    project.projectGuidelines.content || "(none)",
    `Guidelines updated at: ${project.projectGuidelines.updatedAt || "(not set)"}`,
    "",
    `Requirements (${requirements.length}):`,
  ];
  if (requirements.length === 0) {
    lines.push("  - None.");
  } else {
    for (const requirement of requirements) {
      lines.push(`  - ${requirement.id} — ${requirement.title}`);
      lines.push(`    Description: ${requirement.description || "(not provided)"}`);
      lines.push(`    Linked phases: ${requirement.linkedPhaseIds.join(", ") || "None"}`);
      lines.push(`    Created at: ${requirement.createdAt}`);
      lines.push(`    Updated at: ${requirement.updatedAt}`);
      lines.push(`    Macro tasks (${requirement.macroTasks.length}):`);
      if (requirement.macroTasks.length === 0) lines.push("      - None.");
      for (const macroTask of requirement.macroTasks) {
        lines.push(`      - ${macroTask.id} — ${macroTask.title} (${macroTask.status})`);
        lines.push(`        Description: ${macroTask.description || "(not provided)"}`);
        lines.push(`        Created at: ${macroTask.createdAt}`);
        lines.push(`        Updated at: ${macroTask.updatedAt}`);
      }
    }
  }
  lines.push("", renderAcceptedDecisionsSection("Project Accepted Decisions", project.acceptedDecisions));
  return lines.join("\n");
}
