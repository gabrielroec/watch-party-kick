// Publisher com RATE-LOCK CLIENT-SIDE: o stream de getDisplayMedia (que o
// Chrome pode capar em 30fps pra window/screen) e renderizado num <canvas>
// off-DOM a 60Hz fixo (drift-corrected setTimeout); canvas.captureStream(60)
// produz uma MediaStream que emite sempre 60fps independente do source rate.
//
// Codec: VP9 (LiveKit pina H264 em profile 42e01f que cai pra 720p — origem
// da regressao de qualidade reportada). VP9 nao tem ceiling, ~50% mais
// eficiente que H264 em screen content. backupCodec h264 pra fallback.
//
// scalabilityMode L1T3: SVC temporal de 3 camadas (sem downscale espacial).
// Sob pressao o encoder dropa frames altos sem mexer na resolucao,
// mantendo 1080p estavel.

import {
  Room,
  RoomEvent,
  LocalVideoTrack,
  LocalAudioTrack,
  Track,
} from "livekit-client";

export interface PublisherHandle {
  room: Room;
  startScreenShare: (stream: MediaStream) => Promise<void>;
  stopScreenShare: () => Promise<void>;
  disconnect: () => Promise<void>;
}

interface RateLockState {
  sourceVideo: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  lockedStream: MediaStream;
  inputStream: MediaStream;
  stop: () => void;
}

const TARGET_FPS = 60;
const FRAME_MS = 1000 / TARGET_FPS;

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

  // Cria o pipeline canvas rate-lock e retorna a stream forcada em 60fps.
  // O canvas roda em loop de setTimeout drift-corrected (rAF nao funciona
  // confiavelmente em background — mas mesmo foreground, rAF segue refresh
  // do display que pode nao ser 60Hz).
  async function makeRateLockedStream(inputStream: MediaStream): Promise<RateLockState> {
    const inputVideo = inputStream.getVideoTracks()[0];
    if (!inputVideo) throw new Error("input stream sem video track");

    const sourceVideo = document.createElement("video");
    sourceVideo.muted = true;
    sourceVideo.playsInline = true;
    sourceVideo.srcObject = new MediaStream([inputVideo]);
    await sourceVideo.play().catch(() => {});

    // Espera metadata pra saber dimensoes reais do source.
    await new Promise<void>((resolve) => {
      if (sourceVideo.videoWidth > 0) return resolve();
      sourceVideo.onloadedmetadata = () => resolve();
      // Fallback timeout pra nao travar
      setTimeout(() => resolve(), 1500);
    });

    // Canvas SEMPRE 1920x1080 (16:9) independente do source. Source e
    // desenhado com cover-fit (preserva aspect, crop center pra preencher).
    // Resultado: video publicado e 16:9 e bate com aspect do player Kick,
    // viewer recebe imagem que enche 100% sem letterbox.
    const CANVAS_W = 1920;
    const CANVAS_H = 1080;
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
      willReadFrequently: false,
    });
    if (!ctx) throw new Error("canvas 2d context indisponivel");

    // Computa dimensoes cover-fit do source dentro do canvas 16:9.
    function computeCoverDraw(): { dx: number; dy: number; dw: number; dh: number } {
      const sw = sourceVideo.videoWidth;
      const sh = sourceVideo.videoHeight;
      if (!sw || !sh) return { dx: 0, dy: 0, dw: CANVAS_W, dh: CANVAS_H };
      const srcAspect = sw / sh;
      const dstAspect = CANVAS_W / CANVAS_H;
      if (srcAspect > dstAspect) {
        // Source mais largo que 16:9 — recorta laterais
        const dh = CANVAS_H;
        const dw = dh * srcAspect;
        return { dx: (CANVAS_W - dw) / 2, dy: 0, dw, dh };
      } else {
        // Source mais alto que 16:9 — recorta topo/base
        const dw = CANVAS_W;
        const dh = dw / srcAspect;
        return { dx: 0, dy: (CANVAS_H - dh) / 2, dw, dh };
      }
    }

    let running = true;
    let timerId: number | undefined;
    const startMs = performance.now();
    let n = 0;

    function tick() {
      if (!running) return;
      if (sourceVideo.videoWidth > 0) {
        const { dx, dy, dw, dh } = computeCoverDraw();
        ctx!.drawImage(sourceVideo, dx, dy, dw, dh);
      }
      n++;
      const nextTargetMs = startMs + n * FRAME_MS;
      const delay = Math.max(0, nextTargetMs - performance.now());
      timerId = window.setTimeout(tick, delay);
    }
    tick();

    const lockedStream = canvas.captureStream(TARGET_FPS);

    function stop() {
      running = false;
      if (timerId != null) clearTimeout(timerId);
      lockedStream.getTracks().forEach((t) => t.stop());
      sourceVideo.srcObject = null;
      sourceVideo.remove();
    }

    return { sourceVideo, canvas, lockedStream, inputStream, stop };
  }

  async function startScreenShare(inputStream: MediaStream) {
    await stopScreenShare();

    rateLock = await makeRateLockedStream(inputStream);

    const lockedVideoTrack = rateLock.lockedStream.getVideoTracks()[0];
    if (lockedVideoTrack) {
      // 'detail' preserva sharpness de texto/UI (importante pra screen).
      lockedVideoTrack.contentHint = "detail";

      const lk = new LocalVideoTrack(lockedVideoTrack, undefined, false);
      const pub = await room.localParticipant.publishTrack(lk, {
        name: "wpk-screen",
        // ScreenShare proper agora que o rate-lock canvas resolve o cap
        // de fps independente do source label.
        source: Track.Source.ScreenShare,
        // VP9 nao tem o cap silencioso de 720p que H264 sofre no LiveKit
        // (profile 42e01f). ~50% mais eficiente em screen content.
        videoCodec: "vp9",
        // Fallback pra viewers em Safari ou hardware sem VP9 decoder.
        backupCodec: { codec: "h264" },
        videoEncoding: {
          maxBitrate: 8_000_000,
          maxFramerate: TARGET_FPS,
          priority: "high" as any,
        },
        // SVC temporal 3 camadas — sob pressao o encoder dropa frames altos
        // sem mexer na resolucao, 1080p estavel.
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

    // Audio passa direto sem rate-lock (audio nao tem esse problema).
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

  async function disconnect() {
    if (rateLock) {
      rateLock.stop();
      rateLock = null;
    }
    await room.disconnect();
  }

  return { room, startScreenShare, stopScreenShare, disconnect };
}
