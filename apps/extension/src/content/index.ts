import { Room, RoomEvent, RemoteTrack, Track } from "livekit-client";
import type { JoinRoomResponse } from "@wpk/shared";
import { createOverlay, type Overlay } from "./overlay";
import { BACKEND_URL } from "../config";

let overlay: Overlay | null = null;
let room: Room | null = null;
let ws: WebSocket | null = null;
let statsTimer: number | undefined;

async function startSession(session: JoinRoomResponse): Promise<void> {
  await endSession();

  overlay = await createOverlay();
  overlay.setTitle(`${session.roomCode} · conectando`);

  room = new Room({ adaptiveStream: true });

  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (!overlay) return;
    if (track.kind === Track.Kind.Video) {
      track.attach(overlay.videoEl);
      overlay.videoEl.play().catch(() => {});
    } else if (track.kind === Track.Kind.Audio) {
      track.attach(overlay.audioEl);
      overlay.audioEl.play().catch(() => {});
    }
  });

  room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => track.detach());

  room.on(RoomEvent.Disconnected, () => {
    overlay?.setTitle(`${session.roomCode} · desconectado`);
  });

  await room.connect(session.livekitUrl, session.livekitToken);
  overlay.setTitle(`${session.roomCode} · ao vivo`);

  startStatsLoop(session.roomCode);
  startControlChannel(session);
}

function startStatsLoop(roomCode: string): void {
  if (!overlay || !room) return;

  let lastFrames = 0;
  let lastTime = performance.now();
  const activeOverlay = overlay;
  const activeRoom = room;

  statsTimer = window.setInterval(() => {
    if (document.hidden) return;
    const quality = activeOverlay.videoEl.getVideoPlaybackQuality?.();
    const now = performance.now();
    const elapsed = (now - lastTime) / 1000;

    if (quality && elapsed > 0) {
      const fps = Math.round((quality.totalVideoFrames - lastFrames) / elapsed);
      lastFrames = quality.totalVideoFrames;
      lastTime = now;
      const ping = Math.round((activeRoom.engine?.latency ?? 0) * 1000);
      activeOverlay.setStats(fps, ping);
    }
  }, 1000);
}

function startControlChannel(session: JoinRoomResponse): void {
  const wsUrl =
    BACKEND_URL.replace(/^http/, "ws") +
    `/ws?room=${encodeURIComponent(session.roomCode)}` +
    `&identity=${encodeURIComponent(session.identity)}` +
    `&role=viewer`;

  ws = new WebSocket(wsUrl);
  ws.onmessage = (ev) => {
    if (!overlay) return;
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "presence") {
        const count = msg.viewers as number;
        overlay.setTitle(`${session.roomCode} · ${count} viewer${count === 1 ? "" : "s"}`);
      }
    } catch { /* ignore malformed */ }
  };
}

async function endSession(): Promise<void> {
  if (statsTimer != null) clearInterval(statsTimer);
  ws?.close();
  ws = null;
  await room?.disconnect();
  room = null;
  overlay?.destroy();
  overlay = null;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.kind === "session") {
    startSession(msg.session as JoinRoomResponse).catch((err) => {
      console.error("[wpk] failed to start session", err);
      overlay?.setTitle("erro conectando");
    });
  } else if (msg?.kind === "leave") {
    endSession();
  }
});

window.addEventListener("beforeunload", () => { endSession(); });
