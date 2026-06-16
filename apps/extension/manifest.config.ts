import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Watch Party",
  version: "0.3.0",
  description:
    "Abre uma janela flutuante pra assistir junto com seu streamer favorito enquanto você navega.",
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
  permissions: ["storage"],
  host_permissions: [
    "https://watchpartykick.duckdns.org/*",
    "wss://watchpartykick.duckdns.org/*",
  ],
  web_accessible_resources: [
    {
      resources: ["src/player/index.html", "assets/*"],
      matches: ["<all_urls>"],
    },
  ],
});
