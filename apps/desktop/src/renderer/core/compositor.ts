export type WebcamCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type WebcamSize = "small" | "medium" | "large";

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const FRAME_INTERVAL_MS = 1000 / 60;
const PIP_PADDING = 36;

const SIZE_FRACTION: Record<WebcamSize, number> = {
  small: 0.18,
  medium: 0.25,
  large: 0.34,
};

export interface CompositorLayout {
  corner: WebcamCorner;
  size: WebcamSize;
}

export interface Compositor {
  outputStream: MediaStream;
  // Cria uma NOVA stream do mesmo canvas. Cada consumidor (publisher, recorder)
  // deve receber a sua pra evitar conflito de "single sink" do Chromium.
  createConsumerStream: () => MediaStream;
  setScreen: (stream: MediaStream | null) => void;
  setWebcam: (stream: MediaStream | null) => void;
  setLayout: (layout: CompositorLayout) => void;
  stop: () => void;
}

export function createCompositor(): Compositor {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  // NÃO usar { desynchronized: true } — esse flag faz o canvas usar overlay
  // de baixa latência que bypassa o pipeline de composição. Resultado:
  // canvas.captureStream() não recebe frames e MediaRecorder fica esperando
  // um primeiro frame pra sempre.
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("2d context unavailable");

  const screenVideo = makeHiddenVideo();
  const webcamVideo = makeHiddenVideo();

  let layout: CompositorLayout = { corner: "bottom-right", size: "medium" };
  let screenActive = false;
  let webcamActive = false;
  let running = true;

  const start = performance.now();
  let frame = 0;
  let timerId: number | undefined;

  const tick = (): void => {
    if (!running) return;
    // Always dirty the backing store so canvas.captureStream pushes a frame this
    // tick, mesmo antes das sources carregarem metadata. Sem isso o
    // MediaRecorder.start() pode esperar um primeiro frame que nunca chega.
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    drawScreen(ctx, screenVideo, screenActive);
    drawWebcamPip(ctx, webcamVideo, webcamActive, layout);

    frame++;
    const nextMs = start + frame * FRAME_INTERVAL_MS;
    const delay = Math.max(0, nextMs - performance.now());
    timerId = window.setTimeout(tick, delay);
  };
  tick();

  const outputStream = canvas.captureStream(60);
  const consumerStreams: MediaStream[] = [outputStream];

  return {
    outputStream,
    createConsumerStream: () => {
      const s = canvas.captureStream(60);
      consumerStreams.push(s);
      return s;
    },
    setScreen: (stream) => {
      if (stream) {
        screenVideo.srcObject = stream;
        screenVideo.play().catch((err) => console.warn("[compositor] screen play() failed", err));
        screenActive = true;
      } else {
        screenVideo.srcObject = null;
        screenActive = false;
      }
    },
    setWebcam: (stream) => {
      if (stream) {
        webcamVideo.srcObject = stream;
        webcamVideo.play().catch((err) => console.warn("[compositor] webcam play() failed", err));
        webcamActive = true;
      } else {
        webcamVideo.srcObject = null;
        webcamActive = false;
      }
    },
    setLayout: (next) => { layout = next; },
    stop: () => {
      running = false;
      if (timerId != null) clearTimeout(timerId);
      consumerStreams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      consumerStreams.length = 0;
      screenVideo.srcObject = null;
      webcamVideo.srcObject = null;
    },
  };
}

function makeHiddenVideo(): HTMLVideoElement {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  return v;
}

function drawScreen(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  active: boolean,
): void {
  if (!active || video.videoWidth === 0) return;
  const rect = coverRect(video.videoWidth, video.videoHeight, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.drawImage(video, rect.x, rect.y, rect.w, rect.h);
}

function drawWebcamPip(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  active: boolean,
  layout: CompositorLayout,
): void {
  if (!active || video.videoWidth === 0) return;
  const rect = pipRect(video, layout);

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 4;
  ctx.drawImage(video, rect.x, rect.y, rect.w, rect.h);
  ctx.restore();

  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 3;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
}

function coverRect(srcW: number, srcH: number, dstW: number, dstH: number) {
  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;
  if (srcAspect > dstAspect) {
    const h = dstH;
    const w = h * srcAspect;
    return { x: (dstW - w) / 2, y: 0, w, h };
  }
  const w = dstW;
  const h = w / srcAspect;
  return { x: 0, y: (dstH - h) / 2, w, h };
}

function pipRect(video: HTMLVideoElement, layout: CompositorLayout) {
  const aspect = video.videoWidth / video.videoHeight;
  const w = CANVAS_WIDTH * SIZE_FRACTION[layout.size];
  const h = w / aspect;
  const isRight = layout.corner.includes("right");
  const isBottom = layout.corner.includes("bottom");
  return {
    x: isRight ? CANVAS_WIDTH - w - PIP_PADDING : PIP_PADDING,
    y: isBottom ? CANVAS_HEIGHT - h - PIP_PADDING : PIP_PADDING,
    w,
    h,
  };
}
