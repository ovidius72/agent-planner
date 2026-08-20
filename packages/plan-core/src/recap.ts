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
  const pausedTasks = allTasks.filter(({ task }) => task.status === "paused");
  const pausedT = pausedTasks.length;
  const pendingDeviation = [...plan.project.workDeviations]
    .filter((deviation) => deviation.state === "resume-required" || deviation.state === "resolved")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .find((deviation) => allTasks.some(({ task }) => task.id === deviation.resumeTaskId
      && (task.status === "paused" || task.status === "planned" || task.status === "waiting")));
  const pendingResume = pendingDeviation
    ? allTasks.find(({ task }) => task.id === pendingDeviation.resumeTaskId)
    : undefined;
  const standalonePaused = pausedTasks
    .filter(({ task }) => task.id !== pendingResume?.task.id)
    .sort((left, right) => (right.task.pauseSnapshot?.pausedAt ?? "").localeCompare(left.task.pauseSnapshot?.pausedAt ?? ""));
  const latestStandalonePaused = standalonePaused[0];

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

  const lines: string[] = [];
  lines.push(italian ? "## Ripresa planner" : "## Planner recap");

  const name = plan.project.name || "(unnamed project)";
  lines.push(`${italian ? "Progetto" : "Project"}: ${name}${plan.project.goal ? " — " + plan.project.goal : ""}`);

  lines.push(
    italian
      ? `Avanzamento: feature ${doneF}/${totalF} completate (${activeF} attive) · fasi ${doneP}/${totalP} completate (${activeP} attive) · task ${doneT}/${totalT} completati (${activeT} attivi, ${pausedT} in pausa)`
      : `Progress: Features ${doneF}/${totalF} done (${activeF} active) · Phases ${doneP}/${totalP} done (${activeP} active) · Tasks ${doneT}/${totalT} done (${activeT} active, ${pausedT} paused)`,
  );

  if (focusTask && focusPhase) {
    const fr = focusFeature ? fref(focusFeature.number) : "?";
    const pr = formatPhaseRef(focusPhase.number, focusFeature?.number);
    const tr = tref(focusTask.task.number);
    lines.push(
      `${italian ? "Focus corrente" : "Current focus"}: ${fr} — ${focusFeature?.name ?? "?"} / ${pr} — ${focusPhase.title} / ${tr} — ${focusTask.task.title} (in-progress)`,
    );
  } else if (pendingResume) {
    const feature = feats.find((entry) => entry.id === pendingResume.phase.featureId);
    const ref = `${formatPhaseRef(pendingResume.phase.number, feature?.number)}/${tref(pendingResume.task.number)}`;
    lines.push(
      `${italian ? "Focus corrente" : "Current focus"}: ${italian ? "ripresa obbligatoria" : "resume required"} — ${ref} — ${pendingResume.task.title} (${pendingResume.task.status})`,
    );
  } else if (latestStandalonePaused) {
    const feature = feats.find((entry) => entry.id === latestStandalonePaused.phase.featureId);
    const ref = `${formatPhaseRef(latestStandalonePaused.phase.number, feature?.number)}/${tref(latestStandalonePaused.task.number)}`;
    lines.push(
      `${italian ? "Focus corrente" : "Current focus"}: ${italian ? "task in pausa da riprendere" : "paused task to resume"} — ${ref} — ${latestStandalonePaused.task.title}`,
    );
  } else if (handoffs.length > 0) {
    const top = handoffs[0]!;
    lines.push(
      `${italian ? "Focus corrente" : "Current focus"}: ${italian ? "nessun task attivo" : "no active task"} · ${italian ? "handoff pendente più recente" : "most recent pending handoff"}: ${top.compositeRef} — "${top.firstLine}"`,
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

  // Next step: the phase handoff (phase.handoff) is the authoritative,
  // actively-managed resume context. When a handoff is pending, point to it
  // instead of surfacing potentially-stale resume.json nextSteps. When no
  // handoff exists, fall back to resume.nextSteps but mark them as possibly
  // stale (free-text that refreshResume never touches, so they can drift).
  if (pendingResume) {
    const feature = feats.find((entry) => entry.id === pendingResume.phase.featureId);
    const ref = `${formatPhaseRef(pendingResume.phase.number, feature?.number)}/${tref(pendingResume.task.number)}`;
    lines.push(
      italian
        ? `Prossimo step: riprendi ${ref} con ${taskStartCmd}. Il checkpoint del task è prioritario rispetto a nuovo lavoro e handoff di fase.`
        : `Next step: resume ${ref} with ${taskStartCmd}. Its task checkpoint takes precedence over new work and phase handoffs.`,
    );
  } else if (latestStandalonePaused) {
    const feature = feats.find((entry) => entry.id === latestStandalonePaused.phase.featureId);
    const ref = `${formatPhaseRef(latestStandalonePaused.phase.number, feature?.number)}/${tref(latestStandalonePaused.task.number)}`;
    lines.push(
      italian
        ? `Prossimo step: riprendi il checkpoint più recente, ${ref}, con ${taskStartCmd}, prima di scegliere nuovo lavoro.`
        : `Next step: resume the newest checkpoint, ${ref}, with ${taskStartCmd} before selecting new work.`,
    );
  } else if (handoffs.length > 0) {
    lines.push(
      italian
        ? `Prossimo step: leggi l'handoff di fase pendente sotto (fonte autorevole, gestita attivamente). I nextSteps legacy di resume.json sono soppressi perché possono essere stale.`
        : `Next step: read the pending phase handoff below (authoritative, actively maintained). Legacy resume.json nextSteps are suppressed because they may be stale.`,
    );
  } else if (!planComplete && resume?.nextSteps?.length) {
    lines.push(`${italian ? "Prossimo step" : "Next step"}: ${resume.nextSteps[0]}`);
    const staleNote = resume.nextStepsUpdatedAt
      ? (italian
        ? `⚠️ nextSteps free-text da resume.json, ultimo aggiornamento ${resume.nextStepsUpdatedAt} — può essere stale; verifica contro lo stato attuale prima di agire.`
        : `⚠️ nextSteps are free-text from resume.json, last updated ${resume.nextStepsUpdatedAt} — may be stale; verify against current state before acting.`)
      : (italian
        ? `⚠️ nextSteps free-text da resume.json — può essere stale; verifica contro lo stato attuale prima di agire.`
        : `⚠️ nextSteps are free-text from resume.json — may be stale; verify against current state before acting.`);
    lines.push(staleNote);
  }

  if (pendingResume) {
    const feature = feats.find((entry) => entry.id === pendingResume.phase.featureId);
    const ref = `${formatPhaseRef(pendingResume.phase.number, feature?.number)}/${tref(pendingResume.task.number)}`;
    const snapshot = pendingResume.task.pauseSnapshot ?? pendingDeviation?.snapshot;
    lines.push(
      "",
      italian ? "## Ripresa task obbligatoria" : "## Task resume required",
      `${ref} — ${pendingResume.task.title}`,
      snapshot ? `${italian ? "Perché è stato sospeso" : "Paused because"}: ${snapshot.reason}` : "",
      snapshot ? `${italian ? "Stato del lavoro" : "Work checkpoint"}: ${snapshot.whatWasBeingDone}` : "",
      snapshot ? `${italian ? "Riprendi da" : "Resume from"}: ${snapshot.resumeLocation}` : "",
      snapshot ? `${italian ? "Come riprendere" : "How to resume"}: ${snapshot.howToResume}` : "",
      `${italian ? "Azione" : "Action"}: ${taskStartCmd} ${ref}`,
    );
  }

  if (standalonePaused.length > 0) {
    lines.push("", italian ? `## Task in pausa (${standalonePaused.length})` : `## Paused tasks (${standalonePaused.length})`);
    for (const entry of standalonePaused) {
      const feature = feats.find((item) => item.id === entry.phase.featureId);
      const ref = `${formatPhaseRef(entry.phase.number, feature?.number)}/${tref(entry.task.number)}`;
      const snapshot = entry.task.pauseSnapshot;
      lines.push(
        `${ref} — ${entry.task.title}`,
        snapshot ? `  ${italian ? "Perché" : "Why"}: ${snapshot.reason}` : "",
        snapshot ? `  ${italian ? "Stato" : "Checkpoint"}: ${snapshot.whatWasBeingDone}` : "",
        snapshot ? `  ${italian ? "Riprendi da" : "Resume from"}: ${snapshot.resumeLocation}` : "",
        snapshot ? `  ${italian ? "Come" : "How"}: ${snapshot.howToResume}` : "",
      );
    }
  }

  if (handoffs.length > 0) {
    const top = handoffs[0]!;
    lines.push(
      "",
      italian ? `## Handoff di fase pendenti (${handoffs.length})` : `## Pending phase handoffs (${handoffs.length})`,
    );
    handoffs.forEach((h, i) => lines.push(`[${i + 1}] ${h.compositeRef} — ${h.updatedAt} — "${h.firstLine}"`));
    if (pendingResume || latestStandalonePaused) {
      lines.push(
        "",
        italian
          ? "→ Questi handoff restano disponibili come contesto, ma prima risolvi il task da riprendere indicato sopra."
          : "→ These handoffs remain available as context, but first resolve the task resume shown above.",
      );
    } else if (handoffs.length === 1) {
      lines.push(
        "",
        italian
          ? `→ Vuoi riprendere da ${top.compositeRef}? Leggi l'handoff con ${handoffShowCmd} ${top.compositeRef} e avvia il primo task pertinente. L'handoff resta attivo finché tutti i task della fase non sono done/canceled, viene sostituito da un nuovo handoff, oppure viene cancellato esplicitamente.`
          : `→ Do you want to resume from ${top.compositeRef}? Read the handoff with ${handoffShowCmd} ${top.compositeRef} and start the first relevant task. It stays active until every phase task is done/canceled, a new handoff replaces it, or it is explicitly cleared.`,
      );
    } else {
      lines.push(
        "",
        italian
          ? `→ Scegli da quale fase ripartire. Il più recente è [1] ${top.compositeRef} — leggilo con ${handoffShowCmd} ${top.compositeRef} e avvia il primo task pertinente. Ogni handoff resta attivo finché tutti i task della fase non sono done/canceled, viene sostituito da un nuovo handoff, oppure viene cancellato esplicitamente.`
          : `→ Choose which phase to resume from. The most recent is [1] ${top.compositeRef} — read it with ${handoffShowCmd} ${top.compositeRef} and start the first relevant task. Each handoff stays active until every phase task is done/canceled, a new handoff replaces it, or it is explicitly cleared.`,
      );
    }
  } else if (planComplete) {
    lines.push(
      "",
      italian
        ? `Piano completo — aggiungi una nuova feature (${featureAddCmd}) o fase (${phaseAddCmd}) per continuare.`
        : `Plan complete — add a new feature (${featureAddCmd}) or phase (${phaseAddCmd}) to continue.`,
    );
  } else if (activeT === 0 && !pendingResume && standalonePaused.length === 0) {
    lines.push(
      "",
      italian
        ? `Nessun handoff pendente e nessun task in-progress. Usa ${taskAddCmd} / ${taskStartCmd} per iniziare.`
        : `No phase handoff pending and no task in-progress. Use ${taskAddCmd} / ${taskStartCmd} to begin work.`,
    );
  }

  lines.push("", italian ? "Pronto a riprendere?" : "Ready to resume?");

  // Keep this as the final line: harnesses such as Codex display MCP results
  // compactly, so callers can preserve the dashboard address verbatim.
  if (web.localUrl) {
    lines.push("", italian ? "## Web UI" : "## Web UI", `🌐 Web UI: ${web.localUrl}${web.lanUrl ? " (LAN: " + web.lanUrl + ")" : ""}${web.port ? " (port " + web.port + ")" : ""}`);
  } else {
    lines.push("", italian ? "## Web UI" : "## Web UI", `🌐 Web UI: ${italian ? "non attiva — avvia con /planner load" : "not running — start with /planner load"}`);
  }
  return lines.join("\n");
}