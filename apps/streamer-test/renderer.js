const BACKEND_URL = "https://watchpartykick.duckdns.org";

const preview = document.getElementById("preview");
const fpsEl = document.getElementById("fps");
const resEl = document.getElementById("res");
const bitrateEl = document.getElementById("bitrate");
const encoderEl = document.getElementById("encoder");
const statusEl = document.getElementById("status");
const sourcesEl = document.getElementById("sources");

let selectedSourceId = null;
let room = null;
let screenStream = null;

// Importa LiveKit via CDN (mais simples pra teste)
const script = document.createElement("script");
script.src = "https://cdn.jsdelivr.net/npm/livekit-client@2.7.5/dist/livekit-client.umd.js";
script.onload = () => statusEl.textContent = "LiveKit carregado. Pronto.";
document.head.appendChild(script);

// Lista sources disponíveis via Electron desktopCapturer
document.getElementById("pick").addEventListener("click", async () => {
  const sources = await window.electronAPI.getSources();
  sourcesEl.innerHTML = "";
  sources.forEach((s) => {
    const div = document.createElement("div");
    div.className = "source";
    div.innerHTML = `<img src="${s.thumbnail}"><div class="name">${s.name}</div>`;
    div.addEventListener("click", () => {
      selectedSourceId = s.id;
      document.querySelectorAll(".source").forEach((el) => el.classList.remove("selected"));
      div.classList.add("selected");
      statusEl.textContent = `Fonte: ${s.name}`;
    });
    sourcesEl.appendChild(div);
  });
});

document.getElementById("connect").addEventListener("click", async () => {
  const code = document.getElementById("code").value.trim().toUpperCase();
  if (code.length < 4) {
    statusEl.textContent = "Código muito curto";
    return;
  }

  statusEl.textContent = "Criando sala / entrando...";

  try {
    // Cria sala com o código escolhido pelo streamer
    const resp = await fetch(`${BACKEND_URL}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code }),
    });
    if (!resp.ok) throw new Error(`Backend erro ${resp.status}`);
    const session = await resp.json();

    statusEl.textContent = `Sala ${session.roomCode} criada. Capturando tela...`;

    // Captura tela via desktopCapturer (Electron) — usa getUserMedia com chromeMediaSourceId
    const constraints = {
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: selectedSourceId || "screen:0:0",
          maxFrameRate: 60,
          maxWidth: 1280,
          maxHeight: 720,
        },
      },
    };

    screenStream = await navigator.mediaDevices.getUserMedia(constraints);
    const videoTrack = screenStream.getVideoTracks()[0];
    videoTrack.contentHint = "motion";

    // Mostra preview
    preview.srcObject = screenStream;
    preview.play().catch(() => {});

    // Conecta no LiveKit
    const LivekitClient = window.LivekitClient;
    room = new LivekitClient.Room({
      adaptiveStream: false,
      dynacast: false,
    });

    await room.connect(session.livekitUrl, session.livekitToken);
    statusEl.textContent = `Conectado ao LiveKit. Publicando...`;

    // Publica a track
    const lkTrack = new LivekitClient.LocalVideoTrack(videoTrack, undefined, false);
    await room.localParticipant.publishTrack(lkTrack, {
      source: LivekitClient.Track.Source.Camera,
      videoEncoding: {
        maxBitrate: 4_000_000,
        maxFramerate: 60,
      },
      simulcast: false,
      degradationPreference: "maintain-framerate",
    });

    statusEl.textContent = `Transmitindo sala ${session.roomCode} — compartilhe o código!`;

    // Stats loop
    startStatsLoop();
  } catch (e) {
    statusEl.textContent = `Erro: ${e.message}`;
    console.error(e);
  }
});

document.getElementById("stop").addEventListener("click", async () => {
  screenStream?.getTracks().forEach((t) => t.stop());
  await room?.disconnect();
  room = null;
  screenStream = null;
  preview.srcObject = null;
  statusEl.textContent = "Parado.";
  fpsEl.textContent = "-- FPS";
});

function startStatsLoop() {
  let lastFrames = 0;
  let lastBytes = 0;
  let lastTime = performance.now();

  // FPS do preview via getVideoPlaybackQuality
  let lastPreviewFrames = 0;
  let lastPreviewTime = performance.now();

  setInterval(async () => {
    if (!room) return;

    // FPS do preview local (captura real)
    const q = preview.getVideoPlaybackQuality?.();
    const pNow = performance.now();
    const pElapsed = (pNow - lastPreviewTime) / 1000;
    if (q && pElapsed > 0 && lastPreviewFrames > 0) {
      const previewFps = Math.round((q.totalVideoFrames - lastPreviewFrames) / pElapsed);
      fpsEl.textContent = `${previewFps} FPS`;
      fpsEl.style.color = previewFps >= 50 ? "#2dd879" : previewFps >= 30 ? "#f0c040" : "#ff5555";
    }
    if (q) lastPreviewFrames = q.totalVideoFrames;
    lastPreviewTime = pNow;

    // Stats do WebRTC encoder (outbound)
    try {
      const pc = room.engine?.publisher?.pc;
      if (!pc) return;
      const stats = await pc.getStats();
      stats.forEach((report) => {
        if (report.type === "outbound-rtp" && report.kind === "video" && report.framesEncoded > 0) {
          const now = performance.now();
          const elapsed = (now - lastTime) / 1000;
          if (elapsed > 0 && lastFrames > 0) {
            const encFps = Math.round((report.framesEncoded - lastFrames) / elapsed);
            const kbps = Math.round(((report.bytesSent - lastBytes) * 8) / elapsed / 1000);
            bitrateEl.textContent = `enc: ${encFps} fps | ${kbps} kbps`;
            resEl.textContent = `${report.frameWidth || "?"}x${report.frameHeight || "?"}`;
            encoderEl.textContent = report.encoderImplementation || "?";
          }
          lastFrames = report.framesEncoded;
          lastBytes = report.bytesSent;
          lastTime = now;
        }
      });
    } catch {}
  }, 1000);
}
