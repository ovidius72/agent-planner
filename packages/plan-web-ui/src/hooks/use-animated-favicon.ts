import { useEffect, useRef } from "react";

const FAVICON_SIZE = 32;
const FAVICON_PADDING = 4;
const ARC_LENGTH = Math.PI * 1.2; // ~216 degrees of arc

// Fallback accent — canvas's 2D context does NOT resolve CSS variables, so
// the literal `var(--accent, …)` value paints nothing. Read the computed
// value from the document root at runtime; fall back to the brand purple
// if unavailable (SSR, detached head, etc.).
function resolveAccentColor(): string {
  if (typeof document === "undefined") return "#7b68ee";
  const probe = document.createElement("div");
  probe.style.color = "var(--accent, #7b68ee)";
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color || "#7b68ee";
  probe.remove();
  return resolved;
}

function createStaticFavicon(): string {
  const canvas = document.createElement("canvas");
  canvas.width = FAVICON_SIZE;
  canvas.height = FAVICON_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const accent = resolveAccentColor();

  // Background circle
  ctx.beginPath();
  ctx.arc(FAVICON_SIZE / 2, FAVICON_SIZE / 2, FAVICON_SIZE / 2 - FAVICON_PADDING, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();

  // Letter "A"
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 16px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("A", FAVICON_SIZE / 2, FAVICON_SIZE / 2 + 1);

  return canvas.toDataURL("image/png");
}

function drawActiveFavicon(canvas: HTMLCanvasElement, angle: number): string {
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const accent = resolveAccentColor();

  ctx.clearRect(0, 0, FAVICON_SIZE, FAVICON_SIZE);

  const cx = FAVICON_SIZE / 2;
  const cy = FAVICON_SIZE / 2;
  const r = FAVICON_SIZE / 2 - FAVICON_PADDING;

  // Background circle (slightly dimmed while active so the spinner stands out)
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Rotating spinner arc
  ctx.beginPath();
  ctx.arc(cx, cy, r - 3, angle, angle + ARC_LENGTH);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.stroke();

  // Letter "A"
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 14px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("A", cx, cy + 1);

  return canvas.toDataURL("image/png");
}

function findOrCreateIconLink(): HTMLLinkElement {
  let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/png";
    document.head.appendChild(link);
  }
  return link;
}

/**
 * Animate the browser favicon while at least one task is in progress.
 *
 * - Static "A" icon when there are no active tasks.
 * - Subtle rotating arc overlaid on the same "A" icon while active.
 * - Animation updates at 10 fps and pauses when the document is hidden to avoid
 *   wasting CPU on background tabs.
 * - Cleans up the interval and restores the static icon on unmount.
 */
export function useAnimatedFavicon(active: boolean): void {
  const linkRef = useRef<HTMLLinkElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const staticRef = useRef<string | null>(null);
  const angleRef = useRef(0);

  useEffect(() => {
    if (!linkRef.current) {
      linkRef.current = findOrCreateIconLink();
    }

    if (!staticRef.current) {
      staticRef.current = createStaticFavicon();
    }

    if (!canvasRef.current) {
      const canvas = document.createElement("canvas");
      canvas.width = FAVICON_SIZE;
      canvas.height = FAVICON_SIZE;
      canvasRef.current = canvas;
    }

    const link = linkRef.current;

    if (!active) {
      link.href = staticRef.current;
      return;
    }

    let frame = 0;
    const interval = window.setInterval(() => {
      if (document.hidden) return;
      angleRef.current += Math.PI / 10;
      link.href = drawActiveFavicon(canvasRef.current!, angleRef.current);
      frame += 1;
    }, 100);

    return () => {
      window.clearInterval(interval);
      link.href = staticRef.current!;
    };
  }, [active]);
}
