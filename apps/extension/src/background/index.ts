// Service worker (MV3). Mantemos leve: so ouve mensagens do popup e repassa
// pro content script da aba ativa. Assim o popup nao precisa achar a aba
// sozinho e o content script nao precisa fazer fetch (menos CORS dor de cabeca).

import { BACKEND_URL, STORAGE_LAST_ROOM } from "../config";

// Tipos de mensagens internas da extensao. NAO confundir com WsMessage do backend.
type ExtMessage =
  | { kind: "join-room"; code: string }
  | { kind: "leave-room" }
  | { kind: "get-last-room" };

type ExtResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };

chrome.runtime.onMessage.addListener((msg: ExtMessage, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.kind === "join-room") {
        // Pede token pro backend (chamada HTTP no contexto do SW - sem CORS da Kick).
        const resp = await fetch(`${BACKEND_URL}/api/rooms/${encodeURIComponent(msg.code)}/join`, {
          method: "POST",
        });
        if (!resp.ok) {
          sendResponse({ ok: false, error: `backend ${resp.status}` } satisfies ExtResponse);
          return;
        }
        const data = await resp.json();
        await chrome.storage.local.set({ [STORAGE_LAST_ROOM]: msg.code });
        // Repassa pro content script da aba ativa (a que chamou o popup).
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id != null) {
          chrome.tabs.sendMessage(tab.id, { kind: "session", session: data });
        }
        sendResponse({ ok: true, data } satisfies ExtResponse);
      } else if (msg.kind === "leave-room") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id != null) chrome.tabs.sendMessage(tab.id, { kind: "leave" });
        sendResponse({ ok: true } satisfies ExtResponse);
      } else if (msg.kind === "get-last-room") {
        const v = await chrome.storage.local.get(STORAGE_LAST_ROOM);
        sendResponse({ ok: true, data: v[STORAGE_LAST_ROOM] ?? null } satisfies ExtResponse);
      }
    } catch (e) {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : "erro" } satisfies ExtResponse);
    }
  })();
  return true; // mantem canal aberto pra resposta async
});
