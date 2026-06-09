import { Room, RoomEvent, RemoteTrack, Track, RemoteTrackPublication } from "livekit-client";
import type { JoinRoomResponse, WsMessage } from "@wpk/shared";
import { createOverlay, type OverlayHandles } from "./overlay";
import { BACKEND_URL } from "../config";

let currentOverlay: OverlayHandles | null = null;
let currentRoom: Room | null = null;
let currentWs: WebSocket | null = null;

function attachTrack(track: RemoteTrack, pub: RemoteTrackPublication, overlay: OverlayHandles) {
  const name = pub.trackName || "";
  const isScreen = name.startsWith("wpk-screen");
  const isWebcam = name.startsWith("wpk-webcam");

  if (track.kind === Track.Kind.Video) {
    if (isScreen || (!isScreen && !isWebcam)) {
      track.attach(overlay.screenVideoEl);
      overlay.screenVideoEl.play().catch(() => {});
    } else if (isWebcam) {
      track.attach(overlay.webcamVideoEl);
      overlay.webcamVideoEl.play().catch(() => {});
      overlay.showWebcam(true);
    }
  } else if (track.kind === Track.Kind.Audio) {
    if (isScreen || name === "wpk-screen-audio") {
      track.attach(overlay.screenAudioEl);
      overlay.screenAudioEl.play().catch(() => {});
    } else {
      track.attach(overlay.webcamAudioEl);
      overlay.webcamAudioEl.play().catch(() => {});
    }
  }
}

async function startSession(session: JoinRoomResponse) {
  await teardown();

  currentOverlay = createOverlay();
  currentOverlay.infoEl.textContent = `sala ${session.roomCode} · conectando`;

  currentRoom = new Room({ adaptiveStream: true });

  currentRoom.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication) => {
    if (!currentOverlay) return;
    attachTrack(track, pub, currentOverlay);
  });

  currentRoom.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, pub: RemoteTrackPublication) => {
    track.detach();
    if (!currentOverlay) return;
    const name = pub.trackName || "";
    if (pub.source === Track.Source.Camera || name === "webcam") {
      currentOverlay.showWebcam(false);
    }
  });

  currentRoom.on(RoomEvent.Disconnected, () => {
    if (currentOverlay) currentOverlay.infoEl.textContent = `sala ${session.roomCode} · desconectado`;
  });

  await currentRoom.connect(session.livekitUrl, session.livekitToken);
  currentOverlay.infoEl.textContent = `sala ${session.roomCode} · conectado`;

  const overlay = currentOverlay;
  const room = currentRoom;
  let lastTotalFrames = 0;
  let lastDropped = 0;
  let lastTime = performance.now();

  const statsInterval = setInterval(() => {
    if (!overlay || !room) { clearInterval(statsInterval); return; }
    // Skip quando tab oculta — economiza CPU sem custo (stats nao sao visiveis).
    if (document.hidden) return;

    const q = overlay.screenVideoEl.getVideoPlaybackQuality?.();
    const now = performance.now();
    const elapsed = (now - lastTime) / 1000;

    let fps = 0;
    let dropped = 0;
    if (q && elapsed > 0) {
      fps = Math.round((q.totalVideoFrames - lastTotalFrames) / elapsed);
      dropped = q.droppedVideoFrames - lastDropped;
      lastTotalFrames = q.totalVideoFrames;
      lastDropped = q.droppedVideoFrames;
    }
    lastTime = now;

    const rtt = Math.round((room.engine?.latency ?? 0) * 1000);
    const w = overlay.screenVideoEl.videoWidth;
    const h = overlay.screenVideoEl.videoHeight;
    overlay.updateStats(fps, rtt, dropped, w, h);
  }, 1000);

  // PAUSA o player nativo da Kick. So mutar nao basta — o decoder continua
  // rodando e consumindo CPU/GPU, competindo com o decoder do overlay e
  // derrubando o framerate da watch party.
  const pausedKickVideos = new WeakSet<HTMLVideoElement>();
  function pauseKickVideos() {
    document.querySelectorAll("video").forEach((v) => {
      if (!currentOverlay) return;
      if (v === currentOverlay.screenVideoEl || v === currentOverlay.webcamVideoEl) return;
      if (pausedKickVideos.has(v)) return;
      try {
        v.muted = true;
        v.pause();
        pausedKickVideos.add(v);
      } catch { /* noop */ }
    });
  }
  pauseKickVideos();
  // A Kick re-cria <video> em algumas transicoes — re-pausa periodicamente
  // mas com intervalo gentil (2s) pra nao virar fonte de overhead tambem.
  const repauseInterval = setInterval(pauseKickVideos, 2000);
  currentRoom.on(RoomEvent.Disconnected, () => clearInterval(repauseInterval));

  // WS de controle.
  const wsUrl = BACKEND_URL.replace(/^http/, "ws") +
    `/ws?room=${encodeURIComponent(session.roomCode)}` +
    `&identity=${encodeURIComponent(session.identity)}` +
    `&role=viewer`;
  currentWs = new WebSocket(wsUrl);
  currentWs.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data) as WsMessage;
      if (!currentOverlay) return;
      if (msg.type === "presence") {
        currentOverlay.infoEl.textContent = `sala ${session.roomCode} · ${msg.viewers} viewer${msg.viewers === 1 ? "" : "s"}`;
      }
    } catch { /* ignore */ }
  };
}

async function teardown() {
  currentWs?.close();
  currentWs = null;
  await currentRoom?.disconnect();
  currentRoom = null;
  currentOverlay?.destroy();
  currentOverlay = null;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.kind === "session") {
    startSession(msg.session as JoinRoomResponse).catch((e) => {
      console.error("[wpk] falha session", e);
      if (currentOverlay) currentOverlay.infoEl.textContent = "erro conectando";
    });
  } else if (msg?.kind === "leave") {
    teardown();
  }
});

window.addEventListener("beforeunload", () => { teardown(); });
