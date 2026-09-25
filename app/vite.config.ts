/// <reference types="vitest/config" />
import path from "node:path";
import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
    // Learn pages and the glossary are bundled from ../content (lib/content/learn.ts).
    fs: { allow: [import.meta.dirname, path.resolve(import.meta.dirname, "../content")] },
  },
  test: process.env.STATLY_ENGINE_TESTS
    ? {
        // Real-engine integration suite (npm run test:engine): spawns the engine over stdio.
        environment: "node",
        include: ["src/**/*.engine.test.ts"],
        testTimeout: 120_000,
        fileParallelism: false,
      }
    : {
        environment: "jsdom",
        include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
        exclude: ["src/**/*.engine.test.ts", "node_modules/**"],
        setupFiles: ["src/test/setup.ts"],
      },
}));
