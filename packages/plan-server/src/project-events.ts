import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { hostHeaderIsLoopback, originIsAllowed } from "./auth.js";

const route = /^(\/api\/v2\/projects\/([0-9a-f-]+)\/workspaces\/[0-9a-f-]+)\/events\/stream$/;
const maxConnections = 16;
const maxBuffer = 1024 * 1024;

interface Subscription {
  projectId: string;
  pump(): Promise<void>;
}

export function attachProjectEvents(input: {
  server: Server;
  bootId: string;
  originRef: { current: string | undefined };
  allowedOrigins: readonly string[];
  fetch(request: Request): Response | Promise<Response>;
}) {
  const websocket = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const subscriptions = new Set<Subscription>();

  input.server.on("upgrade", (request, socket, head) => {
    const reject = () => { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); };
    if (!hostHeaderIsLoopback(request.headers.host)
      || !originIsAllowed(request.headers.origin, input.originRef.current, input.allowedOrigins)
      || websocket.clients.size >= maxConnections) {
      reject();
      return;
    }
    const url = URL.parse(request.url ?? "/", "http://localhost");
    const match = url ? route.exec(url.pathname) : null;
    if (!url || !match || !match[1] || !match[2]) {
      reject();
      return;
    }
    const [scope, projectId] = [match[1], match[2]];
    const after = url.searchParams.get("after");
    const epoch = url.searchParams.get("bootId");
    websocket.handleUpgrade(request, socket, head, (client) => {
      addSubscriber(client, request, scope, projectId, after, epoch);
    });
  });

  function addSubscriber(
    client: WebSocket, request: IncomingMessage, scope: string, projectId: string, after: string | null, epoch: string | null,
  ): void {
    let cursor = after;
    let running = false;
    let pending = false;
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === "string") headers.set(key, value);
    }
    const send = (message: unknown) => {
      if (client.readyState !== WebSocket.OPEN) return false;
      const data = JSON.stringify(message);
      if (client.bufferedAmount + Buffer.byteLength(data) > maxBuffer) {
        client.close(1013, "Slow consumer");
        return false;
      }
      client.send(data);
      return true;
    };
    const sub: Subscription = {
      projectId,
      async pump() {
        if (running) {
          pending = true;
          return;
        }
        running = true;
        try {
          do {
            pending = false;
            if (client.readyState !== WebSocket.OPEN) return;
            const target = cursor === null ? `${scope}/snapshot` : `${scope}/events?${new URLSearchParams({ after: cursor })}`;
            const response = await input.fetch(new Request(new URL(target, "http://localhost"), { headers }));
            if (!response.ok) {
              if (response.status === 409) send({ type: "snapshot-required", bootId: input.bootId });
              client.close(response.status >= 500 ? 1013 : 1008, "Project subscription refused");
              return;
            }
            const envelope = await response.json() as {
              data: { cursor: number; nextCursor?: number; more?: boolean };
            };
            if (!send({ type: cursor === null ? "snapshot" : "events", bootId: input.bootId, data: envelope.data })) return;
            cursor = String(envelope.data.nextCursor ?? envelope.data.cursor);
            pending ||= envelope.data.more === true;
          } while (pending);
        } catch {
          client.close(1011, "Project subscription failed");
        } finally {
          running = false;
        }
      },
    };
    client.on("error", () => client.terminate());
    client.once("close", () => subscriptions.delete(sub));
    if (cursor !== null && epoch !== input.bootId) {
      send({ type: "snapshot-required", bootId: input.bootId });
      client.close(1008, "Service boot changed");
      return;
    }
    subscriptions.add(sub);
    void sub.pump();
  }

  return {
    notify(projectId: string): void {
      for (const sub of subscriptions) {
        if (sub.projectId === projectId) void sub.pump();
      }
    },
    close(): void {
      for (const client of websocket.clients) client.terminate();
      websocket.close();
      subscriptions.clear();
    },
  };
}
