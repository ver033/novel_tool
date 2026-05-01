import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/renderer",
  build: {
    outDir: "../../.vite/renderer/main_window",
    emptyOutDir: true
  },
  plugins: [react()]
});
