import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const MANAGED_SKILL_HEADER = /^<!-- agent-plan-managed-skill sha256:([a-f0-9]{64}) -->\n/;
const CANONICAL_SKILL_URL = new URL("../planner-skill.md", import.meta.url);
const CANONICAL_GRILL_ME_SKILL_URL = new URL("../skills/grill-me/SKILL.md", import.meta.url);

export type PlannerSkillSyncStatus = "created" | "current" | "updated" | "customized";

export interface PlannerSkillSyncResult {
  path: string;
  status: PlannerSkillSyncStatus;
  content: string;
  canonicalHash: string;
  customized: boolean;
  message: string;
}

interface ManagedSkillMessages {
  created: string;
  current: string;
  adopted: string;
  updated: string;
  customized: string;
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

export async function loadCanonicalGrillMeSkill(): Promise<string> {
  return normalizeSkillContent(await readFile(CANONICAL_GRILL_ME_SKILL_URL, "utf8"));
}

async function syncManagedProjectSkill(
  path: string,
  canonical: string,
  messages: ManagedSkillMessages,
): Promise<PlannerSkillSyncResult> {
  const canonicalHash = plannerSkillHash(canonical);
  const managedCanonical = renderManagedPlannerSkill(canonical);
  const existing = await readFile(path, "utf8").catch(() => null);

  if (existing == null) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, managedCanonical, "utf8");
    return {
      path,
      status: "created",
      content: canonical,
      canonicalHash,
      customized: false,
      message: messages.created,
    };
  }

  if (normalizeSkillContent(existing) === normalizeSkillContent(managedCanonical)) {
    return {
      path,
      status: "current",
      content: canonical,
      canonicalHash,
      customized: false,
      message: messages.current,
    };
  }

  // Adopt an exact unmarked canonical copy. This supports projects that copied
  // a canonical skill before managed headers were introduced.
  if (!MANAGED_SKILL_HEADER.test(existing) && normalizeSkillContent(existing) === canonical) {
    await writeFile(path, managedCanonical, "utf8");
    return {
      path,
      status: "updated",
      content: canonical,
      canonicalHash,
      customized: false,
      message: messages.adopted,
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
      message: messages.updated,
    };
  }

  return {
    path,
    status: "customized",
    content: existingBody,
    canonicalHash,
    customized: true,
    message: messages.customized,
  };
}

/** Create or safely refresh `.planner/SKILL.md`. */
export async function syncProjectPlannerSkill(plannerRoot: string): Promise<PlannerSkillSyncResult> {
  return syncManagedProjectSkill(
    join(plannerRoot, "SKILL.md"),
    await loadCanonicalPlannerSkill(),
    {
      created: "Created the canonical project-local planner skill.",
      current: "The project-local planner skill matches the canonical version.",
      adopted: "Adopted and marked the unmodified canonical planner skill.",
      updated: "Updated the unmodified project-local planner skill to the current canonical version.",
      customized: "Preserved the customized .planner/SKILL.md. Reconcile it manually with the current canonical Agent Plan guide; Agent Plan did not overwrite project instructions.",
    },
  );
}

/** Create or safely refresh `.planner/skills/grill-me/SKILL.md`. */
export async function syncProjectGrillMeSkill(plannerRoot: string): Promise<PlannerSkillSyncResult> {
  return syncManagedProjectSkill(
    join(plannerRoot, "skills", "grill-me", "SKILL.md"),
    await loadCanonicalGrillMeSkill(),
    {
      created: "Created the canonical project-local grill-me skill for Ideas discussions.",
      current: "The project-local grill-me skill matches the canonical version.",
      adopted: "Adopted and marked the unmodified canonical grill-me skill.",
      updated: "Updated the unmodified project-local grill-me skill to the current canonical version.",
      customized: "Preserved the customized .planner/skills/grill-me/SKILL.md. Reconcile it manually with the current canonical Agent Plan skill; Agent Plan did not overwrite project instructions.",
    },
  );
}

/**
 * Load the project-local Ideas discussion skill, safely creating/upgrading the
 * managed copy first. Customized project copies are returned unchanged.
 */
export async function loadProjectGrillMeSkill(plannerRoot: string): Promise<string> {
  return (await syncProjectGrillMeSkill(plannerRoot)).content;
}
