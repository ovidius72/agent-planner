import { useEffect, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";

const WS_URL = import.meta.env.DEV
  ? `ws://127.0.0.1:3030/ws`
  : `ws://127.0.0.1:3030/ws`;

interface WsMessage {
  type: string;
  data: unknown;
}

/**
 * Subscribe to WebSocket events and invalidate relevant queries.
 */
export function usePlanWebSocket(queryClient: QueryClient): void {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[ws] connected");
      };

      ws.onmessage = (event) => {
        try {
          const msg: WsMessage = JSON.parse(event.data);

          switch (msg.type) {
            case "project-updated":
              queryClient.invalidateQueries({ queryKey: ["project"] });
              break;
            case "requirements-updated":
              queryClient.invalidateQueries({ queryKey: ["requirements"] });
              break;
            case "phases-updated":
              queryClient.invalidateQueries({ queryKey: ["phases"] });
              queryClient.invalidateQueries({ queryKey: ["phase"] });
              break;
            case "plan-rendered":
              // Notify the user if needed
              break;
            case "file-changed":
              // Could trigger a full refresh
              queryClient.invalidateQueries();
              break;
            case "connected":
            case "pong":
              break;
            default:
              console.log("[ws] unknown message type:", msg.type);
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        console.log("[ws] disconnected, reconnecting in 3s");
        reconnTimer.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      clearTimeout(reconnTimer.current);
      wsRef.current?.close();
    };
  }, [queryClient]);
}
