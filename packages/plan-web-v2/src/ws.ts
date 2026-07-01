import { useEffect, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";

const WS_URL = import.meta.env.DEV
  ? `ws://127.0.0.1:3030/ws`
  : `ws://127.0.0.1:3030/ws`;

interface WsMessage {
  type: string;
  data: unknown;
}

export function usePlanWebSocket(queryClient: QueryClient): void {
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    function connect() {
      if (!mountedRef.current) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => { /* connected */ };

      ws.onmessage = (event) => {
        try {
          const msg: WsMessage = JSON.parse(event.data);
          switch (msg.type) {
            case "project-updated":
              queryClient.invalidateQueries({ queryKey: ["project"] });
              break;
            case "features-updated":
              queryClient.invalidateQueries({ queryKey: ["features"] });
              queryClient.invalidateQueries({ queryKey: ["feature"] });
              break;
            case "phases-updated":
              queryClient.invalidateQueries({ queryKey: ["phases"] });
              queryClient.invalidateQueries({ queryKey: ["phase"] });
              break;
            case "plan-rendered":
              break;
            case "file-changed":
              queryClient.invalidateQueries();
              break;
          }
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        timerRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => ws.close();
    }

    connect();

    return () => {
      mountedRef.current = false;
      clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [queryClient]);
}
