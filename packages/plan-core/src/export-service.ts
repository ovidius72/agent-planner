import type { Feature, Phase, PlanWorkspace, Task } from "./schema.js";
import { statusBadge, statusIcon } from "./render-utils.js";

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function doneCount<T extends { status: string }>(items: T[]): number {
  return items.filter((item) => item.status === "done").length;
}

function taskProgress(tasks: Task[]): string {
  return `${doneCount(tasks)} / ${tasks.length}`;
}

export class ExportService {
  exportToMarkdown(plan: PlanWorkspace, full = false): string {
    const { project, features, phases } = plan;
    const lines: string[] = [];

    lines.push(`# ${escapeTableCell(project.name)}`);
    lines.push("");
    if (project.description) {
      lines.push(project.description);
      lines.push("");
    }

    lines.push("## Riepilogo Features");
    lines.push("");
    lines.push("| Feature | Fasi (Fatte/Totali) | Task (Fatti/Totali) | Stato |");
    lines.push("| :--- | :---: | :---: | :--- |");

    if (features.features.length === 0) {
      lines.push("| _Nessuna feature_ | 0 / 0 | 0 / 0 | - |");
    }

    for (const feature of features.features) {
      const featurePhases = this.phasesForFeature(feature, phases);
      const featureTasks = featurePhases.flatMap((phase) => phase.tasks);
      lines.push(`| ${escapeTableCell(feature.name)} | ${doneCount(featurePhases)} / ${featurePhases.length} | ${taskProgress(featureTasks)} | ${statusBadge(feature.status)} |`);
    }
    lines.push("");

    const allTasks = phases.flatMap((phase) => phase.tasks);
    const completedTasks = doneCount(allTasks);
    const progress = allTasks.length > 0 ? Math.round((completedTasks / allTasks.length) * 100) : 0;
    const globalStatus = this.deriveGlobalStatus(phases);

    lines.push("## Recap Stato Attività");
    lines.push("");
    lines.push(`- **Stato Globale**: ${statusBadge(globalStatus)}`);
    lines.push(`- **Progresso Totale**: ${progress}% (${completedTasks} / ${allTasks.length} task completati)`);
    lines.push(`- **Sintesi**: ${this.generateSynthesis(progress, allTasks.length)}`);
    lines.push("");

    if (!full) return lines.join("\n");

    lines.push("---");
    lines.push("");
    lines.push("# Dettaglio Operativo");
    lines.push("");

    for (const feature of features.features) {
      lines.push(`## Dettaglio Feature: ${escapeTableCell(feature.name)} (${statusBadge(feature.status)})`);
      lines.push("");

      const featurePhases = this.phasesForFeature(feature, phases);
      lines.push("| Livello | Elemento | Stato | Info/Progresso |");
      lines.push("| :--- | :--- | :---: | :--- |");

      if (featurePhases.length === 0) {
        lines.push("| _Nessuna fase_ | - | - | - |");
      }

      for (const phase of featurePhases) {
        lines.push(`| ${statusIcon(phase.status)} **Fase** | **${escapeTableCell(phase.title)}** | ${statusBadge(phase.status)} | ${taskProgress(phase.tasks)} Task |`);
        for (const task of phase.tasks) {
          lines.push(`| └─ Task | ${escapeTableCell(task.title)} | ${statusBadge(task.status)} | |`);
        }
      }
      lines.push("");
    }

    const featurePhaseIds = new Set(features.features.flatMap((feature) => this.phasesForFeature(feature, phases).map((phase) => phase.id)));
    const orphanPhases = phases.filter((phase) => !featurePhaseIds.has(phase.id));
    if (orphanPhases.length > 0) {
      lines.push("## Fasi senza feature");
      lines.push("");
      lines.push("| Livello | Elemento | Stato | Info/Progresso |");
      lines.push("| :--- | :--- | :---: | :--- |");
      for (const phase of orphanPhases) {
        lines.push(`| ${statusIcon(phase.status)} **Fase** | **${escapeTableCell(phase.title)}** | ${statusBadge(phase.status)} | ${taskProgress(phase.tasks)} Task |`);
        for (const task of phase.tasks) {
          lines.push(`| └─ Task | ${escapeTableCell(task.title)} | ${statusBadge(task.status)} | |`);
        }
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  private phasesForFeature(feature: Feature, phases: Phase[]): Phase[] {
    const byId = new Map(phases.map((phase) => [phase.id, phase]));
    const ordered = feature.phaseIds.map((id) => byId.get(id)).filter((phase): phase is Phase => Boolean(phase));
    const orderedIds = new Set(ordered.map((phase) => phase.id));
    const inferred = phases.filter((phase) => phase.featureId === feature.id && !orderedIds.has(phase.id));
    return [...ordered, ...inferred];
  }

  private deriveGlobalStatus(phases: Phase[]): string {
    const allTasks = phases.flatMap((phase) => phase.tasks);
    if (allTasks.length === 0) return "planned";
    if (allTasks.every((task) => task.status === "done")) return "done";
    if (allTasks.some((task) => task.status === "in-progress")) return "in-progress";
    if (allTasks.some((task) => task.status === "blocked")) return "blocked";
    return "planned";
  }

  private generateSynthesis(progress: number, totalTasks: number): string {
    if (totalTasks === 0) return "Il progetto è appena stato inizializzato. Non ci sono task definiti.";
    if (progress === 100) return "Il progetto è completato. Tutte le feature e i task sono stati chiusi.";
    if (progress > 75) return `Il progetto è in fase di chiusura (${progress}%). Mancano gli ultimi dettagli.`;
    if (progress > 25) return `Il progetto è in fase di implementazione attiva (${progress}%).`;
    return `Il progetto è nelle fasi iniziali di setup e pianificazione (${progress}%).`;
  }
}
