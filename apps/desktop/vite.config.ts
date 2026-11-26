/// <reference types="vitest/config" />
import { resolve } from "node:path";
import process from "node:process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  // Read VITE_* vars from the monorepo root .env shared by every app.
  envDir: resolve(import.meta.dirname, "../.."),

  // Tauri: keep Rust errors visible, use the fixed port tauri.conf.json expects.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },

  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
