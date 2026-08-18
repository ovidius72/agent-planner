import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

class TestWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = TestWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(public readonly url: string) {}

  close() {
    this.readyState = TestWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }

  send() {}
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", TestWebSocket);
});

afterEach(() => {
  cleanup();
  if (typeof window.localStorage?.clear === "function") window.localStorage.clear();
  vi.unstubAllGlobals();
});

Object.defineProperty(HTMLElement.prototype, "offsetParent", {
  configurable: true,
  get() {
    return document.body;
  },
});
