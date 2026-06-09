export interface OverlayHandles {
  screenVideoEl: HTMLVideoElement;
  webcamVideoEl: HTMLVideoElement;
  screenAudioEl: HTMLAudioElement;
  webcamAudioEl: HTMLAudioElement;
  infoEl: HTMLDivElement;
  statsEl: HTMLDivElement;
  showWebcam: (visible: boolean) => void;
  updateStats: (fps: number, ping: number, dropped?: number, w?: number, h?: number) => void;
  destroy: () => void;
}

const HOST_ID = "wpk-overlay-host";

// Cache do container do player da Kick: re-resolve so se desconectar do DOM.
// findKickPlayer faz queryAll+getBoundingClientRect que sao caros se chamados
// a cada mutacao do chat (centenas por segundo).
let cachedKickPlayer: HTMLElement | null = null;

function findKickPlayer(): HTMLElement | null {
  if (cachedKickPlayer && cachedKickPlayer.isConnected) return cachedKickPlayer;
  const videos = Array.from(document.querySelectorAll("video"));
  let best: HTMLVideoElement | null = null;
  let bestArea = 0;
  for (const v of videos) {
    if (v.closest(`#${HOST_ID}`)) continue;
    const r = v.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea) { best = v; bestArea = area; }
  }
  if (!best) { cachedKickPlayer = null; return null; }
  let el: HTMLElement | null = best;
  for (let i = 0; i < 4 && el; i++) {
    const r = el.getBoundingClientRect();
    if (r.width >= bestArea / 1.2) break;
    el = el.parentElement;
  }
  cachedKickPlayer = el;
  return el;
}

