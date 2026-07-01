import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function ModalShell({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Esc to close + focus trap
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Move focus into the modal on open
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        navigate(-1);
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (active === first || !panel.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      // Restore focus to the element that opened the modal
      previouslyFocused?.focus?.();
    };
  }, [navigate]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto p-4 md:p-6">
      <button type="button" className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => navigate(-1)} aria-label="Close modal" tabIndex={-1} />
      <div className="relative z-10 flex min-h-full items-start justify-center">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          tabIndex={-1}
          className="surface-panel flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden p-6 outline-none md:max-h-[calc(100vh-3rem)] md:p-8"
        >
          <div className="mb-6 flex shrink-0 items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-black tracking-tight text-[var(--text)]">{title}</h3>
              {description ? <p className="mt-2 text-sm text-[var(--text-muted)]">{description}</p> : null}
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={() => navigate(-1)}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-[var(--border-strong)] text-[var(--text-muted)] transition hover:text-[var(--text)]"
              aria-label="Close modal"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
