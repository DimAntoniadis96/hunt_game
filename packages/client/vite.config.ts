import { defineConfig } from "vite";

// Vite reads VITE_-prefixed vars from .env and exposes them on import.meta.env.
export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2021",
    sourcemap: true,
    chunkSizeWarningLimit: 1500, // Babylon core is chunky; this silences the warn
  },
});
