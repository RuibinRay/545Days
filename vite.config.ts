import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves a project site at /<repo>/. Keep this in sync with the repo name.
// The app uses a hash router so deep links work without a 404 rewrite.
export default defineConfig({
  base: "/545Days/",
  plugins: [react()],
  worker: { format: "es" },
  build: {
    target: "es2022",
    sourcemap: true,
    // vendor chunks (M8): the renderer, the charts and React change on their own schedules and cache separately
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes("node_modules/pixi.js") || id.includes("node_modules/@pixi")) return "pixi";
          if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-") || id.includes("node_modules/victory-vendor")) return "charts";
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "react";
          return undefined;
        },
      },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
} as Parameters<typeof defineConfig>[0]);
