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
import type { Phase, Feature, Idea } from "./schema.js";

// P00x  or  P00x(F00x)  — accept 1+ digits so "p1" == "p001".
const PHASE_REF_RE = /^p(\d+)(?:\(f(\d+)\))?$/;
const IDEA_REF_RE = /^i(\d+)$/;

/**
 * Resolve an idea by UUID, I00x number, shortId, exact title, then title
 * inclusion. Ideas are top-level and never require feature/phase context.
 */
export function findIdeaByRef(ideas: Idea[], ref: string): Idea | undefined {
  const normalized = ref.trim().toLowerCase();
  if (!normalized) return undefined;

  const byId = ideas.find((idea) => idea.id.toLowerCase() === normalized);
  if (byId) return byId;

  const match = normalized.match(IDEA_REF_RE);
  if (match) {
    const number = parseInt(match[1]!, 10);
    const byNumber = ideas.find((idea) => idea.number === number);
    if (byNumber) return byNumber;
  }

  const byShortId = ideas.find((idea) => idea.shortId.toLowerCase() === normalized);
  if (byShortId) return byShortId;

  return ideas.find((idea) => idea.title.toLowerCase() === normalized)
    ?? ideas.find((idea) => idea.title.toLowerCase().includes(normalized));
}

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

  // 3. ShortId
  found = phases.find((p) => p.shortId && p.shortId.toLowerCase() === normalized);
  if (found) return found;

  // 4. Title fallback (backward compatibility with agents using titles)
  // 5. Title fallback (backward compatibility with agents using titles)
  return (
    phases.find((p) => p.title.toLowerCase() === normalized) ??
    phases.find((p) => p.title.toLowerCase().includes(normalized))
  );
}
/**
 * Resolve a task reference to { phase, task }. Harness-agnostic, shared by all
 * adapters so resolution semantics are identical everywhere.
 *
 * Supported task refs (case-insensitive):
 *   - UUID:     "bd6ed366-..."            -> task.id
 *   - Short:    "T003" | "t3"             -> task.number (GLOBALLY unique under the
 *                                           new global-sequence numbering; bare T00x
 *                                           is unambiguous across all phases)
 *   - Compos:   "F001/P002/T003"          -> feature/phase/task numbers with parent
 *                "P002(F001)/T003"          validation (feature + phase must match)
 *                "P002/T003"
 *   - ShortId:  "UUXD1"                   -> task.shortId (5-char, globally unique)
 *   - Title:    exact match, then includes (backward-compat fallback)
 *
 * Returns `undefined` when not found, or when a composite parent (phase/feature)
 * does not match the resolved task's parent.
 */
import type { Task } from "./schema.js";

// Extract optional feature/phase/task numbers from a composite ref.
// Accepts 1+ digits so "t3" == "t003". Numbers are GLOBAL (post-migration).
function parseTaskComposite(ref: string): { featureNum?: number | undefined; phaseNum?: number | undefined; taskNum?: number | undefined } {
  // Anchored patterns only: composite refs (F00x/P00x/T00x, P00x(F00x)/T00x,
  // P00x/T00x) and bare T00x. A 5-char shortId (e.g. "HT23X") or a title never
  // matches these because they are anchored to the WHOLE string.
  const composite = ref.match(/^f0*(\d+)\/p0*(\d+)\/t0*(\d+)$/);
  if (composite) return { featureNum: parseInt(composite[1]!, 10), phaseNum: parseInt(composite[2]!, 10), taskNum: parseInt(composite[3]!, 10) };
  const phaseTask = ref.match(/^p0*(\d+)(?:\(f0*(\d+)\))?\/t0*(\d+)$/);
  if (phaseTask) return { phaseNum: parseInt(phaseTask[1]!, 10), featureNum: phaseTask[2] ? parseInt(phaseTask[2], 10) : undefined, taskNum: parseInt(phaseTask[3]!, 10) };
  const bare = ref.match(/^t0*(\d+)$/);
  if (bare) return { taskNum: parseInt(bare[1]!, 10) };
  return {};
}

export function findTaskByRef(
  phases: Phase[],
  features: Feature[],
  ref: string,
): { phase: Phase; task: Task } | undefined {
  const normalized = ref.trim().toLowerCase();
  if (!normalized) return undefined;

  // 1. UUID (exact)
  for (const phase of phases) {
    const task = phase.tasks.find((t) => t.id.toLowerCase() === normalized);
    if (task) return { phase, task };
  }

  // 1b. ShortId (5-char) — check BEFORE composite so a shortId like "HT23X"
  // or "T1234" is never misread as a numeric task ref (regexes are anchored now,
  // but a 5-char ref can still look numeric). SHORT_ID_LENGTH is always 5.
  if (normalized.length === 5) {
    for (const phase of phases) {
      const task = phase.tasks.find((t) => t.shortId && t.shortId.toLowerCase() === normalized);
      if (task) return { phase, task };
    }
  }

  // 2. Composite / short ref with a T segment
  const { featureNum, phaseNum, taskNum } = parseTaskComposite(normalized);
  if (taskNum !== undefined) {
    if (phaseNum !== undefined) {
      // Composite: validate phase (and feature if present), then resolve task by number.
      const phase = phases.find((p) => p.number === phaseNum);
      if (!phase) return undefined;
      if (featureNum !== undefined) {
        const feat = features.find((f) => f.number === featureNum);
        if (!feat || phase.featureId !== feat.id) return undefined;
      }
      const task = phase.tasks.find((t) => t.number === taskNum);
      if (task) return { phase, task };
      return undefined;
    }
    // Bare T00x — globally unique under the new numbering. Find the one task.
    for (const phase of phases) {
      const task = phase.tasks.find((t) => t.number === taskNum);
      if (task) return { phase, task };
    }
  }

  // 3. ShortId (5-char)
  for (const phase of phases) {
    const task = phase.tasks.find((t) => t.shortId && t.shortId.toLowerCase() === normalized);
    if (task) return { phase, task };
  }

  // 4. Title fallback (backward compatibility)
  for (const phase of phases) {
    const exact = phase.tasks.find((t) => t.title.toLowerCase() === normalized);
    if (exact) return { phase, task: exact };
  }
  for (const phase of phases) {
    const incl = phase.tasks.find((t) => t.title.toLowerCase().includes(normalized));
    if (incl) return { phase, task: incl };
  }

  return undefined;
}
