import { act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LiveSyncBridge } from "../src/app/live-sync";
import { renderRoute } from "./fixtures";

class LiveSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: LiveSocket[] = [];

  readyState = LiveSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(public readonly url: string) {
    LiveSocket.instances.push(this);
  }

  send() {}
  close() {
    this.readyState = LiveSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }

  emit(message: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(message) }));
  }
}

describe("LiveSyncBridge", () => {
  it("revalidates route data after a planner mutation message", async () => {
    LiveSocket.instances = [];
    vi.stubGlobal("WebSocket", LiveSocket);
    const loader = vi.fn(async () => ({ refreshed: true }));
    const { router } = renderRoute([{ path: "/", loader, element: <LiveSyncBridge /> }]);

    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(LiveSocket.instances).toHaveLength(1));
    const socket = LiveSocket.instances[0]!;
    expect(socket.url).toMatch(/\/ws$/);

    act(() => socket?.emit({ type: "requirements-updated", data: { requirementId: "requirement-1" } }));
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2), { timeout: 500 });
    await router.dispose();
  });

  it("ignores malformed and non-mutating messages without revalidating", async () => {
    LiveSocket.instances = [];
    vi.stubGlobal("WebSocket", LiveSocket);
    const loader = vi.fn(async () => ({ refreshed: true }));
    const { router } = renderRoute([{ path: "/", loader, element: <LiveSyncBridge /> }]);

    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(LiveSocket.instances).toHaveLength(1));
    act(() => {
      LiveSocket.instances[0]?.emit({ type: "connected" });
      LiveSocket.instances[0]?.onmessage?.(new MessageEvent("message", { data: "not-json" }));
      LiveSocket.instances[0]?.emit({ type: "unknown-event" });
    });
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    expect(loader).toHaveBeenCalledTimes(1);
    await router.dispose();
  });
});
