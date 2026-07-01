import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { ShortcutTarget } from "../../lib/shortcuts";
import { ShortcutHint } from "./shortcut-hint";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variantClass: Record<Variant, string> = {
  primary: "border-transparent bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]",
  secondary: "border-[var(--border-strong)] bg-[var(--surface-elevated)] text-[var(--text)] hover:bg-[var(--accent-soft)] hover:text-[var(--text)]",
  ghost: "border-transparent bg-transparent text-[var(--text-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--text)]",
  danger: "border-transparent bg-[var(--danger-soft)] text-[var(--color-status-blocked)] hover:bg-[color-mix(in_srgb,var(--danger-soft)_88%,black_12%)]",
};

export function Button({ variant = "secondary", className = "", children, shortcut, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; children: ReactNode; shortcut?: ShortcutTarget }) {
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-[14px] border px-4 py-2 text-sm font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60 ${variantClass[variant]} ${className}`}
      {...props}
    >
      <span>{children}</span>
      {shortcut ? <ShortcutHint shortcut={shortcut} /> : null}
    </button>
  );
}
