// Janela flutuante draggable + resizable injetada na pagina da Kick.
// Substitui a abordagem anterior de "overlay com cutout transparente" que
// nao funcionava de forma confiavel cross-platform (DirectComposition no
// Windows bypassa CSS clipping).
//
// Estados:
// - PiP: janela flutuante 16:9 num canto, draggable e resizable
// - Maximized: cobre o player Kick exatamente, escondendo a live oficial
// - Closed: nao instanciado
//
// Persistencia: posicao + tamanho + modo salvos em chrome.storage.local
// pra restaurar entre sessoes.

export type OverlayMode = "pip" | "maximized";

export interface OverlayState {
  mode: OverlayMode;
  // Coordenadas PiP em pixels (relativos ao viewport).
  pipX: number;
  pipY: number;
  pipW: number;
  pipH: number;
}

export interface OverlayHandles {
  screenVideoEl: HTMLVideoElement;
  screenAudioEl: HTMLAudioElement;
  infoEl: HTMLDivElement;
  statsEl: HTMLDivElement;
  updateStats: (fps: number, ping: number, dropped?: number, w?: number, h?: number) => void;
  destroy: () => void;
}

const HOST_ID = "wpk-overlay-host";
const STORAGE_KEY = "wpk:overlayState";
const DEFAULT_PIP_W = 480;
const DEFAULT_PIP_H = 270; // 16:9
const MIN_PIP_W = 240;
const ASPECT_RATIO = 16 / 9;
const VIEWPORT_MARGIN = 16;

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

function defaultPipState(): OverlayState {
  const vw = window.innerWidth;
  return {
    mode: "pip",
    pipX: vw - DEFAULT_PIP_W - VIEWPORT_MARGIN,
    pipY: VIEWPORT_MARGIN,
    pipW: DEFAULT_PIP_W,
    pipH: DEFAULT_PIP_H,
  };
}

async function loadState(): Promise<OverlayState> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(STORAGE_KEY, (res) => {
        const stored = res?.[STORAGE_KEY] as OverlayState | undefined;
        if (
          stored &&
          typeof stored.pipX === "number" &&
          typeof stored.pipY === "number" &&
          typeof stored.pipW === "number" &&
          typeof stored.pipH === "number" &&
          (stored.mode === "pip" || stored.mode === "maximized")
        ) {
          resolve(clampToViewport(stored));
        } else {
          resolve(defaultPipState());
        }
      });
    } catch {
      resolve(defaultPipState());
    }
  });
}

function saveState(s: OverlayState) {
  try {
    chrome.storage.local.set({ [STORAGE_KEY]: s });
  } catch { /* noop */ }
}

function clampToViewport(s: OverlayState): OverlayState {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let { pipX, pipY, pipW, pipH } = s;
  pipW = Math.max(MIN_PIP_W, Math.min(pipW, vw - VIEWPORT_MARGIN * 2));
  pipH = pipW / ASPECT_RATIO;
  pipX = Math.max(VIEWPORT_MARGIN, Math.min(pipX, vw - pipW - VIEWPORT_MARGIN));
  pipY = Math.max(VIEWPORT_MARGIN, Math.min(pipY, vh - pipH - VIEWPORT_MARGIN));
  return { ...s, pipX, pipY, pipW, pipH };
}

