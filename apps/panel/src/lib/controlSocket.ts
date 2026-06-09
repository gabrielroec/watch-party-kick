// Conexao ao canal WebSocket de controle (presenca + host-state).
// Usado pelo painel pra anunciar toggles (webcam/mic on-off) e pela
// extensao pra receber contagem de viewers + estado atual.

import type { WsMessage } from "@wpk/shared";

export function openControlSocket(params: {
  backendUrl: string;
  roomCode: string;
  identity: string;
  role: "host" | "viewer";
  onMessage?: (msg: WsMessage) => void;
}): { send: (msg: WsMessage) => void; close: () => void } {
  const wsUrl = params.backendUrl.replace(/^http/, "ws") +
    `/ws?room=${encodeURIComponent(params.roomCode)}` +
    `&identity=${encodeURIComponent(params.identity)}` +
    `&role=${encodeURIComponent(params.role)}`;

  const ws = new WebSocket(wsUrl);
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data) as WsMessage;
      params.onMessage?.(msg);
    } catch {
      /* ignore */
    }
  };
  ws.onerror = (e) => console.error("[ws] erro", e);

  function send(msg: WsMessage) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }
  function close() {
    ws.close();
  }
  return { send, close };
}
