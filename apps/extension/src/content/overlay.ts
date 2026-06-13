const HOST_ID = "wpk-overlay-host";
const STORAGE_KEY = "wpk:window";

const ASPECT_RATIO = 16 / 9;
const MIN_WIDTH = 320;
const MARGIN = 16;
const DEFAULT_WIDTH = 480;

type Corner = "nw" | "ne" | "sw" | "se";

export interface WindowState {
  x: number;
  y: number;
  width: number;
}

export interface Overlay {
  videoEl: HTMLVideoElement;
  audioEl: HTMLAudioElement;
  setTitle: (text: string) => void;
  setStats: (fps: number, ping: number) => void;
  destroy: () => void;
}

const defaultState = (): WindowState => ({
  x: window.innerWidth - DEFAULT_WIDTH - MARGIN,
  y: MARGIN,
  width: DEFAULT_WIDTH,
});

const clamp = (s: WindowState): WindowState => {
  const w = Math.max(MIN_WIDTH, Math.min(s.width, window.innerWidth - MARGIN * 2));
  const h = w / ASPECT_RATIO;
  const x = Math.max(MARGIN, Math.min(s.x, window.innerWidth - w - MARGIN));
  const y = Math.max(MARGIN, Math.min(s.y, window.innerHeight - h - MARGIN));
  return { x, y, width: w };
};

const loadState = (): Promise<WindowState> =>
  new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (res) => {
      const stored = res?.[STORAGE_KEY] as WindowState | undefined;
      resolve(stored ? clamp(stored) : defaultState());
    });
  });

const saveState = (s: WindowState) => {
  chrome.storage.local.set({ [STORAGE_KEY]: s });
};

export async function createOverlay(): Promise<Overlay> {
  document.getElementById(HOST_ID)?.remove();

  let state = await loadState();

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "all: initial; position: fixed; z-index: 2147483600; inset: 0; pointer-events: none;";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  shadow.appendChild(makeStyle());
  const wrap = makeWrap();
  const header = makeHeader();
  const videoEl = makeVideo();
  const audioEl = makeAudio();
  const muteBtn = makeMuteButton(audioEl);
  const handles = makeResizeHandles();

  wrap.appendChild(videoEl);
  wrap.appendChild(audioEl);
  wrap.appendChild(header.root);
  wrap.appendChild(muteBtn);
  handles.forEach((h) => wrap.appendChild(h.el));
  shadow.appendChild(wrap);

  const render = () => {
    state = clamp(state);
    const height = state.width / ASPECT_RATIO;
    wrap.style.transform = `translate3d(${state.x}px, ${state.y}px, 0)`;
    wrap.style.width = `${state.width}px`;
    wrap.style.height = `${height}px`;
  };

  render();

  let saveTimer: number | undefined;
  const scheduleSave = () => {
    if (saveTimer != null) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => saveState(state), 200);
  };

  const onResize = () => render();
  window.addEventListener("resize", onResize);

  attachDrag(header.root, state, (next) => {
    state = next;
    render();
    scheduleSave();
  });

  handles.forEach(({ el, corner }) => {
    attachResize(el, corner, () => state, (next) => {
      state = next;
      render();
      scheduleSave();
    });
  });

  const close = () => {
    window.removeEventListener("resize", onResize);
    if (saveTimer != null) clearTimeout(saveTimer);
    host.remove();
  };
  header.closeBtn.addEventListener("click", close);

  return {
    videoEl,
    audioEl,
    setTitle: (text) => { header.titleEl.textContent = text; },
    setStats: (fps, ping) => {
      header.fpsEl.textContent = `${fps} FPS`;
      header.fpsEl.style.color = fps >= 50 ? "#2dd879" : fps >= 30 ? "#f0c040" : "#ff5555";
      header.pingEl.textContent = `${ping} ms`;
    },
    destroy: close,
  };
}

// ---------- DOM factories ----------

const makeStyle = (): HTMLStyleElement => {
  const style = document.createElement("style");
  style.textContent = `
    :host, * { box-sizing: border-box; }
    .wrap {
      position: fixed; left: 0; top: 0;
      background: #0a0b0f; color: #fff;
      border-radius: 12px; overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      box-shadow: 0 16px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06);
      pointer-events: auto;
      contain: layout style;
      will-change: transform, width, height;
    }
    .header {
      position: absolute; top: 0; left: 0; right: 0; height: 36px;
      display: flex; align-items: center; gap: 10px; padding: 0 10px 0 14px;
      background: linear-gradient(180deg, rgba(0,0,0,0.85), rgba(0,0,0,0));
      z-index: 3; cursor: move; user-select: none;
    }
    .header .title {
      display: flex; align-items: center; gap: 6px;
      font-size: 12px; font-weight: 600;
    }
    .header .dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #2dd879; box-shadow: 0 0 8px #2dd879;
    }
    .header .spacer { flex: 1; }
    .header .stats {
      display: flex; gap: 8px; padding: 3px 9px;
      background: rgba(0,0,0,0.6); border-radius: 999px;
      font-size: 11px; font-family: ui-monospace, monospace;
    }
    .header .stats .fps { color: #2dd879; }
    .header .stats .ping { color: #f0c040; }
    .header .close {
      width: 28px; height: 28px; border-radius: 6px;
      background: rgba(255,255,255,0.08); color: #fff; border: 0;
      cursor: pointer; font-size: 13px;
    }
    .header .close:hover { background: rgba(255,60,60,0.85); }
    video {
      display: block; width: 100%; height: 100%;
      object-fit: cover; background: #000;
    }
    .mute {
      position: absolute; bottom: 10px; left: 10px;
      padding: 6px 12px; border-radius: 8px;
      background: rgba(0,0,0,0.7); color: #fff; border: 0;
      cursor: pointer; font-size: 12px; z-index: 3;
    }
    .mute:hover { background: rgba(0,0,0,0.9); }
    .handle {
      position: absolute; width: 16px; height: 16px; z-index: 4;
    }
    .handle.nw { top: 0; left: 0; cursor: nwse-resize; }
    .handle.ne { top: 0; right: 0; cursor: nesw-resize; }
    .handle.sw { bottom: 0; left: 0; cursor: nesw-resize; }
    .handle.se { bottom: 0; right: 0; cursor: nwse-resize; }
    .wrap:hover .handle::after {
      content: ""; position: absolute; width: 8px; height: 8px;
      background: rgba(45,216,121,0.85); border-radius: 2px;
    }
    .handle.nw::after { top: 4px; left: 4px; }
    .handle.ne::after { top: 4px; right: 4px; }
    .handle.sw::after { bottom: 4px; left: 4px; }
    .handle.se::after { bottom: 4px; right: 4px; }
  `;
  return style;
};

