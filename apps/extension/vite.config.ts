// Vite + CRXJS: build da extensao MV3.
// O plugin gera o manifest.json no dist/ e processa os entrypoints (popup,
// background, content_script) com HMR em dev.

import { defineConfig } from "vite";
import { resolve } from "node:path";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        player: resolve(__dirname, "src/player/index.html"),
      },
    },
  },
  server: {
    port: 5173,
  },
});
