import { createContext, createElement, useContext, useEffect } from "react";
import type { ReactNode } from "react";

export interface ShortcutSpec {
  key: string;
  primary?: boolean;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export type ShortcutAction = "create" | "edit" | "delete" | "submit";
export type ShortcutTarget = ShortcutAction | ShortcutSpec;

export const defaultShortcuts: Record<ShortcutAction, ShortcutSpec> = {
  create: { key: "n", meta: true, ctrl: true },
  edit: { key: "e", meta: true, ctrl: true },
  delete: { key: "d", meta: true, ctrl: true },
  submit: { key: "Enter", primary: true },
};

const ShortcutContext = createContext<Record<ShortcutAction, ShortcutSpec>>(defaultShortcuts);

function isMac() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

function isShortcutSpec(value: ShortcutTarget): value is ShortcutSpec {
  return typeof value !== "string";
}

export function mergeShortcuts(overrides?: Partial<Record<ShortcutAction, ShortcutSpec>> | undefined) {
  return {
    create: overrides?.create ?? defaultShortcuts.create,
    edit: overrides?.edit ?? defaultShortcuts.edit,
    delete: overrides?.delete ?? defaultShortcuts.delete,
    submit: overrides?.submit ?? defaultShortcuts.submit,
  };
}

export function formatShortcut(spec: ShortcutSpec) {
  const parts: string[] = [];
  const mac = isMac();

  if (spec.primary) parts.push(mac ? "⌘" : "Ctrl");
  if (spec.meta) parts.push(mac ? "⌘" : "Meta");
  if (spec.ctrl) parts.push(mac ? "⌃" : "Ctrl");
  if (spec.shift) parts.push(mac ? "⇧" : "Shift");
  if (spec.alt) parts.push(mac ? "⌥" : "Alt");

  const key = spec.key === "Backspace"
    ? (mac ? "⌫" : "Backspace")
    : spec.key === "Enter"
      ? (mac ? "↩" : "Enter")
      : spec.key.length === 1
        ? spec.key.toUpperCase()
        : spec.key;

  parts.push(key);
  return mac ? parts.join("") : parts.join("+");
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function matchesShortcut(event: KeyboardEvent, spec: ShortcutSpec) {
  const normalizedKey = spec.key.length === 1 ? spec.key.toLowerCase() : spec.key;
  const eventKey = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const mac = isMac();
  const expectMeta = spec.meta ?? (spec.primary ? mac : false);
  const expectCtrl = spec.ctrl ?? (spec.primary ? !mac : false);

  return eventKey === normalizedKey
    && (!!expectMeta === event.metaKey)
    && (!!expectCtrl === event.ctrlKey)
    && (!!spec.shift === event.shiftKey)
    && (!!spec.alt === event.altKey);
}

export function ShortcutProvider({ shortcuts, children }: { shortcuts?: Partial<Record<ShortcutAction, ShortcutSpec>> | undefined; children: ReactNode }) {
  return createElement(ShortcutContext.Provider, { value: mergeShortcuts(shortcuts) }, children);
}

export function useResolvedShortcut(target: ShortcutTarget | undefined) {
  const shortcuts = useContext(ShortcutContext);
  if (!target) return undefined;
  return isShortcutSpec(target) ? target : shortcuts[target];
}

export function useShortcut(target: ShortcutTarget, handler: () => void, options?: { allowInEditable?: boolean; enabled?: boolean }) {
  const spec = useResolvedShortcut(target);

  useEffect(() => {
    if (!spec || options?.enabled === false) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!options?.allowInEditable && isEditableTarget(event.target)) return;
      if (!matchesShortcut(event, spec)) return;
      event.preventDefault();
      handler();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handler, options?.allowInEditable, options?.enabled, spec]);
}
