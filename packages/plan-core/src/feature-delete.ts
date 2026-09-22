/**
 * Delete a feature the same way from every surface — MCP, the pi adapter's
 * tool and interactive paths, and the REST server. Before this task each of
 * those four wrote its own delete, and two of them cleared the feature
 * record and never touched its phases: the phases were left pointing at a
 * featureId that no longer existed anywhere — an orphan, not a link. Per
 * AGENTS.md rule 4, "also unlink the phases" is not a rule a caller should
 * have to remember; it lives here once and every caller gets it whether it
 * asked for it or not.
 *
 * Cascade semantics (must match exactly — do not "simplify" to one
 * behaviour): `cascade: true` deletes the feature's phases outright (phase
 * deletion already archives their handoffs; this does not reimplement
 * that). `cascade: false` unlinks each phase (clears `featureId`) and
 * leaves it alive — the phase still exists with its tasks, it just no
 * longer belongs to a feature.
 *
 * The delete is verified, not assumed: after writing, the feature list is
 * read back from disk and the id must actually be gone. Reporting success
 * without checking is the same defect class as T413.
 */
import type { PlanStore } from "./plan-store.js";
import { formatFeatureRef } from "./naming.js";

export interface DeleteFeatureCascadeOptions {
  /** true deletes the feature's phases; false unlinks them and leaves them alive. */
  cascade: boolean;
}

/** One phase's fate, for callers (the REST server's WS broadcast, in
 * particular) that need to say what happened to each affected phase. */
export interface DeleteFeatureCascadePhase {
  id: string;
  action: "deleted" | "unlinked";
}

export interface DeleteFeatureCascadeResult {
  /** Canonical F00x ref — never the caller's raw input. */
  ref: string;
  id: string;
  name: string;
  cascade: boolean;
  phaseCount: number;
  phases: DeleteFeatureCascadePhase[];
}

export type DeleteFeatureCascadeErrorCode = "FEATURE_NOT_FOUND" | "FEATURE_DELETE_NOT_PERSISTED";

export type DeleteFeatureCascadeOutcome =
  | { ok: true; result: DeleteFeatureCascadeResult }
  | { ok: false; errorCode: DeleteFeatureCascadeErrorCode; error: string };

/**
 * Delete the feature identified by the already-resolved `featureId` (a
 * canonical UUID — turning a caller's fuzzy ref like "checkout" or "F5"
 * into that id is the caller's job, same as every other mutation in this
 * codebase; resolveFeatureRefStrict does that today). The feature is
 * re-read fresh, inside the write lock, immediately before the mutation —
 * not trusted from whatever the caller resolved earlier — so a feature
 * that another process deleted between the caller's resolve and this call
 * fails loudly (FEATURE_NOT_FOUND) instead of reporting a phantom success.
 */
export async function deleteFeatureCascade(
  store: PlanStore,
  featureId: string,
  options: DeleteFeatureCascadeOptions,
): Promise<DeleteFeatureCascadeOutcome> {
  return store.runBatch(async (): Promise<DeleteFeatureCascadeOutcome> => {
    const features = (await store.loadFeatures()).features;
    const feature = features.find((entry) => entry.id === featureId);
    if (!feature) {
      return { ok: false, errorCode: "FEATURE_NOT_FOUND", error: `Feature not found: ${featureId}` };
    }
    const ref = formatFeatureRef(feature.number);
    const phases = (await store.loadAllPhases()).filter((phase) => phase.featureId === feature.id);

    await store.updateFeatures((doc) => {
      doc.features = doc.features.filter((entry) => entry.id !== feature.id);
      return doc;
    });

    const phaseResults: DeleteFeatureCascadePhase[] = [];
    for (const phase of phases) {
      if (options.cascade) {
        await store.deletePhase(phase.id);
        phaseResults.push({ id: phase.id, action: "deleted" });
      } else {
        await store.updatePhase(phase.id, (current) => ({ ...current, featureId: undefined, updatedAt: new Date().toISOString() }));
        phaseResults.push({ id: phase.id, action: "unlinked" });
      }
    }

    await store.writeGenerated();

    // Prove it happened: the feature must actually be gone from a fresh
    // disk read, not merely filtered out of an in-memory copy that a
    // subsequent write silently dropped.
    const stillPresent = (await store.loadFeatures()).features.some((entry) => entry.id === feature.id);
    if (stillPresent) {
      return { ok: false, errorCode: "FEATURE_DELETE_NOT_PERSISTED", error: `Feature delete did not persist: ${ref}` };
    }

    return {
      ok: true,
      result: { ref, id: feature.id, name: feature.name, cascade: options.cascade, phaseCount: phaseResults.length, phases: phaseResults },
    };
  });
}
