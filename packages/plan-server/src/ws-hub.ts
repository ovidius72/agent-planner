/**
 * WebSocket Hub — bidirectional real-time sync for plan changes.
 *
 * After the HTTP server starts, attach a WsHub to it.
 * All plan mutations broadcast events so connected clients stay in sync.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";

export type WsEvent =
  | { type: "file-changed"; data: { filename: string } }
  | { type: "project-updated"; data: unknown }
  | { type: "requirements-updated"; data: unknown }
  | { type: "features-updated"; data: unknown }
  | { type: "phases-updated"; data: unknown }
  | { type: "plan-rendered"; data: unknown };

export class WsHub {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private quiet: boolean;

  constructor(server: Server, quiet = false, onError?: (err: Error) => void) {
    this.quiet = quiet;
    this.wss = new WebSocketServer({ server, path: "/ws" });

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
      ws.send(JSON.stringify({ type: "connected", data: "ok" }));

      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "ping") {
            ws.send(JSON.stringify({ type: "pong", data: "" }));
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

  broadcast(event: WsEvent): void {
    const msg = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(msg);
        } catch {
          this.clients.delete(client);
        }
      }
    }
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
