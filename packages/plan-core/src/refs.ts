/**
 * Harness-agnostic reference resolution for planner entities.
 *
 * Used by adapters (pi-adapter, plan-mcp) and any future harness to resolve a
 * human-facing ref to a concrete entity. Kept in @agent-plan/core so every
 * adapter shares the exact same resolution semantics.
 *
 * Supported phase refs (case-insensitive):
 *   - UUID:   "bd6ed366-..."          -> phase.id
 *   - Short:  "P001" | "p1"          -> phase.number (globally unique)
 *   - Compos: "P002(F001)"           -> phase.number with parent feature validation
 *   - Title:  exact match, then includes (backward-compat fallback)
 */
import type { Phase, Feature } from "./schema.js";

// P00x  or  P00x(F00x)  — accept 1+ digits so "p1" == "p001".
const PHASE_REF_RE = /^p(\d+)(?:\(f(\d+)\))?$/;

/**
 * Resolve a phase reference to a Phase. Returns `undefined` when not found or
 * when a composite (F00x) parent does not match the phase's featureId.
 *
 * @param phases  all phases (st.loadAllPhases())
 * @param features all features (st.loadAllFeatures() / loadFeatures())
 * @param ref     the human-facing ref (P00x / P00x(F00x) / UUID / title)
 */
export function findPhaseByRef(
  phases: Phase[],
  features: Feature[],
  ref: string,
): Phase | undefined {
  const normalized = ref.trim().toLowerCase();
  if (!normalized) return undefined;

  // 1. UUID (exact)
  let found = phases.find((p) => p.id.toLowerCase() === normalized);
  if (found) return found;

  // 2. Composite / short ref: P00x or P00x(F00x)
  const m = normalized.match(PHASE_REF_RE);
  if (m) {
    const phaseNum = parseInt(m[1]!, 10);
    found = phases.find((p) => p.number === phaseNum);
    if (found && m[2]) {
      // validate parent feature when the (F00x) disambiguator is present
      const featureNum = parseInt(m[2], 10);
      const feat = features.find((f) => f.number === featureNum);
      if (!feat || found.featureId !== feat.id) return undefined;
    }
    if (found) return found;
  }

  // 3. Title fallback (backward compatibility with agents using titles)
  return (
    phases.find((p) => p.title.toLowerCase() === normalized) ??
    phases.find((p) => p.title.toLowerCase().includes(normalized))
  );
}