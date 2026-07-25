import type { PlanStore } from "./plan-store.js";
import { formatPhaseRef, formatTwoDigitNumber } from "./naming.js";

/**
 * Web UI info for the recap (harness-agnostic — no module globals).
 * Pass { localUrl, lanUrl, port } from whichever harness runs the server.
 * Omit/empty → the recap notes the dashboard is not running.
 */
export interface RecapWebInfo {
  localUrl?: string | undefined;
  lanUrl?: string | undefined;
  port?: number | undefined;
}

/** Which harness is presenting the recap — drives command-name hints. */
export type RecapHarness = "pi" | "mcp";

export interface RecapOptions {
  harness?: RecapHarness;
}

const fref = (n: number) => `F${formatTwoDigitNumber(n)}`;
const tref = (n: number) => `T${formatTwoDigitNumber(n)}`;

/**
 * Build a consolidated planner recap (project state + active focus + pending
 * handoffs + web URL). SHARED across all harnesses (Pi command, Pi tool,
 * Claude Code/Codex MCP) so every adapter presents identical content.
 *
 * English by default; Italian if project.chatLanguage is set to Italian.
 * Uses human-readable names/titles plus composite IDs (F00x / P00x(F00x) / T00x)
 * so the user/agent can reference entities unambiguously.
 *
 * Pass opts.harness to get harness-correct command hints in the actionable
 * lines (e.g. "/planner task start" in Pi vs "planner-task-start" in MCP).
 * When the plan is fully complete, stale resume.nextSteps are suppressed and a
 * "plan complete — add a feature/phase to continue" hint is shown instead.
 */
