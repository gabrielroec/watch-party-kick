// Overlay content script — quando o viewer entrou numa sala E está numa página
// kick.com, sobrepõe a UI da Kick (player + sidebar + header) deixando APENAS o
// painel do chat exposto. Resultado: nosso player vira o "conteúdo principal"
// da página e o chat real da Kick fica do lado, totalmente funcional com o
// login do usuário (porque é a página real dele, mesma sessão, sem partition).
//
// Por que content script + Shadow DOM:
// - content script roda no contexto da kick.com → tem acesso ao DOM dela
// - Shadow DOM isola CSS da nossa overlay (Kick não consegue estilar e vice-versa)
// - z-index máximo + position fixed garante que cobre tudo
// - Lê posição/largura do #channel-chatroom em runtime pra deixar exposto

import { Room, RoomEvent, type RemoteTrack, Track } from "livekit-client";
import type { JoinRoomResponse } from "@wpk/shared";
import { STORAGE_SESSION } from "../config";

const OVERLAY_ID = "wpk-overlay-root";

let overlayEl: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let room: Room | null = null;
let resizeObserver: ResizeObserver | null = null;
let mutationObserver: MutationObserver | null = null;
let statsTimer: number | null = null;

function $<T extends HTMLElement>(sel: string): T | null {
  return shadow?.querySelector(sel) as T | null;
}

function findChatEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>("#channel-chatroom");
}

function syncChatExpose(): void {
  if (!shadow) return;
  const stage = shadow.querySelector<HTMLElement>(".wpk-stage");
  if (!stage) return;

  const chat = findChatEl();
  if (chat && chat.offsetWidth > 0) {
    const rect = chat.getBoundingClientRect();
    const chatWidth = Math.max(0, window.innerWidth - rect.left);
    stage.style.setProperty("--chat-w", `${chatWidth}px`);
    stage.classList.add("wpk-has-chat");
  } else {
    stage.style.setProperty("--chat-w", "0px");
    stage.classList.remove("wpk-has-chat");
  }
}

