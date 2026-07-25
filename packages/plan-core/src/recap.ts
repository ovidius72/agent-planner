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
 */
export async function buildRecap(st: PlanStore, web: RecapWebInfo = {}): Promise<string> {
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

  // Current focus = first in-progress task (and its phase/feature).
  const focusTask = allTasks.find(({ task }) => task.status === "in-progress");
  const focusPhase = focusTask?.phase;
  const focusFeature = focusPhase ? feats.find((x) => x.id === focusPhase.featureId) : undefined;

  const italian = (plan.project.chatLanguage || "").toLowerCase().includes("ital");

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
  } else {
    lines.push(`${italian ? "Focus corrente" : "Current focus"}: ${italian ? "nessun task attivo — rivedi il piano e scegli il prossimo task concreto" : "no active task — review the plan and pick the next concrete task"}`);
  }

  if (resume?.nextSteps?.length) {
    lines.push(`${italian ? "Prossimo step" : "Next step"}: ${resume.nextSteps[0]}`);
  }

  if (handoffs.length > 0) {
    lines.push("", italian ? `## Handoff di fase pendenti (${handoffs.length})` : `## Pending phase handoffs (${handoffs.length})`);
    handoffs.forEach((h, i) => lines.push(`[${i + 1}] ${h.compositeRef} — ${h.updatedAt} — "${h.firstLine}"`));
    lines.push(
      "",
      italian
        ? "→ Leggi quello pertinente con planner-handoff-show <ref> (valida contro lo stato attuale), poi planner-handoff-clear <ref> una volta consumato."
        : "→ Read the relevant one with planner-handoff-show <ref> (validate against current state), then call planner-handoff-clear <ref> once consumed (delete-on-resume).",
    );
  } else if (activeT === 0) {
    lines.push("", italian ? "Nessun handoff pendente e nessun task in-progress. Usa planner-task-add / planner-task-start per iniziare." : "No phase handoff pending and no task in-progress. Use planner-task-add / planner-task-start to begin work.");
  }

  if (web.localUrl) {
    lines.push("", italian ? "## Web UI" : "## Web UI", `🌐 Web UI: ${web.localUrl}${web.lanUrl ? " (LAN: " + web.lanUrl + ")" : ""}${web.port ? " (port " + web.port + ")" : ""}`);
  } else {
    lines.push("", italian ? "## Web UI" : "## Web UI", `🌐 Web UI: ${italian ? "non attiva — avvia con /planner load" : "not running — start with /planner load"}`);
  }

  lines.push("", italian ? "Vuoi che riprendiamo da qui?" : "Do you want to resume from here?");
  return lines.join("\n");
}