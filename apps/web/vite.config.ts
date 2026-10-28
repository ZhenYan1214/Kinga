import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dev server stays on loopback and forwards /api to the local Kinga service.
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5173, proxy: { "/api": "http://127.0.0.1:8787" } },
});