const makeWrap = (): HTMLDivElement => {
  const wrap = document.createElement("div");
  wrap.className = "wrap";
  return wrap;
};

interface Header {
  root: HTMLDivElement;
  titleEl: HTMLSpanElement;
  fpsEl: HTMLSpanElement;
  pingEl: HTMLSpanElement;
  closeBtn: HTMLButtonElement;
}

const makeHeader = (): Header => {
  const root = document.createElement("div");
  root.className = "header";
  root.innerHTML = `
    <div class="title"><span class="dot"></span><span class="text">watch party</span></div>
    <div class="spacer"></div>
    <div class="stats"><span class="fps">-- FPS</span><span class="ping">-- ms</span></div>
    <button class="close" title="Fechar">×</button>
  `;
  return {
    root,
    titleEl: root.querySelector(".title .text") as HTMLSpanElement,
    fpsEl: root.querySelector(".stats .fps") as HTMLSpanElement,
    pingEl: root.querySelector(".stats .ping") as HTMLSpanElement,
    closeBtn: root.querySelector(".close") as HTMLButtonElement,
  };
};

const makeVideo = (): HTMLVideoElement => {
  const v = document.createElement("video");
  v.autoplay = true;
  v.playsInline = true;
  v.muted = true;
  v.disablePictureInPicture = true;
  v.disableRemotePlayback = true;
  return v;
};

const makeAudio = (): HTMLAudioElement => {
  const a = document.createElement("audio");
  a.autoplay = true;
  return a;
};

const makeMuteButton = (audio: HTMLAudioElement): HTMLButtonElement => {
  const btn = document.createElement("button");
  btn.className = "mute";
  btn.textContent = "🔇 Som: OFF";
  let muted = true;
  btn.addEventListener("click", () => {
    muted = !muted;
    audio.muted = muted;
    btn.textContent = muted ? "🔇 Som: OFF" : "🔊 Som: ON";
  });
  return btn;
};

const makeResizeHandles = (): Array<{ el: HTMLDivElement; corner: Corner }> => {
  return (["nw", "ne", "sw", "se"] as Corner[]).map((corner) => {
    const el = document.createElement("div");
    el.className = `handle ${corner}`;
    return { el, corner };
  });
};

// ---------- Interactions ----------

const attachDrag = (
  handle: HTMLElement,
  initial: WindowState,
  onChange: (next: WindowState) => void,
) => {
  let active = false;
  let startMx = 0, startMy = 0, startX = 0, startY = 0;

  handle.addEventListener("mousedown", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    active = true;
    startMx = e.clientX;
    startMy = e.clientY;
    startX = initial.x;
    startY = initial.y;
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!active) return;
    onChange({
      ...initial,
      x: startX + (e.clientX - startMx),
      y: startY + (e.clientY - startMy),
    });
  });

  window.addEventListener("mouseup", () => { active = false; });
};

const attachResize = (
  handle: HTMLElement,
  corner: Corner,
  getCurrent: () => WindowState,
  onChange: (next: WindowState) => void,
) => {
  let active = false;
  let startMx = 0, startMy = 0;
  let start = { x: 0, y: 0, width: 0, height: 0 };

  handle.addEventListener("mousedown", (e) => {
    active = true;
    startMx = e.clientX;
    startMy = e.clientY;
    const current = getCurrent();
    start = { x: current.x, y: current.y, width: current.width, height: current.width / ASPECT_RATIO };
    e.preventDefault();
    e.stopPropagation();
  });

  window.addEventListener("mousemove", (e) => {
    if (!active) return;

    const dx = e.clientX - startMx;
    let newWidth = start.width;
    let newX = start.x;
    let newY = start.y;

    if (corner === "se" || corner === "ne") newWidth = start.width + dx;
    if (corner === "sw" || corner === "nw") {
      newWidth = start.width - dx;
      newX = start.x + dx;
    }

    newWidth = Math.max(MIN_WIDTH, newWidth);
    const newHeight = newWidth / ASPECT_RATIO;

    if (corner === "ne" || corner === "nw") {
      const fixedBottom = start.y + start.height;
      newY = fixedBottom - newHeight;
    }
    if (corner === "sw" || corner === "nw") {
      newX = start.x + (start.width - newWidth);
    }

    onChange({ x: newX, y: newY, width: newWidth });
  });

  window.addEventListener("mouseup", () => { active = false; });
};