export async function createOverlay(): Promise<OverlayHandles> {
  document.getElementById(HOST_ID)?.remove();

  const initialState = await loadState();

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "all: initial; position: fixed; z-index: 2147483600; inset: 0; pointer-events: none;";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    :host, * { box-sizing: border-box; }
    .wrap {
      position: fixed;
      background: #000;
      border-radius: 10px;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #fff;
      box-shadow: 0 12px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06);
      pointer-events: auto;
      contain: layout style;
      will-change: transform, width, height;
    }
    .wrap.maximized { border-radius: 0; box-shadow: none; }

    .header {
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 36px;
      display: flex; align-items: center;
      padding: 0 8px 0 12px;
      background: linear-gradient(180deg, rgba(0,0,0,0.7), rgba(0,0,0,0));
      gap: 8px;
      z-index: 3;
      cursor: move;
      user-select: none;
    }
    .header .title {
      display: flex; align-items: center; gap: 6px;
      font-size: 12px; font-weight: 600; letter-spacing: 0.2px;
    }
    .header .dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #2dd879; box-shadow: 0 0 8px #2dd879;
    }
    .header .spacer { flex: 1; }
    .header .stats {
      display: flex; gap: 8px; align-items: center;
      padding: 3px 8px;
      background: rgba(0,0,0,0.5); border-radius: 999px;
      font-size: 11px; font-family: ui-monospace, monospace;
      pointer-events: none;
    }
    .header .stats .fps { color: #2dd879; }
    .header .stats .ping { color: #f0c040; }
    .header button {
      width: 28px; height: 28px;
      background: rgba(255,255,255,0.08);
      color: #fff; border: none; border-radius: 6px;
      cursor: pointer; font-size: 13px; line-height: 1;
      display: flex; align-items: center; justify-content: center;
      transition: background 100ms;
    }
    .header button:hover { background: rgba(255,255,255,0.18); }
    .header button.close:hover { background: rgba(255,60,60,0.8); }

    .video-stage {
      position: absolute;
      inset: 0;
      background: #000;
    }
    .video-stage video {
      width: 100%; height: 100%;
      object-fit: cover;
      background: #000;
      display: block;
    }

    .muted-toggle {
      position: absolute;
      bottom: 10px; left: 10px;
      padding: 6px 10px;
      background: rgba(0,0,0,0.6);
      color: #fff;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      z-index: 3;
    }
    .muted-toggle:hover { background: rgba(0,0,0,0.8); }

    /* Resize handles nos 4 cantos. So aparecem em PiP mode. */
    .resize-handle {
      position: absolute;
      width: 16px; height: 16px;
      z-index: 4;
    }
    .wrap.maximized .resize-handle { display: none; }
    .resize-handle.nw { top: 0; left: 0; cursor: nwse-resize; }
    .resize-handle.ne { top: 0; right: 0; cursor: nesw-resize; }
    .resize-handle.sw { bottom: 0; left: 0; cursor: nesw-resize; }
    .resize-handle.se { bottom: 0; right: 0; cursor: nwse-resize; }
    /* Indicador visual sutil (so no hover do wrap) */
    .wrap:hover .resize-handle::after {
      content: "";
      position: absolute;
      width: 8px; height: 8px;
      background: rgba(45,216,121,0.85);
      border-radius: 2px;
    }
    .resize-handle.nw::after { top: 4px; left: 4px; }
    .resize-handle.ne::after { top: 4px; right: 4px; }
    .resize-handle.sw::after { bottom: 4px; left: 4px; }
    .resize-handle.se::after { bottom: 4px; right: 4px; }
  `;
  shadow.appendChild(style);

  const wrap = document.createElement("div");
  wrap.className = "wrap";

  // ----- Header -----
  const header = document.createElement("div");
  header.className = "header";
  header.innerHTML = `
    <div class="title"><span class="dot"></span><span id="wpk-info">watch party</span></div>
    <div class="spacer"></div>
    <div class="stats"><span class="fps">-- FPS</span><span class="ping">-- ms</span></div>
    <button class="maximize" title="Maximizar/Restaurar">▢</button>
    <button class="close" title="Fechar overlay">×</button>
  `;
  const infoEl = header.querySelector("#wpk-info") as HTMLDivElement;
  const statsEl = header.querySelector(".stats") as HTMLDivElement;
  const maximizeBtn = header.querySelector(".maximize") as HTMLButtonElement;
  const closeBtn = header.querySelector(".close") as HTMLButtonElement;

  // ----- Video stage -----
  const videoStage = document.createElement("div");
  videoStage.className = "video-stage";
  const screenVideo = document.createElement("video");
  screenVideo.autoplay = true;
  screenVideo.playsInline = true;
  screenVideo.muted = true;
  screenVideo.disablePictureInPicture = true;
  screenVideo.disableRemotePlayback = true;
  (screenVideo as HTMLVideoElement & { preservesPitch?: boolean }).preservesPitch = false;
  videoStage.appendChild(screenVideo);

  const screenAudio = document.createElement("audio");
  screenAudio.autoplay = true;

  // ----- Mute toggle -----
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

  // ----- Resize handles -----
  const handles: Record<"nw" | "ne" | "sw" | "se", HTMLDivElement> = {
    nw: document.createElement("div"),
    ne: document.createElement("div"),
    sw: document.createElement("div"),
    se: document.createElement("div"),
  };
  (Object.keys(handles) as Array<keyof typeof handles>).forEach((k) => {
    handles[k].className = `resize-handle ${k}`;
  });

  wrap.appendChild(videoStage);
  wrap.appendChild(header);
  wrap.appendChild(muteBtn);
  wrap.appendChild(screenAudio);
  wrap.appendChild(handles.nw);
  wrap.appendChild(handles.ne);
  wrap.appendChild(handles.sw);
  wrap.appendChild(handles.se);
  shadow.appendChild(wrap);

  // ----- State + rendering -----
  let state: OverlayState = clampToViewport(initialState);

  function applyState() {
    if (state.mode === "maximized") {
      const player = findKickPlayer();
      let x = 0, y = 0, w = window.innerWidth, h = window.innerHeight;
      if (player) {
        const r = player.getBoundingClientRect();
        x = r.left + window.scrollX;
        y = r.top + window.scrollY;
        w = r.width;
        h = r.height;
      }
      wrap.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      wrap.style.width = `${w}px`;
      wrap.style.height = `${h}px`;
      wrap.classList.add("maximized");
    } else {
      wrap.style.transform = `translate3d(${state.pipX}px, ${state.pipY}px, 0)`;
      wrap.style.width = `${state.pipW}px`;
      wrap.style.height = `${state.pipH}px`;
      wrap.classList.remove("maximized");
    }
    wrap.style.left = "0";
    wrap.style.top = "0";
  }

  let saveTimer: number | undefined;
  function persistSoon() {
    if (saveTimer != null) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => saveState(state), 250);
  }

  applyState();

  // ----- Maximize / restore -----
  function setMode(m: OverlayMode) {
    state = { ...state, mode: m };
    applyState();
    maximizeBtn.textContent = m === "maximized" ? "❐" : "▢";
    maximizeBtn.title = m === "maximized" ? "Restaurar PiP" : "Maximizar";
    persistSoon();
  }

  maximizeBtn.addEventListener("click", () => {
    setMode(state.mode === "maximized" ? "pip" : "maximized");
  });

  // Double-click no header tambem toggleia
  header.addEventListener("dblclick", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    setMode(state.mode === "maximized" ? "pip" : "maximized");
  });

  closeBtn.addEventListener("click", () => destroy());

  // ----- Drag (mover) -----
  let dragging = false;
  let dragStart = { mx: 0, my: 0, sx: 0, sy: 0 };

  header.addEventListener("mousedown", (e) => {
    // Nao inicia drag se clicou num botao
    if ((e.target as HTMLElement).closest("button")) return;
    if (state.mode === "maximized") return; // sem drag em maximized
    dragging = true;
    dragStart = { mx: e.clientX, my: e.clientY, sx: state.pipX, sy: state.pipY };
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const newX = dragStart.sx + (e.clientX - dragStart.mx);
    const newY = dragStart.sy + (e.clientY - dragStart.my);
    state = clampToViewport({ ...state, pipX: newX, pipY: newY });
    applyState();
  });
  window.addEventListener("mouseup", () => {
    if (dragging) { dragging = false; persistSoon(); }
  });

  // ----- Resize (nos 4 cantos, 16:9 lock) -----
  type Corner = "nw" | "ne" | "sw" | "se";
  let resizing: Corner | null = null;
  let resizeStart = { mx: 0, my: 0, sx: 0, sy: 0, sw: 0, sh: 0 };

  function startResize(corner: Corner, e: MouseEvent) {
    if (state.mode === "maximized") return;
    resizing = corner;
    resizeStart = {
      mx: e.clientX, my: e.clientY,
      sx: state.pipX, sy: state.pipY,
      sw: state.pipW, sh: state.pipH,
    };
    e.preventDefault();
    e.stopPropagation();
  }
  handles.nw.addEventListener("mousedown", (e) => startResize("nw", e));
  handles.ne.addEventListener("mousedown", (e) => startResize("ne", e));
  handles.sw.addEventListener("mousedown", (e) => startResize("sw", e));
  handles.se.addEventListener("mousedown", (e) => startResize("se", e));

  window.addEventListener("mousemove", (e) => {
    if (!resizing) return;
    const dx = e.clientX - resizeStart.mx;
    const dy = e.clientY - resizeStart.my;

    // Calcula nova largura baseado no canto. Altura sempre derivada via aspect.
    let newW = resizeStart.sw;
    let newX = resizeStart.sx;
    let newY = resizeStart.sy;

    if (resizing === "se") {
      newW = resizeStart.sw + dx;
    } else if (resizing === "sw") {
      newW = resizeStart.sw - dx;
      newX = resizeStart.sx + dx;
    } else if (resizing === "ne") {
      newW = resizeStart.sw + dx;
    } else if (resizing === "nw") {
      newW = resizeStart.sw - dx;
      newX = resizeStart.sx + dx;
    }

    newW = Math.max(MIN_PIP_W, newW);
    const newH = newW / ASPECT_RATIO;

    // Ajusta Y pros cantos do topo (manter borda oposta fixa).
    if (resizing === "ne" || resizing === "nw") {
      // O canto inferior do retangulo fica fixo
      const fixedBottom = resizeStart.sy + resizeStart.sh;
      newY = fixedBottom - newH;
    }
    // Recalcula X pra SW que comecou de oposto:
    if (resizing === "sw") {
      newX = resizeStart.sx + (resizeStart.sw - newW);
    }
    if (resizing === "nw") {
      newX = resizeStart.sx + (resizeStart.sw - newW);
    }

    state = clampToViewport({ ...state, pipX: newX, pipY: newY, pipW: newW, pipH: newH });
    applyState();
  });
  window.addEventListener("mouseup", () => {
    if (resizing) { resizing = null; persistSoon(); }
  });

  // ----- Viewport resize: clamp PiP + reposiciona se maximizado -----
  const onWindowResize = () => {
    state = clampToViewport(state);
    applyState();
  };
  window.addEventListener("resize", onWindowResize);

  // ----- Quando maximizado, segue o tamanho do player Kick -----
  const ro = new ResizeObserver(() => {
    if (state.mode === "maximized") applyState();
  });
  ro.observe(document.documentElement);

  const playerRoot = findKickPlayer()?.parentElement ?? document.body;
  const mo = new MutationObserver(() => {
    if (state.mode === "maximized") applyState();
  });
  mo.observe(playerRoot, { childList: true, subtree: false, attributes: true, attributeFilter: ["style", "class"] });

  // ----- Stats updater -----
  function updateStats(fps: number, ping: number, dropped = 0, w = 0, h = 0) {
    const fpsSpan = statsEl.querySelector(".fps") as HTMLSpanElement;
    const pingSpan = statsEl.querySelector(".ping") as HTMLSpanElement;
    if (fpsSpan) {
      fpsSpan.textContent = `${fps} FPS${dropped > 0 ? ` (${dropped}↓)` : ""}`;
      fpsSpan.style.color = fps >= 50 ? "#2dd879" : fps >= 30 ? "#f0c040" : "#ff5555";
    }
    if (pingSpan) pingSpan.textContent = `${ping}ms`;
    // res nao mostrado no header novo pra economizar espaco (pode mostrar via title)
    if (w > 0) statsEl.title = `${w}x${h}`;
  }

  function destroy() {
    window.removeEventListener("resize", onWindowResize);
    ro.disconnect();
    mo.disconnect();
    if (saveTimer != null) clearTimeout(saveTimer);
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
