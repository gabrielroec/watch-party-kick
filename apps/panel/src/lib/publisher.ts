// Publisher com canvas COMPOSITE: screen share + webcam PiP desenhados
// no mesmo canvas a 60fps fixo. canvas.captureStream(60) produz UMA track
// de video que ja contem tudo composto.
//
// Por que composite no canvas em vez de 2 tracks:
// - Encoder unico: 100% do budget de encoding pra qualidade alta
// - Viewer recebe 1 track, nao precisa compor nada (zero cross-platform issues)
// - LiveKit so SFU forwards 1 stream por canal, custo de banda menor
// - Cutout/clipPath/mask-image todos sao desnecessarios

import {
  Room,
  RoomEvent,
  LocalVideoTrack,
  LocalAudioTrack,
  Track,
} from "livekit-client";

export type WebcamCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type WebcamSize = "small" | "medium" | "large";

export interface PublisherHandle {
  room: Room;
  startScreenShare: (stream: MediaStream) => Promise<void>;
  stopScreenShare: () => Promise<void>;
  setWebcam: (stream: MediaStream | null) => void;
  setWebcamLayout: (corner: WebcamCorner, size: WebcamSize) => void;
  getPreviewStream: () => MediaStream | null;
  disconnect: () => Promise<void>;
}

interface RateLockState {
  sourceVideo: HTMLVideoElement;
  webcamVideo: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  lockedStream: MediaStream;
  inputStream: MediaStream;
  layout: { corner: WebcamCorner; size: WebcamSize };
  webcamActive: boolean;
  stop: () => void;
}

const TARGET_FPS = 60;
const FRAME_MS = 1000 / TARGET_FPS;
const CANVAS_W = 1920;
const CANVAS_H = 1080;
const PIP_PADDING = 36;
const PIP_SIZE_FRACTION: Record<WebcamSize, number> = {
  small: 0.18,
  medium: 0.25,
  large: 0.34,
};

