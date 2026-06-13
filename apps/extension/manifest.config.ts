import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Watch Party",
  version: "0.2.0",
  description:
    "Janela flutuante pra assistir junto com seu streamer favorito sobre qualquer página.",
  action: {
    default_popup: "src/popup/index.html",
    default_title: "Watch Party",
  },
  icons: {
    16: "icons/icon-16.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png",
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  permissions: ["storage", "activeTab", "scripting"],
  host_permissions: [
    "https://watchpartykick.duckdns.org/*",
    "wss://watchpartykick.duckdns.org/*",
    "<all_urls>",
  ],
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
      all_frames: false,
    },
  ],
});
