// Dois Rooms LiveKit independentes (screenRoom + camRoom) conectados no MESMO
// roomCode usando identidades distintas (host-<nonce> e cam-<nonce>).
// Cada Room tem seu proprio PeerConnection => congestion controllers separados,
// uplink da webcam nao rouba banda da screen. WS de controle continua usando
// apenas a identidade MAIN; cam e LiveKit-only.

import {
  Room,
  RoomEvent,
  LocalVideoTrack,
  LocalAudioTrack,
  Track,
} from "livekit-client";

export interface PublisherHandle {
  screenRoom: Room;
  camRoom: Room | null;
  startScreenShare: (stream: MediaStream) => Promise<void>;
  stopScreenShare: () => Promise<void>;
  startWebcam: (stream: MediaStream) => Promise<void>;
  stopWebcam: () => Promise<void>;
  disconnect: () => Promise<void>;
}

type TrackKind = "screen" | "webcam";

export async function connectAsPublisher(params: {
  url: string;
  screenToken: string;
  getCamToken: () => Promise<string>;
  eagerCam?: boolean;
}): Promise<PublisherHandle> {
  // ---- screenRoom: PC dedicado pra screen-share ----
  const screenRoom = new Room({
    adaptiveStream: false,
    dynacast: true,
  });
  screenRoom.on(RoomEvent.Disconnected, () => {
    console.log("[publisher] screenRoom desconectado");
  });
  await screenRoom.connect(params.url, params.screenToken);

  // ---- camRoom: PC dedicado pra webcam (lazy por padrao) ----
  let camRoom: Room | null = null;
  let camConnectInFlight: Promise<Room> | null = null;

  async function ensureCamRoom(): Promise<Room> {
    if (camRoom) return camRoom;
    if (camConnectInFlight) return camConnectInFlight;
    camConnectInFlight = (async () => {
      const token = await params.getCamToken();
      const r = new Room({
        adaptiveStream: false,
        dynacast: false,
      });
      r.on(RoomEvent.Disconnected, () => {
        console.log("[publisher] camRoom desconectado");
      });
      await r.connect(params.url, token);
      camRoom = r;
      return r;
    })();
    try {
      return await camConnectInFlight;
    } finally {
      camConnectInFlight = null;
    }
  }

  if (params.eagerCam) {
    ensureCamRoom().catch((e) => console.warn("[publisher] eager cam connect failed", e));
  }

  let screenVideoSid: string | undefined;
  let screenAudioSid: string | undefined;
  let webcamVideoSid: string | undefined;
  let webcamAudioSid: string | undefined;

  async function unpublishBySid(r: Room, sid: string | undefined) {
    if (!sid) return;
    const pub = Array.from(r.localParticipant.trackPublications.values())
      .find((p) => p.trackSid === sid);
    if (pub?.track) {
      await r.localParticipant.unpublishTrack(pub.track as LocalVideoTrack | LocalAudioTrack);
    }
  }

  // Cada Room tem seu proprio congestion controller. Ainda assim mantemos
  // degradationPreference: maintain-resolution na screen (preserva 1080p sob
  // pressao) e maintain-framerate na webcam (deixa downscalar 480p->360p).
  async function applyStableParams(
    pub: any,
    opts: { kind: TrackKind; maxBitrate: number; maxFramerate: number },
  ) {
    try {
      const sender = pub.track?.sender;
      if (!sender) return;
      const p = sender.getParameters();
      if (p.encodings?.[0]) {
        p.encodings[0].maxBitrate = opts.maxBitrate;
        p.encodings[0].maxFramerate = opts.maxFramerate;
        p.encodings[0].priority = opts.kind === "screen" ? "high" : "low";
        p.encodings[0].networkPriority = opts.kind === "screen" ? "high" : "low";
        // maintain-framerate em ambos: sob pressao o encoder reduz resolucao
        // (1080p -> 900p -> 720p) ao inves de cortar FPS. Watch party prioriza
        // fluidez sobre nitidez de texto.
        delete p.encodings[0].scaleResolutionDownBy;
        p.degradationPreference = "maintain-framerate";
        await sender.setParameters(p);
      }
    } catch (e) {
      console.warn("[publisher] applyStableParams failed", e);
    }
  }

  async function startScreenShare(stream: MediaStream) {
    await stopScreenShare();

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      // 'motion' biases rate control pra fluidez (60fps) ao inves de nitidez
      // de texto. Pra watch party (videos/games) e o correto.
      videoTrack.contentHint = "motion";

      await videoTrack.applyConstraints({
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 60, max: 60 },
      }).catch((e) => console.warn("[publisher] screen applyConstraints failed", e));

      // Diagnostico: se frameRate.max reportar 30, o usuario escolheu uma
      // janela/tela e bateu no cap de 30fps do DesktopCaptureDevice do
      // Chrome. Pra exceder, precisa compartilhar uma ABA do Chrome.
      try {
        const caps = (videoTrack.getCapabilities?.() ?? {}) as MediaTrackCapabilities;
        const settings = videoTrack.getSettings();
        console.info("[publisher] screen track caps/settings", {
          surface: (settings as { displaySurface?: string }).displaySurface,
          capsFrameRateMax: (caps as { frameRate?: { max?: number } }).frameRate?.max,
          settingsFrameRate: settings.frameRate,
          settingsWidth: settings.width,
          settingsHeight: settings.height,
        });
      } catch { /* noop */ }

      const lk = new LocalVideoTrack(videoTrack, undefined, false);
      const pub = await screenRoom.localParticipant.publishTrack(lk, {
        name: "wpk-screen",
        source: Track.Source.ScreenShare,
        // H264 ativa HARDWARE encode (VideoToolbox/MFT/VA-API) E decode
        // no viewer (libvpx VP8 nao tem HW decode no desktop). Diferenca
        // gigante: CPU encode cai ~70%, viewer decode cai similarmente.
        videoCodec: "h264",
        videoEncoding: { maxBitrate: 6_000_000, maxFramerate: 60, priority: "high" as any },
        simulcast: false,
      });
      screenVideoSid = pub.trackSid;
      await applyStableParams(pub, { kind: "screen", maxBitrate: 6_000_000, maxFramerate: 60 });
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      const lk = new LocalAudioTrack(audioTrack, undefined, false);
      const pub = await screenRoom.localParticipant.publishTrack(lk, {
        name: "wpk-screen-audio",
        source: Track.Source.ScreenShareAudio,
      });
      screenAudioSid = pub.trackSid;
    }
  }

  async function stopScreenShare() {
    await unpublishBySid(screenRoom, screenVideoSid);
    await unpublishBySid(screenRoom, screenAudioSid);
    screenVideoSid = undefined;
    screenAudioSid = undefined;
  }

  async function startWebcam(stream: MediaStream) {
    await stopWebcam();

    // Lazy connect: 1a chamada paga ICE/DTLS, subsequentes reusam o Room.
    const r = await ensureCamRoom();

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.contentHint = "motion";
      await videoTrack.applyConstraints({
        width: { ideal: 854, max: 854 },
        height: { ideal: 480, max: 480 },
        frameRate: { ideal: 30, max: 30 },
      }).catch((e) => console.warn("[publisher] webcam applyConstraints failed", e));

      const lk = new LocalVideoTrack(videoTrack, undefined, false);
      const pub = await r.localParticipant.publishTrack(lk, {
        name: "wpk-webcam",
        source: Track.Source.Camera,
        videoEncoding: { maxBitrate: 1_200_000, maxFramerate: 30, priority: "low" as any },
        simulcast: false,
      });
      webcamVideoSid = pub.trackSid;
      await applyStableParams(pub, { kind: "webcam", maxBitrate: 1_200_000, maxFramerate: 30 });
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      const lk = new LocalAudioTrack(audioTrack, undefined, false);
      const pub = await r.localParticipant.publishTrack(lk, {
        name: "wpk-webcam-audio",
        source: Track.Source.Microphone,
      });
      webcamAudioSid = pub.trackSid;
    }
  }

  async function stopWebcam() {
    if (!camRoom) {
      webcamVideoSid = undefined;
      webcamAudioSid = undefined;
      return;
    }
    await unpublishBySid(camRoom, webcamVideoSid);
    await unpublishBySid(camRoom, webcamAudioSid);
    webcamVideoSid = undefined;
    webcamAudioSid = undefined;
    // Desconecta o camRoom pra que a identidade cam-<nonce> saia da sala
    // LiveKit. Proxima chamada de startWebcam paga handshake novo.
    try {
      await camRoom.disconnect();
    } catch (e) {
      console.warn("[publisher] camRoom disconnect failed", e);
    }
    camRoom = null;
  }

  async function disconnect() {
    await Promise.allSettled([
      screenRoom.disconnect(),
      camRoom ? camRoom.disconnect() : Promise.resolve(),
    ]);
    camRoom = null;
  }

  return {
    screenRoom,
    get camRoom() { return camRoom; },
    startScreenShare,
    stopScreenShare,
    startWebcam,
    stopWebcam,
    disconnect,
  } as PublisherHandle;
}