export async function connectAsPublisher(params: {
  url: string;
  token: string;
}): Promise<PublisherHandle> {
  const room = new Room({
    adaptiveStream: false,
    dynacast: true,
  });

  room.on(RoomEvent.Disconnected, () => {
    console.log("[publisher] desconectado do LiveKit");
  });

  await room.connect(params.url, params.token);

  let screenVideoSid: string | undefined;
  let screenAudioSid: string | undefined;
  let rateLock: RateLockState | null = null;

  async function unpublishBySid(sid: string | undefined) {
    if (!sid) return;
    const pub = Array.from(room.localParticipant.trackPublications.values())
      .find((p) => p.trackSid === sid);
    if (pub?.track) {
      await room.localParticipant.unpublishTrack(pub.track as LocalVideoTrack | LocalAudioTrack);
    }
  }

  async function applyStableParams(
    pub: any,
    opts: { maxBitrate: number; maxFramerate: number },
  ) {
    try {
      const sender: RTCRtpSender | undefined = pub.track?.sender;
      if (!sender) return;
      const p = sender.getParameters();
      p.degradationPreference = "maintain-framerate";
      p.encodings?.forEach((enc) => {
        enc.maxBitrate = opts.maxBitrate;
        enc.maxFramerate = opts.maxFramerate;
        enc.priority = "high";
        enc.networkPriority = "high";
        (enc as RTCRtpEncodingParameters & { scalabilityMode?: string }).scalabilityMode = "L1T3";
        delete enc.scaleResolutionDownBy;
      });
      await sender.setParameters(p);
    } catch (e) {
      console.warn("[publisher] applyStableParams failed", e);
    }
  }

  // Cria o pipeline de canvas com loop rate-locked 60fps. Desenha screen
  // cover-fit + webcam PiP composta no mesmo canvas. Retorna a stream
  // captureStream(60) que vai pro encoder do LiveKit.
  async function makeRateLockedStream(inputStream: MediaStream): Promise<RateLockState> {
    const inputVideo = inputStream.getVideoTracks()[0];
    if (!inputVideo) throw new Error("input stream sem video track");

    const sourceVideo = document.createElement("video");
    sourceVideo.muted = true;
    sourceVideo.playsInline = true;
    sourceVideo.srcObject = new MediaStream([inputVideo]);
    await sourceVideo.play().catch(() => {});

    const webcamVideo = document.createElement("video");
    webcamVideo.muted = true;
    webcamVideo.playsInline = true;
    // srcObject preenchido depois via setWebcam

    await new Promise<void>((resolve) => {
      if (sourceVideo.videoWidth > 0) return resolve();
      sourceVideo.onloadedmetadata = () => resolve();
      setTimeout(() => resolve(), 1500);
    });

    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
      willReadFrequently: false,
    });
    if (!ctx) throw new Error("canvas 2d context indisponivel");

    // Estado de layout do PiP — mutavel via setWebcamLayout sem recriar canvas.
    const layout = { corner: "bottom-right" as WebcamCorner, size: "medium" as WebcamSize };
    const state = {
      sourceVideo, webcamVideo, canvas,
      lockedStream: null as unknown as MediaStream,
      inputStream,
      layout,
      webcamActive: false,
    };

    function computeScreenDraw(): { dx: number; dy: number; dw: number; dh: number } {
      const sw = sourceVideo.videoWidth;
      const sh = sourceVideo.videoHeight;
      if (!sw || !sh) return { dx: 0, dy: 0, dw: CANVAS_W, dh: CANVAS_H };
      const srcAspect = sw / sh;
      const dstAspect = CANVAS_W / CANVAS_H;
      if (srcAspect > dstAspect) {
        const dh = CANVAS_H;
        const dw = dh * srcAspect;
        return { dx: (CANVAS_W - dw) / 2, dy: 0, dw, dh };
      } else {
        const dw = CANVAS_W;
        const dh = dw / srcAspect;
        return { dx: 0, dy: (CANVAS_H - dh) / 2, dw, dh };
      }
    }

    function computeWebcamRect(): { x: number; y: number; w: number; h: number } | null {
      if (!state.webcamActive || webcamVideo.videoWidth === 0) return null;
      const fraction = PIP_SIZE_FRACTION[state.layout.size];
      const aspect = webcamVideo.videoWidth / webcamVideo.videoHeight;
      const w = CANVAS_W * fraction;
      const h = w / aspect;
      const isRight = state.layout.corner.includes("right");
      const isBottom = state.layout.corner.includes("bottom");
      const x = isRight ? CANVAS_W - w - PIP_PADDING : PIP_PADDING;
      const y = isBottom ? CANVAS_H - h - PIP_PADDING : PIP_PADDING;
      return { x, y, w, h };
    }

    let running = true;
    let timerId: number | undefined;
    const startMs = performance.now();
    let n = 0;

    function tick() {
      if (!running) return;

      // Camada 1: screen share full canvas
      if (sourceVideo.videoWidth > 0) {
        const { dx, dy, dw, dh } = computeScreenDraw();
        ctx!.drawImage(sourceVideo, dx, dy, dw, dh);
      }

      // Camada 2: webcam PiP (se ativa)
      const pip = computeWebcamRect();
      if (pip) {
        ctx!.save();
        // Sombra discreta pra destacar do fundo
        ctx!.shadowColor = "rgba(0,0,0,0.6)";
        ctx!.shadowBlur = 20;
        ctx!.shadowOffsetX = 0;
        ctx!.shadowOffsetY = 4;
        ctx!.drawImage(webcamVideo, pip.x, pip.y, pip.w, pip.h);
        ctx!.restore();
        // Borda branca sutil
        ctx!.strokeStyle = "rgba(255,255,255,0.25)";
        ctx!.lineWidth = 3;
        ctx!.strokeRect(pip.x, pip.y, pip.w, pip.h);
      }

      n++;
      const nextTargetMs = startMs + n * FRAME_MS;
      const delay = Math.max(0, nextTargetMs - performance.now());
      timerId = window.setTimeout(tick, delay);
    }
    tick();

    state.lockedStream = canvas.captureStream(TARGET_FPS);

    return {
      ...state,
      stop() {
        running = false;
        if (timerId != null) clearTimeout(timerId);
        state.lockedStream.getTracks().forEach((t) => t.stop());
        sourceVideo.srcObject = null;
        webcamVideo.srcObject = null;
        sourceVideo.remove();
        webcamVideo.remove();
      },
    } as RateLockState;
  }

  async function startScreenShare(inputStream: MediaStream) {
    await stopScreenShare();

    rateLock = await makeRateLockedStream(inputStream);

    const lockedVideoTrack = rateLock.lockedStream.getVideoTracks()[0];
    if (lockedVideoTrack) {
      lockedVideoTrack.contentHint = "detail";

      const lk = new LocalVideoTrack(lockedVideoTrack, undefined, false);
      const pub = await room.localParticipant.publishTrack(lk, {
        name: "wpk-screen",
        source: Track.Source.ScreenShare,
        videoCodec: "vp9",
        backupCodec: { codec: "h264" },
        videoEncoding: {
          maxBitrate: 8_000_000,
          maxFramerate: TARGET_FPS,
          priority: "high" as any,
        },
        scalabilityMode: "L1T3",
        simulcast: false,
        degradationPreference: "maintain-framerate",
      } as any);
      screenVideoSid = pub.trackSid;

      await applyStableParams(pub, {
        maxBitrate: 8_000_000,
        maxFramerate: TARGET_FPS,
      });
    }

    // Audio do screen share publicado separadamente.
    const audioTrack = inputStream.getAudioTracks()[0];
    if (audioTrack) {
      const lk = new LocalAudioTrack(audioTrack, undefined, false);
      const pub = await room.localParticipant.publishTrack(lk, {
        name: "wpk-screen-audio",
        source: Track.Source.ScreenShareAudio,
      });
      screenAudioSid = pub.trackSid;
    }
  }

  async function stopScreenShare() {
    await unpublishBySid(screenVideoSid);
    await unpublishBySid(screenAudioSid);
    screenVideoSid = undefined;
    screenAudioSid = undefined;
    if (rateLock) {
      rateLock.stop();
      rateLock = null;
    }
  }

  function setWebcam(stream: MediaStream | null) {
    if (!rateLock) {
      console.warn("[publisher] setWebcam chamado sem screen share ativo");
      return;
    }
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        rateLock.webcamVideo.srcObject = new MediaStream([videoTrack]);
        rateLock.webcamVideo.play().catch(() => {});
        rateLock.webcamActive = true;
      }
    } else {
      rateLock.webcamVideo.srcObject = null;
      rateLock.webcamActive = false;
    }
  }

  function setWebcamLayout(corner: WebcamCorner, size: WebcamSize) {
    if (!rateLock) return;
    rateLock.layout.corner = corner;
    rateLock.layout.size = size;
  }

  function getPreviewStream(): MediaStream | null {
    return rateLock?.lockedStream ?? null;
  }

  async function disconnect() {
    if (rateLock) {
      rateLock.stop();
      rateLock = null;
    }
    await room.disconnect();
  }

  return {
    room,
    startScreenShare,
    stopScreenShare,
    setWebcam,
    setWebcamLayout,
    getPreviewStream,
    disconnect,
  };
}