export async function buildRecap(st: PlanStore, web: RecapWebInfo = {}, opts: RecapOptions = {}): Promise<string> {
  const [plan, resume, handoffs] = await Promise.all([
    st.loadAll(),
    st.loadResume().catch(() => null),
    st.listHandoffs(),
  ]);

  const feats = plan.features.features;
  const phases = plan.phases;
  const allTasks = phases.flatMap((p) => p.tasks.map((task) => ({ phase: p, task })));

  const totalF = feats.length;
  const doneF = feats.filter((x) => x.status === "done").length;
  const activeF = feats.filter((x) => x.status === "in-progress").length;
  const totalP = phases.length;
  const doneP = phases.filter((x) => x.status === "done").length;
  const activeP = phases.filter((x) => x.status === "in-progress" || x.status === "discovery").length;
  const totalT = allTasks.length;
  const doneT = allTasks.filter(({ task }) => task.status === "done").length;
  const activeT = allTasks.filter(({ task }) => task.status === "in-progress").length;

  // Plan is fully complete: there is work and all of it is done, nothing active.
  // (totalT > 0 guards the empty/unstarted case from looking "complete".)
  const planComplete = totalT > 0 && doneT === totalT && doneP === totalP && doneF === totalF;

  // Current focus = first in-progress task (and its phase/feature).
  const focusTask = allTasks.find(({ task }) => task.status === "in-progress");
  const focusPhase = focusTask?.phase;
  const focusFeature = focusPhase ? feats.find((x) => x.id === focusPhase.featureId) : undefined;

  const italian = (plan.project.chatLanguage || "").toLowerCase().includes("ital");

  // Harness-aware command names for actionable hints.
  const isPi = opts.harness === "pi";
  const cmd = (piCmd: string, mcpCmd: string) => (isPi ? piCmd : mcpCmd);
  const taskAddCmd = cmd("/planner task add", "planner-task-add");
  const taskStartCmd = cmd("/planner task start", "planner-task-start");
  const featureAddCmd = cmd("/planner feature add", "planner-feature-add");
  const phaseAddCmd = cmd("/planner phase add", "planner-phase-add");
  const handoffShowCmd = cmd("/planner handoff show", "planner-handoff-show");
  const handoffClearCmd = cmd("/planner handoff clear", "planner-handoff-clear");

  const lines: string[] = [];
  lines.push(italian ? "## Ripresa planner" : "## Planner recap");

  const name = plan.project.name || "(unnamed project)";
  lines.push(`${italian ? "Progetto" : "Project"}: ${name}${plan.project.goal ? " — " + plan.project.goal : ""}`);

  lines.push(
    italian
      ? `Avanzamento: feature ${doneF}/${totalF} completate (${activeF} attive) · fasi ${doneP}/${totalP} completate (${activeP} attive) · task ${doneT}/${totalT} completati (${activeT} attivi)`
      : `Progress: Features ${doneF}/${totalF} done (${activeF} active) · Phases ${doneP}/${totalP} done (${activeP} active) · Tasks ${doneT}/${totalT} done (${activeT} active)`,
  );

  if (focusTask && focusPhase) {
    const fr = focusFeature ? fref(focusFeature.number) : "?";
    const pr = formatPhaseRef(focusPhase.number, focusFeature?.number);
    const tr = tref(focusTask.task.number);
    lines.push(
      `${italian ? "Focus corrente" : "Current focus"}: ${fr} — ${focusFeature?.name ?? "?"} / ${pr} — ${focusPhase.title} / ${tr} — ${focusTask.task.title} (in-progress)`,
    );
  } else if (planComplete) {
    lines.push(
      italian
        ? "Focus corrente: piano completo — tutte le feature/fasi/task sono concluse."
        : "Current focus: plan complete — all features/phases/tasks are done.",
    );
  } else {
    lines.push(`${italian ? "Focus corrente" : "Current focus"}: ${italian ? "nessun task attivo — rivedi il piano e scegli il prossimo task concreto" : "no active task — review the plan and pick the next concrete task"}`);
  }

  // Next step: only surface resume.nextSteps when the plan is NOT complete —
  // otherwise stale init-time steps (e.g. "bootstrap discovery") leak through
  // and contradict an all-done plan.
  if (!planComplete && resume?.nextSteps?.length) {
    lines.push(`${italian ? "Prossimo step" : "Next step"}: ${resume.nextSteps[0]}`);
  }

  if (handoffs.length > 0) {
    lines.push("", italian ? `## Handoff di fase pendenti (${handoffs.length})` : `## Pending phase handoffs (${handoffs.length})`);
    handoffs.forEach((h, i) => lines.push(`[${i + 1}] ${h.compositeRef} — ${h.updatedAt} — "${h.firstLine}"`));
    lines.push(
      "",
      italian
        ? `→ Leggi quello pertinente con ${handoffShowCmd} <ref> (valida contro lo stato attuale), poi ${handoffClearCmd} <ref> una volta consumato.`
        : `→ Read the relevant one with ${handoffShowCmd} <ref> (validate against current state), then call ${handoffClearCmd} <ref> once consumed (delete-on-resume).`,
    );
  } else if (planComplete) {
    lines.push(
      "",
      italian
        ? `Piano completo — aggiungi una nuova feature (${featureAddCmd}) o fase (${phaseAddCmd}) per continuare.`
        : `Plan complete — add a new feature (${featureAddCmd}) or phase (${phaseAddCmd}) to continue.`,
    );
  } else if (activeT === 0) {
    lines.push(
      "",
      italian
        ? `Nessun handoff pendente e nessun task in-progress. Usa ${taskAddCmd} / ${taskStartCmd} per iniziare.`
        : `No phase handoff pending and no task in-progress. Use ${taskAddCmd} / ${taskStartCmd} to begin work.`,
    );
  }

  if (web.localUrl) {
    lines.push("", italian ? "## Web UI" : "## Web UI", `🌐 Web UI: ${web.localUrl}${web.lanUrl ? " (LAN: " + web.lanUrl + ")" : ""}${web.port ? " (port " + web.port + ")" : ""}`);
  } else {
    lines.push("", italian ? "## Web UI" : "## Web UI", `🌐 Web UI: ${italian ? "non attiva — avvia con /planner load" : "not running — start with /planner load"}`);
  }

  lines.push("", italian ? "Vuoi che riprendiamo da qui?" : "Do you want to resume from here?");
  return lines.join("\n");
}