import { useEffect, useRef } from "react";
import { useRevalidator } from "react-router-dom";

const RECONNECT_DELAY_MS = 1500;
const REVALIDATE_DEBOUNCE_MS = 80;
const HEARTBEAT_INTERVAL_MS = 12000;
const HEARTBEAT_TIMEOUT_MS = 5000;

type LiveSyncStatus = "connecting" | "live" | "reconnecting" | "disconnected";

export function LiveSyncBridge() {
  const { revalidate } = useRevalidator();
  const socketRef = useRef<WebSocket | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const revalidateTimerRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const heartbeatTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;

    const setStatus = (status: LiveSyncStatus) => {
      window.dispatchEvent(new CustomEvent("agent-plan:ws-status", { detail: { status } }));
    };

    const clearRetryTimer = () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    const clearRevalidateTimer = () => {
      if (revalidateTimerRef.current !== null) {
        window.clearTimeout(revalidateTimerRef.current);
        revalidateTimerRef.current = null;
      }
    };

    const clearHeartbeatTimeout = () => {
      if (heartbeatTimeoutRef.current !== null) {
        window.clearTimeout(heartbeatTimeoutRef.current);
        heartbeatTimeoutRef.current = null;
      }
    };

    const clearHeartbeatTimer = () => {
      if (heartbeatTimerRef.current !== null) {
        window.clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
    };

    const scheduleRevalidate = () => {
      clearRevalidateTimer();
      revalidateTimerRef.current = window.setTimeout(() => {
        revalidate();
      }, REVALIDATE_DEBOUNCE_MS);
    };

    const scheduleReconnect = () => {
      if (!active || retryTimerRef.current !== null) return;
      setStatus("reconnecting");
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        connect();
      }, RECONNECT_DELAY_MS);
    };

    const cleanupSocket = () => {
      clearHeartbeatTimer();
      clearHeartbeatTimeout();
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        try {
          socket.close();
        } catch {
          // ignore
        }
      }
    };

    const startHeartbeat = () => {
      clearHeartbeatTimer();
      clearHeartbeatTimeout();
      heartbeatTimerRef.current = window.setInterval(() => {
        const socket = socketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) return;

        try {
          socket.send(JSON.stringify({ type: "ping" }));
        } catch {
          cleanupSocket();
          scheduleReconnect();
          return;
        }

        clearHeartbeatTimeout();
        heartbeatTimeoutRef.current = window.setTimeout(() => {
          cleanupSocket();
          scheduleReconnect();
        }, HEARTBEAT_TIMEOUT_MS);
      }, HEARTBEAT_INTERVAL_MS);
    };

    const connect = () => {
      if (!active) return;
      const existing = socketRef.current;
      if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) return;

      setStatus(retryTimerRef.current !== null ? "reconnecting" : "connecting");
      clearRetryTimer();
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
      socketRef.current = socket;

      socket.onopen = () => {
        clearRetryTimer();
        setStatus("live");
        startHeartbeat();
      };

      socket.onmessage = (event) => {
        clearHeartbeatTimeout();
        try {
          const message = JSON.parse(event.data) as { type?: string };
          if (!message.type) return;
          if (message.type === "pong" || message.type === "connected") return;

          window.dispatchEvent(new CustomEvent("agent-plan:ws-event", { detail: message }));

          switch (message.type) {
            case "project-updated":
            case "features-updated":
            case "phases-updated":
            case "requirements-updated":
            case "plan-rendered":
            case "file-changed":
              scheduleRevalidate();
              break;
            default:
              break;
          }
        } catch {
          // ignore malformed payloads
        }
      };

      socket.onclose = () => {
        clearHeartbeatTimer();
        clearHeartbeatTimeout();
        if (socketRef.current === socket) socketRef.current = null;
        if (!active) return;
        scheduleReconnect();
      };

      socket.onerror = () => {
        try {
          socket.close();
        } catch {
          // ignore
        }
      };
    };

    const ensureConnected = () => {
      const socket = socketRef.current;
      if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
        connect();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") ensureConnected();
    };

    const handleOnline = () => {
      ensureConnected();
    };

    setStatus("connecting");
    connect();
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      active = false;
      setStatus("disconnected");
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearRetryTimer();
      clearRevalidateTimer();
      clearHeartbeatTimer();
      clearHeartbeatTimeout();
      cleanupSocket();
    };
  }, [revalidate]);

  return null;
}
