import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Watch Party",
  version: "0.10.1",
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
  permissions: ["storage", "cookies", "scripting", "tabs"],
  host_permissions: [
    "https://watchpartykick.duckdns.org/*",
    "wss://watchpartykick.duckdns.org/*",
    "https://kick.com/*",
    "https://*.kick.com/*",
  ],
  content_scripts: [
    {
      matches: ["https://*.kick.com/*"],
      js: ["src/content/kickTokenSniffer.ts"],
      run_at: "document_start",
      world: "MAIN",
    },
    {
      matches: ["https://*.kick.com/*"],
      js: ["src/content/kickTokenBridge.ts"],
      run_at: "document_start",
      world: "ISOLATED",
    },
    {
      matches: ["https://kick.com/*"],
      js: ["src/content/kickOverlay.ts"],
      run_at: "document_end",
      world: "ISOLATED",
    },
  ],
  web_accessible_resources: [
    {
      resources: ["src/player/index.html", "assets/*"],
      matches: ["<all_urls>"],
    },
  ],
});
