/**
 * WebSocket Hub — bidirectional real-time sync for plan changes.
 *
 * After the HTTP server starts, attach a WsHub to it.
 * All plan mutations broadcast events so connected clients stay in sync.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { EntityChangedData } from "./entity-events.js";
import { hostHeaderIsLoopback } from "./auth.js";

const MAX_INBOUND_BYTES = 64 * 1024;
const MAX_BUFFERED_BYTES = 1024 * 1024;

export type WsEvent =
  | { type: "file-changed"; data: { filename: string } }
  | { type: "project-updated"; data: unknown }
  | { type: "requirements-updated"; data: unknown }
  | { type: "features-updated"; data: unknown }
  | { type: "phases-updated"; data: unknown }
  | { type: "plan-rendered"; data: unknown }
  | { type: "handoffUpdated"; data: { phaseId: string } }
  | { type: "handoffCleared"; data: { phaseId: string } }
  | { type: "entity-changed"; data: EntityChangedData };

export class WsHub {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private quiet: boolean;

  /**
   * `upgradeOriginAllowed` guards the WebSocket upgrade: a browser always
   * sends Origin, and only the Agent Plan UI and configured extra origins
   * (e.g. Heca) may connect. A request without Origin is a non-browser
   * client; a foreign Origin is refused before the socket is upgraded.
   */
  constructor(server: Server, quiet = false, onError?: (err: Error) => void, upgradeOriginAllowed?: (origin: string | undefined) => boolean) {
    this.quiet = quiet;
    // noServer + manual upgrade so the origin check runs before any socket
    // is upgraded to a WebSocket (architecture.md §6: writes and WebSocket
    // upgrades are accepted only from the Agent Plan UI and Heca origins).
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_INBOUND_BYTES });

    server.on("upgrade", (req, socket, head) => {
      const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      if (pathname !== "/ws") {
        socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      if (!hostHeaderIsLoopback(req.headers.host) || (upgradeOriginAllowed && !upgradeOriginAllowed(req.headers.origin))) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit("connection", ws, req);
      });
    });

    // Critical: if the underlying HTTP server fails to listen (e.g. EADDRINUSE),
    // the WebSocketServer also emits 'error'. Without a handler this becomes
    // an uncaughtException that crashes the host process. Forward to caller.
    this.wss.on("error", (err) => {
      if (onError) onError(err);
      else if (!this.quiet) console.error("[ws] server error:", err);
    });

    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      if (!this.quiet) console.log(`[ws] client connected (${this.clients.size} total)`);

      // Send initial connected event
      this.send(ws, JSON.stringify({ type: "connected", data: "ok" }));

      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "ping") {
            this.send(ws, JSON.stringify({ type: "pong", data: "" }));
          }
          // Future: handle client requests like "refresh" or "subscribe"
        } catch {
          // ignore malformed messages
        }
      });

      ws.on("close", () => {
        this.clients.delete(ws);
        if (!this.quiet) console.log(`[ws] client disconnected (${this.clients.size} left)`);
      });

      ws.on("error", () => {
        this.clients.delete(ws);
      });
    });
  }

  private send(client: WebSocket, message: string): void {
    if (client.readyState !== WebSocket.OPEN) return;
    // Bound the queue for clients that stop draining. A reconnect can fetch
    // the current planner snapshot without retaining this socket's backlog.
    if (client.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.clients.delete(client);
      client.terminate();
      return;
    }
    try {
      client.send(message);
    } catch {
      this.clients.delete(client);
      client.terminate();
    }
  }

  broadcast(event: WsEvent): void {
    const message = JSON.stringify(event);
    for (const client of this.clients) this.send(client, message);
  }

  close(): void {
    // Terminate every open socket first (browser keeps WebSocket alive, which
    // would otherwise block the HTTP server from closing and stall process exit).
    for (const client of this.clients) {
      try { client.terminate(); } catch {}
    }
    this.clients.clear();
    this.wss.close();
  }
}
