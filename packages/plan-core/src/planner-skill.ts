import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const MANAGED_SKILL_HEADER = /^<!-- agent-plan-managed-skill sha256:([a-f0-9]{64}) -->\n/;
const CANONICAL_SKILL_URL = new URL("../planner-skill.md", import.meta.url);

export type PlannerSkillSyncStatus = "created" | "current" | "updated" | "customized";

export interface PlannerSkillSyncResult {
  path: string;
  status: PlannerSkillSyncStatus;
  content: string;
  canonicalHash: string;
  customized: boolean;
  message: string;
}

function normalizeSkillContent(content: string): string {
  return `${content.replace(/\r\n/g, "\n").trimEnd()}\n`;
}

export function plannerSkillHash(content: string): string {
  return createHash("sha256").update(normalizeSkillContent(content), "utf8").digest("hex");
}

export function renderManagedPlannerSkill(content: string): string {
  const normalized = normalizeSkillContent(content);
  return `<!-- agent-plan-managed-skill sha256:${plannerSkillHash(normalized)} -->\n${normalized}`;
}

export function managedPlannerSkillBody(content: string): string {
  return normalizeSkillContent(content.replace(MANAGED_SKILL_HEADER, ""));
}

export async function loadCanonicalPlannerSkill(): Promise<string> {
  return normalizeSkillContent(await readFile(CANONICAL_SKILL_URL, "utf8"));
}

/**
 * Create or safely refresh `.planner/SKILL.md`.
 *
 * Managed copies carry a body hash. If the body still matches its declared
 * hash, Agent Plan may replace it with the current canonical version. Any
 * unmarked or hash-mismatched file is project-customized and is preserved.
 */
export async function syncProjectPlannerSkill(plannerRoot: string): Promise<PlannerSkillSyncResult> {
  const path = join(plannerRoot, "SKILL.md");
  const canonical = await loadCanonicalPlannerSkill();
  const canonicalHash = plannerSkillHash(canonical);
  const managedCanonical = renderManagedPlannerSkill(canonical);
  const existing = await readFile(path, "utf8").catch(() => null);

  if (existing == null) {
    await writeFile(path, managedCanonical, "utf8");
    return {
      path,
      status: "created",
      content: canonical,
      canonicalHash,
      customized: false,
      message: "Created the canonical project-local planner skill.",
    };
  }

  if (normalizeSkillContent(existing) === normalizeSkillContent(managedCanonical)) {
    return {
      path,
      status: "current",
      content: canonical,
      canonicalHash,
      customized: false,
      message: "The project-local planner skill matches the canonical version.",
    };
  }

  // Adopt an exact unmarked copy of the current canonical guide. This supports
  // projects that copied the first canonical skill before managed headers were
  // introduced without treating that copy as a customization.
  if (!MANAGED_SKILL_HEADER.test(existing) && normalizeSkillContent(existing) === canonical) {
    await writeFile(path, managedCanonical, "utf8");
    return {
      path,
      status: "updated",
      content: canonical,
      canonicalHash,
      customized: false,
      message: "Adopted and marked the unmodified canonical planner skill.",
    };
  }

  const marker = existing.match(MANAGED_SKILL_HEADER);
  const existingBody = managedPlannerSkillBody(existing);
  if (marker && plannerSkillHash(existingBody) === marker[1]) {
    await writeFile(path, managedCanonical, "utf8");
    return {
      path,
      status: "updated",
      content: canonical,
      canonicalHash,
      customized: false,
      message: "Updated the unmodified project-local planner skill to the current canonical version.",
    };
  }

  return {
    path,
    status: "customized",
    content: existingBody,
    canonicalHash,
    customized: true,
    message: "Preserved the customized .planner/SKILL.md. Reconcile it manually with the current canonical Agent Plan guide; Agent Plan did not overwrite project instructions.",
  };
}
