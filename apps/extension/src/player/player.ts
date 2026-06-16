import { Room, RoomEvent, RemoteTrack, Track } from "livekit-client";
import type { JoinRoomResponse } from "@wpk/shared";
import { BACKEND_URL, STORAGE_SESSION } from "../config";

const videoEl = document.getElementById("video") as HTMLVideoElement;
const audioEl = document.getElementById("audio") as HTMLAudioElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;
const fpsEl = document.getElementById("fps") as HTMLSpanElement;
const pingEl = document.getElementById("ping") as HTMLSpanElement;
const muteBtn = document.getElementById("mute") as HTMLButtonElement;

let audioMuted = true;
muteBtn.addEventListener("click", () => {
  audioMuted = !audioMuted;
  audioEl.muted = audioMuted;
  muteBtn.textContent = audioMuted ? "🔇 Som: OFF" : "🔊 Som: ON";
});

async function loadSession(): Promise<JoinRoomResponse | null> {
  const result = await chrome.storage.local.get(STORAGE_SESSION);
  return (result[STORAGE_SESSION] as JoinRoomResponse | undefined) ?? null;
}

async function connect(): Promise<void> {
  const session = await loadSession();
  if (!session) {
    statusEl.textContent = "sem sessão";
    return;
  }
  statusEl.textContent = `${session.roomCode} · conectando`;

  const room = new Room({ adaptiveStream: true });

  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (track.kind === Track.Kind.Video) {
      track.attach(videoEl);
      videoEl.play().catch(() => {});
    } else if (track.kind === Track.Kind.Audio) {
      track.attach(audioEl);
      audioEl.play().catch(() => {});
    }
  });

  room.on(RoomEvent.TrackUnsubscribed, (track) => track.detach());

  room.on(RoomEvent.Disconnected, () => {
    statusEl.textContent = `${session.roomCode} · desconectado`;
  });

  await room.connect(session.livekitUrl, session.livekitToken);
  statusEl.textContent = `${session.roomCode} · ao vivo`;

  startStatsLoop(room);
  startControlChannel(session);

  window.addEventListener("beforeunload", () => {
    room.disconnect();
  });
}

function startStatsLoop(room: Room): void {
  let lastFrames = 0;
  let lastTime = performance.now();

  setInterval(() => {
    const quality = videoEl.getVideoPlaybackQuality?.();
    const now = performance.now();
    const elapsed = (now - lastTime) / 1000;

    if (quality && elapsed > 0) {
      const fps = Math.round((quality.totalVideoFrames - lastFrames) / elapsed);
      lastFrames = quality.totalVideoFrames;
      lastTime = now;
      fpsEl.textContent = `${fps} FPS`;
      fpsEl.style.color = fps >= 50 ? "#2dd879" : fps >= 30 ? "#f0c040" : "#ff5555";
    }
    pingEl.textContent = `${Math.round((room.engine?.latency ?? 0) * 1000)} ms`;
  }, 1000);
}

function startControlChannel(session: JoinRoomResponse): void {
  const wsUrl =
    BACKEND_URL.replace(/^http/, "ws") +
    `/ws?room=${encodeURIComponent(session.roomCode)}` +
    `&identity=${encodeURIComponent(session.identity)}` +
    `&role=viewer`;

  const ws = new WebSocket(wsUrl);
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "presence") {
        const count = msg.viewers as number;
        statusEl.textContent = `${session.roomCode} · ${count} viewer${count === 1 ? "" : "s"}`;
      }
    } catch { /* ignore */ }
  };
}

connect().catch((err) => {
  console.error("[player] connect failed", err);
  statusEl.textContent = "erro: " + (err instanceof Error ? err.message : "desconhecido");
});