function buildShadowDOM(): ShadowRoot {
  const host = document.createElement("div");
  host.id = OVERLAY_ID;
  host.style.cssText = "all: initial !important; position: static !important;";
  const s = host.attachShadow({ mode: "open" });

  s.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .wpk-stage {
        position: fixed;
        top: 0;
        left: 0;
        bottom: 0;
        right: var(--chat-w, 0px);
        z-index: 2147483647;
        background: #0a0a0d;
        display: flex;
        flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #fff;
        overflow: hidden;
      }
      video {
        width: 100%;
        height: 100%;
        object-fit: contain;
        background: #000;
        display: block;
        flex: 1;
        min-height: 0;
      }
      audio { display: none; }
      .hud {
        position: absolute;
        top: 12px; left: 12px; right: 12px;
        display: flex; gap: 10px; align-items: center;
        padding: 8px 14px;
        background: linear-gradient(180deg, rgba(0,0,0,0.75), rgba(0,0,0,0));
        border-radius: 999px;
        font-size: 12px;
        pointer-events: none;
        z-index: 2;
      }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #2dd879; box-shadow: 0 0 8px #2dd879; }
      .spacer { flex: 1; }
      .stats { display: flex; gap: 10px; font-family: ui-monospace, monospace; font-size: 11px; }
      .stats .fps { color: #2dd879; }
      .controls {
        position: absolute;
        bottom: 16px; left: 16px;
        display: flex; gap: 8px;
        z-index: 2;
      }
      .btn {
        padding: 8px 14px;
        background: rgba(0,0,0,0.7);
        color: #fff;
        border: 0;
        border-radius: 8px;
        cursor: pointer;
        font-size: 13px;
        font-family: inherit;
        backdrop-filter: blur(4px);
      }
      .btn:hover { background: rgba(0,0,0,0.9); }
      .close {
        position: absolute;
        top: 14px; right: 14px;
        width: 32px; height: 32px;
        padding: 0;
        border-radius: 50%;
        font-size: 14px;
        font-weight: 700;
        z-index: 2;
      }
    </style>
    <div class="wpk-stage">
      <video id="video" autoplay muted playsinline></video>
      <audio id="audio" autoplay></audio>
      <div class="hud">
        <span class="dot"></span>
        <span id="status">conectando...</span>
        <span class="spacer"></span>
        <span class="stats"><span class="fps" id="fps">-- FPS</span></span>
      </div>
      <div class="controls">
        <button id="mute" class="btn">🔇 Som: OFF</button>
      </div>
      <button id="close" class="btn close" title="Fechar overlay">✕</button>
    </div>
  `;

  document.body.appendChild(host);
  overlayEl = host;
  return s;
}

async function connectRoom(session: JoinRoomResponse): Promise<void> {
  if (!shadow) return;

  const statusEl = $<HTMLSpanElement>("#status")!;
  const fpsEl = $<HTMLSpanElement>("#fps")!;
  const videoEl = $<HTMLVideoElement>("#video")!;
  const audioEl = $<HTMLAudioElement>("#audio")!;

  statusEl.textContent = `${session.roomCode} · conectando`;

  if (room) {
    try { await room.disconnect(); } catch { /* ignore */ }
  }

  room = new Room({ adaptiveStream: true });

  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (track.kind === Track.Kind.Video) {
      track.attach(videoEl);
      videoEl.play().catch(() => {});
    } else if (track.kind === Track.Kind.Audio) {
      track.attach(audioEl);
      audioEl.play().catch(() => {});
    }
  });
  room.on(RoomEvent.TrackUnsubscribed, (t) => t.detach());
  room.on(RoomEvent.Disconnected, () => {
    statusEl.textContent = `${session.roomCode} · desconectado`;
  });

  try {
    await room.connect(session.livekitUrl, session.livekitToken);
    statusEl.textContent = `${session.roomCode} · ao vivo`;
  } catch (err) {
    statusEl.textContent = "erro de conexão";
    console.error("[wpk-overlay] connect failed", err);
    return;
  }

  // Stats
  let lastFrames = 0;
  let lastTime = performance.now();
  if (statsTimer != null) clearInterval(statsTimer);
  statsTimer = window.setInterval(() => {
    const q = videoEl.getVideoPlaybackQuality?.();
    const now = performance.now();
    const elapsed = (now - lastTime) / 1000;
    if (q && elapsed > 0) {
      const fps = Math.round((q.totalVideoFrames - lastFrames) / elapsed);
      lastFrames = q.totalVideoFrames;
      lastTime = now;
      fpsEl.textContent = `${fps} FPS`;
      fpsEl.style.color = fps >= 50 ? "#2dd879" : fps >= 30 ? "#f0c040" : "#ff5555";
    }
  }, 1000);
}

function attach(session: JoinRoomResponse): void {
  if (overlayEl) return; // já tá lá

  shadow = buildShadowDOM();
  syncChatExpose();

  // Eventos pra ajustar quando o chat é redimensionado/colapsado
  window.addEventListener("resize", syncChatExpose);
  const chatEl = findChatEl();
  if (chatEl && "ResizeObserver" in window) {
    resizeObserver = new ResizeObserver(syncChatExpose);
    resizeObserver.observe(chatEl);
  }

  // SPA da Kick remonta o DOM — observa mudanças e re-sincroniza
  mutationObserver = new MutationObserver(() => {
    syncChatExpose();
    const newChat = findChatEl();
    if (newChat && resizeObserver) {
      try { resizeObserver.observe(newChat); } catch { /* ignore */ }
    }
  });
  mutationObserver.observe(document.body, { childList: true, subtree: true });

  // Wire controls
  const muteBtn = $<HTMLButtonElement>("#mute")!;
  const audioEl = $<HTMLAudioElement>("#audio")!;
  const closeBtn = $<HTMLButtonElement>("#close")!;

  let muted = true;
  audioEl.muted = muted;
  muteBtn.addEventListener("click", () => {
    muted = !muted;
    audioEl.muted = muted;
    muteBtn.textContent = muted ? "🔇 Som: OFF" : "🔊 Som: ON";
  });
  closeBtn.addEventListener("click", () => {
    detach();
    // mantém a sessão no storage; popup continua funcionando
  });

  void connectRoom(session);
}

function detach(): void {
  if (statsTimer != null) {
    clearInterval(statsTimer);
    statsTimer = null;
  }
  if (room) {
    try { room.disconnect(); } catch { /* ignore */ }
    room = null;
  }
  if (resizeObserver) {
    try { resizeObserver.disconnect(); } catch { /* ignore */ }
    resizeObserver = null;
  }
  if (mutationObserver) {
    try { mutationObserver.disconnect(); } catch { /* ignore */ }
    mutationObserver = null;
  }
  window.removeEventListener("resize", syncChatExpose);
  if (overlayEl) {
    try { overlayEl.remove(); } catch { /* ignore */ }
    overlayEl = null;
    shadow = null;
  }
}

async function init(): Promise<void> {
  // Ping/pong pro background saber se a gente tá vivo (evita reload desnecessário
  // quando a aba já tem nosso content script rodando)
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.kind === "wpk-overlay-ping") {
      sendResponse({ alive: true });
      return false;
    }
    return false;
  });

  // Checa session inicial
  const stored = await chrome.storage.local.get(STORAGE_SESSION);
  const session = stored[STORAGE_SESSION] as JoinRoomResponse | undefined;
  if (session) attach(session);

  // Escuta mudanças (viewer joins/leaves)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STORAGE_SESSION]) return;
    const next = changes[STORAGE_SESSION].newValue as JoinRoomResponse | undefined;
    if (next) attach(next);
    else detach();
  });
}

void init();
