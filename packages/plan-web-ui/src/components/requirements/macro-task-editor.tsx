import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { requirementStatuses } from "../../lib/statuses";
import type { MacroTaskInput } from "../../lib/api";

type MacroTaskDraft = MacroTaskInput & { key: string };

function draftFrom(input: MacroTaskInput, index: number): MacroTaskDraft {
  return {
    ...input,
    key: input.id ?? `new-${index}`,
  };
}

function blankDraft(index: number): MacroTaskDraft {
  return {
    key: `new-${index}`,
    title: "",
    description: "",
    status: "planned",
  };
}

export function MacroTaskEditor({ initialTasks }: { initialTasks: MacroTaskInput[] }) {
  const [tasks, setTasks] = useState<MacroTaskDraft[]>(() => initialTasks.map(draftFrom));
  const payload = tasks.map(({ key: _key, ...task }) => task);

  function update(index: number, patch: Partial<MacroTaskInput>) {
    setTasks((current) => current.map((task, taskIndex) => taskIndex === index ? { ...task, ...patch } : task));
  }

  function move(index: number, direction: -1 | 1) {
    setTasks((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function remove(index: number) {
    setTasks((current) => current.filter((_, taskIndex) => taskIndex !== index));
  }

  function add() {
    setTasks((current) => [...current, blankDraft(current.length)]);
  }

  return (
    <fieldset className="grid gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
      <legend className="px-1 text-sm font-semibold text-[var(--text-muted)]">Macro tasks</legend>
      <input type="hidden" name="macroTasks" value={JSON.stringify(payload)} />
      <p className="text-sm text-[var(--text-muted)]">Define the nested outcomes this requirement owns. Their identifiers and timestamps are assigned by the planner.</p>
      {tasks.length === 0 ? <p className="text-sm text-[var(--text-subtle)]">No macro tasks yet.</p> : null}
      <div className="grid gap-4">
        {tasks.map((task, index) => (
          <fieldset key={task.key} className="grid gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface-card)] p-3">
            <legend className="px-1 text-sm font-semibold text-[var(--text)]">Macro task {index + 1}</legend>
            <label className="grid gap-2 text-sm font-semibold text-[var(--text-muted)]">
              <span>Title</span>
              <Input aria-label={`Macro task ${index + 1} title`} value={task.title} onChange={(event) => update(index, { title: event.target.value })} required />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-[var(--text-muted)]">
              <span>Description</span>
              <Textarea aria-label={`Macro task ${index + 1} description`} value={task.description} onChange={(event) => update(index, { description: event.target.value })} />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-[var(--text-muted)]">
              <span>Status</span>
              <Select aria-label={`Macro task ${index + 1} status`} value={task.status} onChange={(event) => update(index, { status: event.target.value as MacroTaskInput["status"] })}>
                {requirementStatuses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Select>
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move macro task ${index + 1} up`}>Move up</Button>
              <Button type="button" variant="ghost" onClick={() => move(index, 1)} disabled={index === tasks.length - 1} aria-label={`Move macro task ${index + 1} down`}>Move down</Button>
              <Button type="button" variant="danger" onClick={() => remove(index)} aria-label={`Remove macro task ${index + 1}`}>Remove</Button>
            </div>
          </fieldset>
        ))}
      </div>
      <div><Button type="button" onClick={add}>Add macro task</Button></div>
    </fieldset>
  );
}
