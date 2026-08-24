import { FocusTaskRow } from "../layout/app-shell";
import type { FocusTaskSummary } from "../../lib/api";

/**
 * Lists the tasks that require resuming (paused / pending-resume) in a
 * dedicated section placed before the work tree on the dashboard. The header
 * stays slim by showing only in-progress tasks; the checkpoint reason and full
 * description are intentionally omitted here (they live in the task detail
 * view) so this section is a compact, scannable list.
 */
export function ResumeRequiredSection({ tasks }: { tasks: FocusTaskSummary[] }) {
  if (!tasks.length) return null;
  return (
    <section
      aria-labelledby="resume-required-heading"
      className="grid grid-cols-1 gap-3"
    >
      <h2
        id="resume-required-heading"
        className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--accent)]"
      >
        Resume required ({tasks.length})
      </h2>
      <div className="grid gap-2">
        {tasks.map((task) => (
          <FocusTaskRow key={task.id} task={task} />
        ))}
      </div>
    </section>
  );
}
