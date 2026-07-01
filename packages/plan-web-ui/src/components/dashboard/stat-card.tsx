import type { ReactNode } from "react";
import { Card } from "../ui/card";

export function StatCard({ title, value, valueSuffix, subtitle, icon, valueClassName, iconClassName }: { title: string; value: string; valueSuffix?: string; subtitle: ReactNode; icon: ReactNode; valueClassName?: string; iconClassName?: string }) {
  return (
    <Card className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">{title}</p>
        <div className="mt-2 flex items-end gap-2">
          <p className={`text-3xl font-black tracking-tight ${valueClassName ?? "text-[var(--text)]"}`}>{value}</p>
          {valueSuffix ? <span className="pb-1 text-sm font-semibold text-[var(--text-muted)]">{valueSuffix}</span> : null}
        </div>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{subtitle}</p>
      </div>
      <div className={`surface-card flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--accent-soft)] ${iconClassName ?? "text-[var(--accent)]"}`}>
        {icon}
      </div>
    </Card>
  );
}
