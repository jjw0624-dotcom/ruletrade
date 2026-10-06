import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // WSL branch fast-forwards can otherwise leave a running dev server on the
    // previous module graph. Polling and no-store keep browser/runtime parity.
    watch: { usePolling: true },
    headers: { "Cache-Control": "no-store" },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
