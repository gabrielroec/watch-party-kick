// Manifest MV3 gerado programaticamente via CRXJS.
import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Watch Party Kick",
  version: "0.1.0",
  description:
    "Watch party sobre a Kick: cole o código da sala e veja a tela do streamer sobre o player, sem atrapalhar a stream.",
  action: {
    default_popup: "src/popup/index.html",
    default_title: "Watch Party Kick",
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
    "https://*.kick.com/*",
  ],
  content_scripts: [
    {
      matches: ["https://*.kick.com/*"],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
      all_frames: false,
    },
  ],
  web_accessible_resources: [
    {
      resources: ["assets/*", "icons/*"],
      matches: ["https://*.kick.com/*"],
    },
  ],
});
