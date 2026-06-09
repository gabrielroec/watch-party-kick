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

function findKickPlayer(): HTMLElement | null {
  const videos = Array.from(document.querySelectorAll("video"));
  let best: HTMLVideoElement | null = null;
  let bestArea = 0;
  for (const v of videos) {
    if (v.closest(`#${HOST_ID}`)) continue;
    const r = v.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea) { best = v; bestArea = area; }
  }
  if (!best) return null;
  let el: HTMLElement | null = best;
  for (let i = 0; i < 4 && el; i++) {
    const r = el.getBoundingClientRect();
    if (r.width >= bestArea / 1.2) break;
    el = el.parentElement;
  }
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

  // Webcam PiP sobre a tela.
  const webcamWrap = document.createElement("div");
  webcamWrap.className = "webcam-pip";
  const webcamVideo = document.createElement("video");
  webcamVideo.autoplay = true;
  webcamVideo.playsInline = true;
  webcamVideo.muted = true;
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

  function positionOverPlayer() {
    const player = findKickPlayer();
    if (player) {
      const r = player.getBoundingClientRect();
      wrap.style.left = `${r.left + window.scrollX}px`;
      wrap.style.top = `${r.top + window.scrollY}px`;
      wrap.style.width = `${r.width}px`;
      wrap.style.height = `${r.height}px`;
      wrap.dataset.mode = "cover";
    } else {
      wrap.style.left = "auto";
      wrap.style.right = "24px";
      wrap.style.top = "auto";
      wrap.style.bottom = "24px";
      wrap.style.width = "640px";
      wrap.style.height = "360px";
      wrap.dataset.mode = "pip";
    }
  }
  positionOverPlayer();

  const ro = new ResizeObserver(positionOverPlayer);
  ro.observe(document.documentElement);
  window.addEventListener("resize", positionOverPlayer);
  window.addEventListener("scroll", positionOverPlayer, { passive: true });
  const mo = new MutationObserver(() => positionOverPlayer());
  mo.observe(document.body, { childList: true, subtree: true });

  // Drag.
  let dragging = false;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;
  dragHandle.addEventListener("mousedown", (e) => {
    if (wrap.dataset.mode !== "pip") return;
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    const r = wrap.getBoundingClientRect();
    startLeft = r.left; startTop = r.top;
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    wrap.style.left = `${startLeft + (e.clientX - startX)}px`;
    wrap.style.top = `${startTop + (e.clientY - startY)}px`;
    wrap.style.right = "auto"; wrap.style.bottom = "auto";
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
