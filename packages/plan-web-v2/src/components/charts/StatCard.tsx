import type { ReactNode } from "react";
import { Card } from "../ui/Card";

interface StatCardProps {
  title: string;
  value: string;
  sub?: string;
  icon: ReactNode;
}

export function StatCard({ title, value, sub, icon }: StatCardProps) {
  return (
    <Card className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-subtle)]">{title}</div>
        <div className="mt-1.5 text-2xl font-black tracking-tight">{value}</div>
        {sub && <div className="mt-0.5 text-sm text-[var(--text-muted)]">{sub}</div>}
      </div>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-subtle)] text-[var(--accent)]">
        {icon}
      </div>
    </Card>
  );
}
