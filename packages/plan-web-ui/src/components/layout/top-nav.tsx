import { ChevronDown, Download, Layers, ListTodo, Menu, Moon, ScrollText, Sun, X } from "lucide-react";
import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { exportPlan } from "../../lib/api";
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
    <span className={`inline-flex max-w-full min-h-7 items-center gap-1.5 rounded-[10px] border px-2 py-1 text-xs font-semibold sm:min-h-8 sm:rounded-[12px] sm:px-2.5 sm:py-1.5 sm:text-sm ${config.className}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${config.dotClassName}`} />
      <span className="truncate">{config.label}</span>
    </span>
  );
}

export function TopNav({
  projectName,
  projectRoot,
  planRoot,
  liveStatus,
}: {
  projectName: string | undefined;
  projectRoot: string | undefined;
  planRoot: string | undefined;
  liveStatus: LiveStatus;
}) {
  const { theme, toggleTheme } = useTheme();
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<"summary" | "full" | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navItems = [
    { to: "/features", label: "Features", icon: Layers },
    { to: "/requirements", label: "Requirements", icon: ListTodo },
    { to: "/handoff", label: "Handoff", icon: ScrollText },
  ];

  async function downloadExport(full: boolean) {
    const mode = full ? "full" : "summary";
    setExporting(mode);
    try {
      const report = await exportPlan(full);
      const blob = new Blob([report.markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = full ? "EXPORT-full.md" : report.filePath || "EXPORT.md";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportOpen(false);
    } catch (error) {
      window.alert(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="relative z-20 overflow-visible border-b border-[var(--border)] bg-[var(--surface-elevated)] backdrop-blur-xl backdrop-saturate-150">
      <div className="page-container flex items-center gap-2 py-2 sm:gap-3 sm:py-2.5">
        <Link
          to="/"
          title={projectRoot ?? projectName ?? "Agent Plan"}
          className="flex min-w-0 shrink items-center gap-2 sm:gap-2.5"
        >
          <div className="surface-card flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] text-[var(--accent)] sm:h-9 sm:w-9">
            <Layers className="h-4 w-4" />
          </div>
          <span className="truncate text-sm font-black tracking-tight sm:text-base">{projectName ?? "Agent Plan"}</span>
        </Link>

        <nav className="ml-1 hidden items-center gap-1 md:flex">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              aria-label={item.label}
              className={({ isActive }) =>
                `inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-[10px] border px-2 py-1 text-xs font-semibold transition sm:min-h-8 sm:rounded-[12px] sm:px-3 sm:py-1.5 sm:text-sm ${
                  isActive
                    ? "border-transparent bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-transparent text-[var(--text-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--text)]"
                }`
              }
            >
              <item.icon className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          <LiveStatusBadge liveStatus={liveStatus} />

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-elevated)] text-[var(--text-muted)] transition hover:text-[var(--text)] sm:h-9 sm:w-9 sm:rounded-[12px]"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <div className="relative md:hidden">
            <button
              type="button"
              aria-label="Open menu"
              aria-haspopup="menu"
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen((open) => !open)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-elevated)] text-[var(--text-muted)] transition hover:text-[var(--text)]"
            >
              {mobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            {mobileNavOpen ? (
              <>
                <div
                  className="fixed inset-0 z-[150]"
                  aria-hidden="true"
                  onClick={() => setMobileNavOpen(false)}
                />
                <div
                  role="menu"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setMobileNavOpen(false);
                  }}
                  className="absolute right-0 top-full z-[200] mt-2 w-52 overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-elevated)] p-1 shadow-xl"
                >
                  {navItems.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      aria-label={item.label}
                      onClick={() => setMobileNavOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-2 rounded-[10px] px-3 py-2 text-sm font-semibold transition ${
                          isActive ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--text)] hover:bg-[var(--accent-soft)]"
                        }`
                      }
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </NavLink>
                  ))}
                  <div className="my-1 h-px bg-[var(--border)]" />
                  <button
                    type="button"
                    role="menuitem"
                    disabled={exporting !== null}
                    onClick={() => {
                      setMobileNavOpen(false);
                      void downloadExport(false);
                    }}
                    className="flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--accent-soft)] disabled:cursor-wait disabled:opacity-60"
                  >
                    Export summary
                    {exporting === "summary" ? <span className="text-xs text-[var(--text-muted)]">…</span> : null}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={exporting !== null}
                    onClick={() => {
                      setMobileNavOpen(false);
                      void downloadExport(true);
                    }}
                    className="flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--accent-soft)] disabled:cursor-wait disabled:opacity-60"
                  >
                    Export full
                    {exporting === "full" ? <span className="text-xs text-[var(--text-muted)]">…</span> : null}
                  </button>
                </div>
              </>
            ) : null}
          </div>

          <div className="relative z-30 hidden md:block">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={exportOpen}
              aria-label="Export"
              onClick={() => setExportOpen((open) => !open)}
              className="inline-flex min-h-7 items-center gap-1.5 rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-elevated)] px-2 py-1 text-xs font-semibold text-[var(--text-muted)] transition hover:text-[var(--text)] sm:min-h-8 sm:rounded-[12px] sm:px-3 sm:py-1.5 sm:text-sm"
            >
              <Download className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
              <span>Export</span>
              <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform sm:h-4 sm:w-4 ${exportOpen ? "rotate-180" : ""}`} />
            </button>
            {exportOpen ? (
              <div
                role="menu"
                onKeyDown={(e) => {
                  const items = Array.from(
                    e.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]"),
                  ).filter((el) => !el.hasAttribute("disabled"));
                  if (items.length === 0) return;
                  const idx = items.indexOf(document.activeElement as HTMLElement);
                  let next = idx;
                  if (e.key === "ArrowDown") next = idx === -1 ? 0 : (idx + 1) % items.length;
                  else if (e.key === "ArrowUp") next = idx === -1 ? items.length - 1 : (idx - 1 + items.length) % items.length;
                  else if (e.key === "Home") next = 0;
                  else if (e.key === "End") next = items.length - 1;
                  else return;
                  e.preventDefault();
                  items[next]?.focus();
                }}
                className="absolute right-0 top-full z-[200] mt-2 min-w-44 overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-elevated)] p-1 shadow-xl"
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={exporting !== null}
                  onClick={() => void downloadExport(false)}
                  className="flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--accent-soft)] disabled:cursor-wait disabled:opacity-60"
                >
                  Summary
                  {exporting === "summary" ? <span className="text-xs text-[var(--text-muted)]">…</span> : null}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={exporting !== null}
                  onClick={() => void downloadExport(true)}
                  className="flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--accent-soft)] disabled:cursor-wait disabled:opacity-60"
                >
                  Full
                  {exporting === "full" ? <span className="text-xs text-[var(--text-muted)]">…</span> : null}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
