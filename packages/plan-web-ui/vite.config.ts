import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const proxyTarget = process.env.VITE_PROXY_TARGET ?? "http://127.0.0.1:3030";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5175,
    proxy: {
      // plan-server serves its API under /api (apiPrefix="/api" when it
      // bundles the UI), so forward the prefix as-is.
      "/api": {
        target: proxyTarget,
      },
      // Live-sync WebSocket (LiveSyncBridge connects to ws://host/ws)
      "/ws": {
        target: proxyTarget,
        ws: true,
        // Abrupt WS client disconnects (tab close, HMR full reload) surface as
        // ECONNRESET/EPIPE on the proxied socket; they are expected and the
        // server hub already cleans up its client set. Silence only those;
        // anything else still logs.
        configure: (proxy) => {
          proxy.on("error", (err) => {
            if (err && (err.code === "ECONNRESET" || err.code === "EPIPE")) return;
            console.error("[vite ws proxy]", err);
          });
        },
      },
    },
  },
});
