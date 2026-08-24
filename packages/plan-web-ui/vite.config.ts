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
      },
    },
  },
});