export function createOverlay(): OverlayHandles {
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "all: initial; position: fixed; z-index: 2147483600;";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    :host, * { box-sizing: border-box; }
    .wrap {
      position: fixed;
      background: #000;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0,0,0,0.6);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #fff;
    }
    .screen-video {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: #000;
    }
    .webcam-pip {
      position: absolute;
      bottom: 12px;
      right: 12px;
      width: 22%;
      aspect-ratio: 16/9;
      border-radius: 8px;
      overflow: hidden;
      border: 2px solid rgba(255,255,255,0.2);
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      display: none;
    }
    .webcam-pip.visible { display: block; }
    .webcam-pip video {
      width: 100%; height: 100%; object-fit: cover; display: block;
    }
    .hud {
      position: absolute; top: 8px; left: 8px; display: flex; gap: 6px; align-items: center;
      padding: 4px 8px; background: rgba(0,0,0,0.6); border-radius: 999px;
      font-size: 11px; letter-spacing: 0.3px; pointer-events: none;
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #2dd879; box-shadow: 0 0 8px #2dd879; }
    .stats {
      position: absolute; top: 8px; right: 44px; display: flex; gap: 8px; align-items: center;
      padding: 4px 10px; background: rgba(0,0,0,0.7); border-radius: 999px;
      font-size: 11px; font-family: ui-monospace, monospace; pointer-events: none; color: #fff;
    }
    .stats .fps { color: #2dd879; }
    .stats .ping { color: #f0c040; }
    .drag-handle {
      position: absolute; top: 0; left: 0; right: 80px; height: 28px; cursor: move;
    }
    .close {
      position: absolute; top: 6px; right: 6px; width: 28px; height: 28px; border-radius: 50%;
      background: rgba(0,0,0,0.55); color: #fff; border: none; cursor: pointer; font-size: 14px;
    }
    .close:hover { background: rgba(255,60,60,0.8); }
    .muted-toggle {
      position: absolute; bottom: 10px; left: 10px; padding: 6px 10px; border-radius: 6px;
      background: rgba(0,0,0,0.55); color: #fff; border: none; cursor: pointer; font-size: 12px;
    }
  `;
  shadow.appendChild(style);

  const wrap = document.createElement("div");
  wrap.className = "wrap";

  // Tela do streamer — video principal.
  const screenVideo = document.createElement("video");
  screenVideo.className = "screen-video";
  screenVideo.autoplay = true;
  screenVideo.playsInline = true;
  screenVideo.muted = true;
  // Hints que mantem Chrome no path de HW decode + reduzem overhead:
  screenVideo.disablePictureInPicture = true;
  screenVideo.disableRemotePlayback = true;
  (screenVideo as HTMLVideoElement & { preservesPitch?: boolean }).preservesPitch = false;

  // Webcam PiP sobre a tela.
  const webcamWrap = document.createElement("div");
  webcamWrap.className = "webcam-pip";
  const webcamVideo = document.createElement("video");
  webcamVideo.autoplay = true;
  webcamVideo.playsInline = true;
  webcamVideo.muted = true;
  webcamVideo.disablePictureInPicture = true;
  webcamVideo.disableRemotePlayback = true;
  (webcamVideo as HTMLVideoElement & { preservesPitch?: boolean }).preservesPitch = false;
  webcamWrap.appendChild(webcamVideo);

  // Audio elements separados (LiveKit envia tracks de audio independentes).
  const screenAudio = document.createElement("audio");
  screenAudio.autoplay = true;
  const webcamAudio = document.createElement("audio");
  webcamAudio.autoplay = true;

  const hud = document.createElement("div");
  hud.className = "hud";
  hud.innerHTML = `<span class="dot"></span><span id="wpk-info">watch party</span>`;
  const infoEl = hud.querySelector("#wpk-info") as HTMLDivElement;

  const statsEl = document.createElement("div");
  statsEl.className = "stats";
  statsEl.innerHTML = `<span class="fps">-- FPS</span><span class="ping">-- ms</span><span class="res">--</span>`;

  const closeBtn = document.createElement("button");
  closeBtn.className = "close";
  closeBtn.textContent = "X";

  const muteBtn = document.createElement("button");
  muteBtn.className = "muted-toggle";
  muteBtn.textContent = "Som: OFF";
  let audioMuted = true;
  muteBtn.addEventListener("click", () => {
    audioMuted = !audioMuted;
    screenAudio.muted = audioMuted;
    webcamAudio.muted = audioMuted;
    screenVideo.muted = true; // video element sempre mudo
    webcamVideo.muted = true;
    muteBtn.textContent = audioMuted ? "Som: OFF" : "Som: ON";
  });

  const dragHandle = document.createElement("div");
  dragHandle.className = "drag-handle";

  wrap.appendChild(screenVideo);
  wrap.appendChild(webcamWrap);
  wrap.appendChild(screenAudio);
  wrap.appendChild(webcamAudio);
  wrap.appendChild(hud);
  wrap.appendChild(statsEl);
  wrap.appendChild(dragHandle);
  wrap.appendChild(closeBtn);
  wrap.appendChild(muteBtn);
  shadow.appendChild(wrap);

  // Posiciona via transform (GPU composito) + width/height. Evita o
  // layout-thrash de setar left/top em pixel toda hora.
  let lastX = -1, lastY = -1, lastW = -1, lastH = -1;
  function positionOverPlayer() {
    const player = findKickPlayer();
    let x: number, y: number, w: number, h: number, mode: string;
    if (player) {
      const r = player.getBoundingClientRect();
      x = r.left + window.scrollX;
      y = r.top + window.scrollY;
      w = r.width;
      h = r.height;
      mode = "cover";
    } else {
      x = window.innerWidth - 664;
      y = window.innerHeight - 384;
      w = 640;
      h = 360;
      mode = "pip";
    }
    if (x === lastX && y === lastY && w === lastW && h === lastH) return;
    lastX = x; lastY = y; lastW = w; lastH = h;
    wrap.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    wrap.style.width = `${w}px`;
    wrap.style.height = `${h}px`;
    wrap.style.left = "0";
    wrap.style.top = "0";
    wrap.style.right = "auto";
    wrap.style.bottom = "auto";
    wrap.dataset.mode = mode;
  }
  positionOverPlayer();

  // rAF-debounce: nao roda mais de 1x por frame, mesmo se mutation observer
  // dispara 100x/seg (o chat da Kick faz isso). Crucial: sem isso, o overlay
  // sozinho derruba o framerate do navegador.
  let rafScheduled = false;
  function schedulePosition() {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      positionOverPlayer();
    });
  }

  const ro = new ResizeObserver(schedulePosition);
  ro.observe(document.documentElement);
  window.addEventListener("resize", schedulePosition);
  window.addEventListener("scroll", schedulePosition, { passive: true });

  // MutationObserver escopado: olha apenas o player (e seu container imediato).
  // O original observava document.body inteiro — dispara em cada msg de chat.
  const playerRoot = findKickPlayer()?.parentElement ?? document.body;
  const mo = new MutationObserver(schedulePosition);
  mo.observe(playerRoot, { childList: true, subtree: false, attributes: true, attributeFilter: ["style", "class"] });

  // Drag (so em modo PiP). Usa transform tambem pra ficar consistente com
  // o positioning principal e nao causar reflow.
  let dragging = false;
  let dragStartX = 0, dragStartY = 0, dragStartLeft = 0, dragStartTop = 0;
  dragHandle.addEventListener("mousedown", (e) => {
    if (wrap.dataset.mode !== "pip") return;
    dragging = true;
    dragStartX = e.clientX; dragStartY = e.clientY;
    dragStartLeft = lastX; dragStartTop = lastY;
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    lastX = dragStartLeft + (e.clientX - dragStartX);
    lastY = dragStartTop + (e.clientY - dragStartY);
    wrap.style.transform = `translate3d(${lastX}px, ${lastY}px, 0)`;
  });
  window.addEventListener("mouseup", () => { dragging = false; });

  closeBtn.addEventListener("click", () => destroy());

  function showWebcam(visible: boolean) {
    webcamWrap.classList.toggle("visible", visible);
  }

  function updateStats(fps: number, ping: number, dropped = 0, w = 0, h = 0) {
    const fpsSpan = statsEl.querySelector(".fps") as HTMLSpanElement;
    const pingSpan = statsEl.querySelector(".ping") as HTMLSpanElement;
    const resSpan = statsEl.querySelector(".res") as HTMLSpanElement;
    if (fpsSpan) fpsSpan.textContent = `${fps} FPS${dropped > 0 ? ` (${dropped} drop)` : ""}`;
    if (pingSpan) pingSpan.textContent = `${ping} ms`;
    if (resSpan) resSpan.textContent = w > 0 ? `${w}x${h}` : "";
    const fpsColor = fps >= 50 ? "#2dd879" : fps >= 30 ? "#f0c040" : "#ff5555";
    if (fpsSpan) fpsSpan.style.color = fpsColor;
  }

  function destroy() {
    ro.disconnect();
    mo.disconnect();
    host.remove();
  }

  return {
    screenVideoEl: screenVideo,
    webcamVideoEl: webcamVideo,
    screenAudioEl: screenAudio,
    webcamAudioEl: webcamAudio,
    infoEl,
    statsEl,
    showWebcam,
    updateStats,
    destroy,
  };
}
