// Manifest MV3 gerado programaticamente via CRXJS.
// Observacoes importantes:
// - content_scripts roda na Kick e em qualquer pagina de teste (localhost)
// - host_permissions necessario pra chamar o backend (fetch + ws) de dentro
//   do content script sem bloqueio de CORS
// - storage usado pra lembrar o ultimo codigo de sala
// - web_accessible_resources: Shadow DOM nao precisa, mas deixamos aberto
//   caso futuro precise injetar iframe/asset

import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Watch Party Kick",
  version: "0.1.0",
  description:
    "Overlay de watch party sobre a Kick. Cola o codigo da sala e assiste junto com o streamer, sem atrapalhar a stream ou o chat.",
  action: {
    default_popup: "src/popup/index.html",
    default_title: "Watch Party Kick",
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  permissions: ["storage", "activeTab", "scripting"],
  host_permissions: [
    "http://localhost:4000/*",
    "http://163.176.58.212:4000/*",
    "https://*.kick.com/*",
    "https://*.livekit.cloud/*",
    "wss://*.livekit.cloud/*",
  ],
  content_scripts: [
    {
      matches: ["https://*.kick.com/*", "http://localhost:3000/*", "http://localhost:5173/*"],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
      all_frames: false,
    },
  ],
  web_accessible_resources: [
    {
      resources: ["assets/*"],
      matches: ["https://*.kick.com/*", "http://localhost/*"],
    },
  ],
});
