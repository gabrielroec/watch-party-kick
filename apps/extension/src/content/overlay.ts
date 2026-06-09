// Overlay injetado na pagina da Kick. SEMPRE cobre o player Kick exatamente
// — posicionado e dimensionado conforme o player muda de tamanho (resize,
// fullscreen, theater mode etc).
//
// O video recebido ja vem com TUDO composto pelo publisher (screen share +
// webcam PiP num unico canvas). Zero compositing tricks no viewer.

export interface OverlayHandles {
  screenVideoEl: HTMLVideoElement;
  screenAudioEl: HTMLAudioElement;
  infoEl: HTMLDivElement;
  statsEl: HTMLDivElement;
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
  const bestWidth = best.getBoundingClientRect().width;
  let el: HTMLElement | null = best;
  let chosen: HTMLElement = best;
  for (let i = 0; i < 6 && el; i++) {
    const r = el.getBoundingClientRect();
    if (r.width > bestWidth * 1.5) break;
    chosen = el;
    el = el.parentElement;
  }
  cachedKickPlayer = chosen;
  return chosen;
}

export function createOverlay(): OverlayHandles {
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "all: initial; position: fixed; z-index: 2147483600; pointer-events: none;";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    :host, * { box-sizing: border-box; }
    .wrap {
      position: fixed;
      background: #000;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #fff;
      pointer-events: auto;
      contain: layout style;
      will-change: transform, width, height;
    }
    .screen-video {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
      background: #000;
    }
    .hud {
      position: absolute; top: 12px; left: 12px; display: flex; gap: 8px; align-items: center;
      padding: 5px 10px; background: rgba(0,0,0,0.7); border-radius: 999px;
      font-size: 12px; letter-spacing: 0.2px; pointer-events: none;
      z-index: 3;
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #2dd879; box-shadow: 0 0 8px #2dd879; }
    .stats {
      position: absolute; top: 12px; right: 56px; display: flex; gap: 8px; align-items: center;
      padding: 5px 10px; background: rgba(0,0,0,0.7); border-radius: 999px;
      font-size: 11px; font-family: ui-monospace, monospace; pointer-events: none; color: #fff;
      z-index: 3;
    }
    .stats .fps { color: #2dd879; }
    .stats .ping { color: #f0c040; }
    .close {
      position: absolute; top: 10px; right: 10px;
      width: 36px; height: 36px; border-radius: 50%;
      background: rgba(0,0,0,0.65); color: #fff; border: none;
      cursor: pointer; font-size: 18px; line-height: 1;
      display: flex; align-items: center; justify-content: center;
      z-index: 4;
      transition: background 100ms;
    }
    .close:hover { background: rgba(255,60,60,0.85); }
    .muted-toggle {
      position: absolute; bottom: 12px; left: 12px;
      padding: 8px 14px; border-radius: 8px;
      background: rgba(0,0,0,0.65); color: #fff; border: none;
      cursor: pointer; font-size: 13px;
      z-index: 3;
      transition: background 100ms;
    }
    .muted-toggle:hover { background: rgba(0,0,0,0.85); }
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
  statsEl.innerHTML = `<span class="fps">-- FPS</span><span class="ping">-- ms</span>`;

  const closeBtn = document.createElement("button");
  closeBtn.className = "close";
  closeBtn.textContent = "×";
  closeBtn.title = "Fechar watch party";

  const muteBtn = document.createElement("button");
  muteBtn.className = "muted-toggle";
  muteBtn.textContent = "🔇 Som: OFF";
  let audioMuted = true;
  muteBtn.addEventListener("click", () => {
    audioMuted = !audioMuted;
    screenAudio.muted = audioMuted;
    screenVideo.muted = true;
    muteBtn.textContent = audioMuted ? "🔇 Som: OFF" : "🔊 Som: ON";
  });

  wrap.appendChild(screenVideo);
  wrap.appendChild(screenAudio);
  wrap.appendChild(hud);
  wrap.appendChild(statsEl);
  wrap.appendChild(closeBtn);
  wrap.appendChild(muteBtn);
  shadow.appendChild(wrap);

  // ----- Posicionamento: SEMPRE cobre o player Kick -----
  let lastX = -1, lastY = -1, lastW = -1, lastH = -1;

  function positionOverPlayer() {
    const player = findKickPlayer();
    let x: number, y: number, w: number, h: number;
    if (player) {
      const r = player.getBoundingClientRect();
      x = r.left + window.scrollX;
      y = r.top + window.scrollY;
      w = r.width;
      h = r.height;
    } else {
      // Fallback se nao achar o player: PiP simples no canto
      x = window.innerWidth - 660;
      y = 20;
      w = 640;
      h = 360;
    }
    if (x === lastX && y === lastY && w === lastW && h === lastH) return;
    lastX = x; lastY = y; lastW = w; lastH = h;
    wrap.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    wrap.style.width = `${w}px`;
    wrap.style.height = `${h}px`;
    wrap.style.left = "0";
    wrap.style.top = "0";
  }
  positionOverPlayer();

  // rAF-debounce: nao roda mais de 1x por frame mesmo com muitos eventos.
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

  // MutationObserver escopado ao container do player (nao o body inteiro
  // — chat da Kick gera milhares de mutations/seg).
  const playerRoot = findKickPlayer()?.parentElement ?? document.body;
  const mo = new MutationObserver(schedulePosition);
  mo.observe(playerRoot, {
    childList: true,
    subtree: false,
    attributes: true,
    attributeFilter: ["style", "class"],
  });

  // ----- Tracking de fullscreen do Kick player -----
  // Se o usuario clicar fullscreen no player Kick, queremos seguir.
  document.addEventListener("fullscreenchange", schedulePosition);

  closeBtn.addEventListener("click", () => destroy());

  function updateStats(fps: number, ping: number, dropped = 0, w = 0, h = 0) {
    const fpsSpan = statsEl.querySelector(".fps") as HTMLSpanElement;
    const pingSpan = statsEl.querySelector(".ping") as HTMLSpanElement;
    if (fpsSpan) {
      fpsSpan.textContent = `${fps} FPS${dropped > 0 ? ` (${dropped}↓)` : ""}`;
      fpsSpan.style.color = fps >= 50 ? "#2dd879" : fps >= 30 ? "#f0c040" : "#ff5555";
    }
    if (pingSpan) pingSpan.textContent = `${ping}ms`;
    if (w > 0) statsEl.title = `${w}x${h}`;
  }

  function destroy() {
    ro.disconnect();
    mo.disconnect();
    document.removeEventListener("fullscreenchange", schedulePosition);
    window.removeEventListener("resize", schedulePosition);
    window.removeEventListener("scroll", schedulePosition);
    host.remove();
  }

  return {
    screenVideoEl: screenVideo,
    screenAudioEl: screenAudio,
    infoEl,
    statsEl,
    updateStats,
    destroy,
  };
}
