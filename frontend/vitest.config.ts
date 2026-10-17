import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    pool: "threads",
    // Keep jsdom workers within a laptop's CPU/memory budget; dozens of concurrent
    // React/MapLibre environments otherwise starve interaction-test deadlines.
    maxWorkers: 2,
    testTimeout: 15000,
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
  },
});
