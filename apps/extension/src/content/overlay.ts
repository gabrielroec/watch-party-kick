// Overlay injetado na pagina da Kick. Mostra a tela do streamer por cima
// do player nativo. O "buraco" (cutout) opcional torna uma regiao TRANSPARENTE
// pra revelar a webcam nativa da Kick por baixo.

import type { ScreenCutout } from "@wpk/shared";

export interface OverlayHandles {
  screenVideoEl: HTMLVideoElement;
  screenAudioEl: HTMLAudioElement;
  infoEl: HTMLDivElement;
  statsEl: HTMLDivElement;
  applyCutout: (cutout: ScreenCutout | null) => void;
  updateStats: (fps: number, ping: number, dropped?: number, w?: number, h?: number) => void;
  destroy: () => void;
}

const HOST_ID = "wpk-overlay-host";

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

// Gera a URL de mask SVG dinamica: branco = visivel, preto = transparente.
// Coordenadas em porcentagem (0-100).
function makeCutoutMaskUrl(cutout: ScreenCutout | null): string {
  if (!cutout) return "";
  const X = (cutout.x * 100).toFixed(2);
  const Y = (cutout.y * 100).toFixed(2);
  const W = (cutout.w * 100).toFixed(2);
  const H = (cutout.h * 100).toFixed(2);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'>` +
    `<rect width='100' height='100' fill='white'/>` +
    `<rect x='${X}' y='${Y}' width='${W}' height='${H}' fill='black'/>` +
    `</svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
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
      /* SEM background opaco: o cutout fica transparente quando aplicado.
         O proprio video preenche todo o wrap quando esta tocando. */
      background: transparent;
      border-radius: 8px;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #fff;
    }
    .screen-video {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: #000;
      transition: -webkit-mask-image 80ms linear, mask-image 80ms linear;
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
      z-index: 2;
    }
    .close:hover { background: rgba(255,60,60,0.8); }
    .muted-toggle {
      position: absolute; bottom: 10px; left: 10px; padding: 6px 10px; border-radius: 6px;
      background: rgba(0,0,0,0.55); color: #fff; border: none; cursor: pointer; font-size: 12px;
      z-index: 2;
    }
  `;
  shadow.appendChild(style);

  const wrap = document.createElement("div");
  wrap.className = "wrap";

  const screenVideo = document.createElement("video");
  screenVideo.className = "screen-video";
  screenVideo.autoplay = true;
  screenVideo.playsInline = true;
  screenVideo.muted = true;
  screenVideo.disablePictureInPicture = true;
  screenVideo.disableRemotePlayback = true;
  (screenVideo as HTMLVideoElement & { preservesPitch?: boolean }).preservesPitch = false;

  const screenAudio = document.createElement("audio");
  screenAudio.autoplay = true;

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
    screenVideo.muted = true;
    muteBtn.textContent = audioMuted ? "Som: OFF" : "Som: ON";
  });

  const dragHandle = document.createElement("div");
  dragHandle.className = "drag-handle";

  wrap.appendChild(screenVideo);
  wrap.appendChild(screenAudio);
  wrap.appendChild(hud);
  wrap.appendChild(statsEl);
  wrap.appendChild(dragHandle);
  wrap.appendChild(closeBtn);
  wrap.appendChild(muteBtn);
  shadow.appendChild(wrap);

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

  const playerRoot = findKickPlayer()?.parentElement ?? document.body;
  const mo = new MutationObserver(schedulePosition);
  mo.observe(playerRoot, { childList: true, subtree: false, attributes: true, attributeFilter: ["style", "class"] });

  // Drag em modo PiP
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

  function applyCutout(cutout: ScreenCutout | null) {
    const url = makeCutoutMaskUrl(cutout);
    // Aplica em ambos prefixos pra cobrir Chromium e Safari.
    screenVideo.style.maskImage = url;
    (screenVideo.style as CSSStyleDeclaration & { webkitMaskImage?: string }).webkitMaskImage = url;
    screenVideo.style.maskSize = "100% 100%";
    (screenVideo.style as CSSStyleDeclaration & { webkitMaskSize?: string }).webkitMaskSize = "100% 100%";
    screenVideo.style.maskRepeat = "no-repeat";
    (screenVideo.style as CSSStyleDeclaration & { webkitMaskRepeat?: string }).webkitMaskRepeat = "no-repeat";
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
    screenAudioEl: screenAudio,
    infoEl,
    statsEl,
    applyCutout,
    updateStats,
    destroy,
  };
}
