import { Check, Copy, FileText, Home, Layers, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useTheme } from "../../lib/theme";
import type { LiveStatus } from "./app-shell";

function LiveStatusBadge({ liveStatus }: { liveStatus: LiveStatus }) {
  const config = liveStatus === "live"
    ? { label: "Live", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", dotClassName: "bg-emerald-500" }
    : liveStatus === "reconnecting"
      ? { label: "Reconnecting…", className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400", dotClassName: "bg-amber-500 animate-pulse" }
      : liveStatus === "disconnected"
        ? { label: "Disconnected", className: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400", dotClassName: "bg-rose-500" }
        : { label: "Connecting…", className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400", dotClassName: "bg-sky-500 animate-pulse" };

  return (
    <span className={`inline-flex min-h-11 items-center gap-2 rounded-[14px] border px-3 py-2 text-sm font-semibold ${config.className}`}>
      <span className={`h-2.5 w-2.5 rounded-full ${config.dotClassName}`} />
      {config.label}
    </span>
  );
}

export function TopNav({
  projectName,
  projectRoot,
  planRoot,
  handoffExists,
  liveStatus,
}: {
  projectName: string | undefined;
  projectRoot: string | undefined;
  planRoot: string | undefined;
  handoffExists: boolean;
  liveStatus: LiveStatus;
}) {
  const { theme, toggleTheme } = useTheme();
  const [copied, setCopied] = useState(false);
  const navItems = [
    { to: "/", label: "Dashboard", icon: Home },
    { to: "/features", label: "Features", icon: Layers },
    ...(handoffExists ? [{ to: "/handoff", label: "Handoff", icon: FileText }] : []),
  ];

  return (
    <div className="border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur-xl">
      <div className="page-container flex flex-col gap-4 py-3 md:flex-row md:items-center md:justify-between">
        <Link to="/" className="flex min-w-0 items-center gap-3">
          <div className="surface-card flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--border)] text-[var(--accent)]">
            <Layers className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="truncate text-sm font-black tracking-tight">{projectName ?? "Agent Plan"}</div>
              {planRoot ? <span className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-subtle)]">.planner/</span> : null}
            </div>
            {projectRoot ? (
              <div className="flex items-center gap-2">
                <div className="truncate text-[11px] text-[var(--text-subtle)]" title={projectRoot}>{projectRoot}</div>
                <button
                  type="button"
                  onClick={async (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!projectRoot) return;
                    await navigator.clipboard.writeText(projectRoot).catch(() => {});
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1200);
                  }}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-subtle)] transition hover:text-[var(--text)]"
                  title={copied ? "Copied" : "Copy project path"}
                  aria-label={copied ? "Copied" : "Copy project path"}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            ) : null}
          </div>
        </Link>

        <div className="flex items-center justify-between gap-3 md:justify-end">
          <div className="flex flex-wrap items-center gap-2">
            <LiveStatusBadge liveStatus={liveStatus} />
          </div>
          <nav className="flex flex-wrap items-center gap-2">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `inline-flex min-h-11 items-center gap-2 rounded-[14px] border px-4 py-2 text-sm font-semibold transition ${
                    isActive
                      ? "border-transparent bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "border-transparent text-[var(--text-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--text)]"
                  }`
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-[var(--border-strong)] bg-[var(--surface-elevated)] text-[var(--text-muted)] transition hover:text-[var(--text)]"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
