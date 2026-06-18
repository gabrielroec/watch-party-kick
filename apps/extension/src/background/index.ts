// Background service worker. Fluxo simples:
// 1. Viewer cola código → joinRoom → sessão salva em chrome.storage.local
// 2. Abrimos/focamos uma aba kick.com (preferindo a ativa, depois qualquer
//    outra, senão criamos uma nova no canal do streamer)
// 3. O content script (kickOverlay.ts) já roda em qualquer kick.com — ele lê
//    a sessão do storage e injeta o overlay com o player
//
// SEM janela flutuante. SEM popup adicional. Tudo dentro da aba Kick.

import { BACKEND_URL, STORAGE_LAST_ROOM, STORAGE_SESSION, KICK_CHANNEL } from "../config";
import { attachPort, sendMessage, storeBearer } from "./kickChat";

type ExtMessage =
  | { kind: "join-room"; code: string }
  | { kind: "leave-room" }
  | { kind: "get-last-room" }
  | { kind: "kick-send"; slug: string; content: string }
  | { kind: "kick-bearer"; token: string };

type ExtResponse = { ok: true; data?: unknown } | { ok: false; error: string };

chrome.runtime.onMessage.addListener(
  (msg: ExtMessage, _sender, sendResponse: (r: ExtResponse) => void) => {
    handleMessage(msg)
      .then(sendResponse)
      .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
    return true;
  },
);

async function handleMessage(msg: ExtMessage): Promise<ExtResponse> {
  switch (msg.kind) {
    case "join-room":
      return joinRoom(msg.code);
    case "leave-room":
      return leaveRoom();
    case "get-last-room":
      return getLastRoom();
    case "kick-send": {
      const r = await sendMessage(msg.slug, msg.content);
      return r.ok ? { ok: true } : { ok: false, error: r.error ?? `HTTP ${r.status}` };
    }
    case "kick-bearer":
      await storeBearer(msg.token);
      return { ok: true };
  }
}

// Port long-lived pro chat custom (legacy v0.8 — fica disponível mas o overlay
// novo usa o chat real da Kick que tá na própria página)
chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith("kick.chat:")) return;
  const slug = port.name.slice("kick.chat:".length);
  attachPort(port, slug).catch((err: Error) => {
    try { port.postMessage({ kind: "kick.error", error: err.message }); } catch { /* ignore */ }
  });
});

async function joinRoom(code: string): Promise<ExtResponse> {
  const response = await fetch(
    `${BACKEND_URL}/api/rooms/${encodeURIComponent(code)}/join`,
    { method: "POST" },
  );
  if (!response.ok) {
    return { ok: false, error: `backend ${response.status}` };
  }
  const session = await response.json();
  await chrome.storage.local.set({
    [STORAGE_LAST_ROOM]: code,
    [STORAGE_SESSION]: session,
  });
  await ensureKickTab(KICK_CHANNEL);
  return { ok: true };
}

async function leaveRoom(): Promise<ExtResponse> {
  await chrome.storage.local.remove(STORAGE_SESSION);
  // Content script vê o storage mudar e remove o overlay sozinho
  return { ok: true };
}

async function getLastRoom(): Promise<ExtResponse> {
  const result = await chrome.storage.local.get(STORAGE_LAST_ROOM);
  return { ok: true, data: result[STORAGE_LAST_ROOM] ?? null };
}

// Pinga uma aba pra ver se nosso content script tá vivo lá. Retorna true
// se respondeu. Timeout curto pra não travar.
async function pingTab(tabId: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 300);
    chrome.tabs.sendMessage(tabId, { kind: "wpk-overlay-ping" })
      .then((r: { alive?: boolean } | undefined) => {
        clearTimeout(timer);
        resolve(!!r?.alive);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(false);
      });
  });
}

// Garante que tem uma aba kick.com com nosso content script vivo. Preferência:
// 1) Aba ativa já é kick.com → ping. Se vivo, nada a fazer (storage event cuida).
//    Se morto (extensão recém-instalada), reload pra forçar content script.
// 2) Outra aba kick.com → foca + ping/reload.
// 3) Nenhuma aba Kick → abre kick.com/<canal>.
async function ensureKickTab(channel: string): Promise<void> {
  const allTabs = await chrome.tabs.query({});
  const isKick = (t: chrome.tabs.Tab) => t.url?.startsWith("https://kick.com/") ?? false;

  const activeOnKick = allTabs.find((t) => t.active && isKick(t));
  if (activeOnKick && activeOnKick.id != null) {
    const alive = await pingTab(activeOnKick.id);
    if (!alive) await chrome.tabs.reload(activeOnKick.id);
    return;
  }

  const anyKick = allTabs.find(isKick);
  if (anyKick && anyKick.id != null) {
    await chrome.tabs.update(anyKick.id, { active: true });
    if (anyKick.windowId != null) {
      await chrome.windows.update(anyKick.windowId, { focused: true }).catch(() => {});
    }
    const alive = await pingTab(anyKick.id);
    if (!alive) await chrome.tabs.reload(anyKick.id);
    return;
  }

  await chrome.tabs.create({
    url: `https://kick.com/${encodeURIComponent(channel)}`,
    active: true,
  });
}
