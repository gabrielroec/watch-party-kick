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
  startWebcam: (stream: MediaStream) => Promise<void>;
  stopWebcam: () => Promise<void>;
  disconnect: () => Promise<void>;
}

// Chromium's BitrateAllocator usa razao 1:2:4:8 entre prioridades very-low/low/
// medium/high. Marcar screen='high' e webcam='very-low' faz o BWE dar 8x mais
// budget pra tela e degradar a webcam primeiro quando aperta — em vez de cortar
// FPS dos dois igualmente (que era o que acontecia).
type TrackKind = "screen" | "webcam";

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
  let webcamVideoSid: string | undefined;
  let webcamAudioSid: string | undefined;

  async function unpublishBySid(sid: string | undefined) {
    if (!sid) return;
    const pub = Array.from(room.localParticipant.trackPublications.values())
      .find((p) => p.trackSid === sid);
    if (pub?.track) {
      await room.localParticipant.unpublishTrack(pub.track as LocalVideoTrack | LocalAudioTrack);
    }
  }

  // Aplica params assimetricos: screen pinada em resolucao (mantem 1080p e
  // sacrifica fps em ultimo caso), webcam sem lock de resolucao (downscala
  // pra 480p/360p se precisar manter framerate). priority='very-low' na
  // webcam faz o BWE retirar bitrate dela ANTES de mexer na screen.
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
        // Web priorities sao mapeadas pelo Chromium pra bitrate weight (1:2:4:8)
        p.encodings[0].priority = opts.kind === "screen" ? "high" : "very-low";
        p.encodings[0].networkPriority = opts.kind === "screen" ? "high" : "very-low";
        if (opts.kind === "screen") {
          // Mantem 1080p mesmo sob pressao — sacrifica fps so se nao tiver jeito
          p.encodings[0].scaleResolutionDownBy = 1.0;
          p.degradationPreference = "maintain-resolution";
        } else {
          // Webcam pode downscalar; o que importa eh nao engasgar
          delete p.encodings[0].scaleResolutionDownBy;
          p.degradationPreference = "maintain-framerate";
        }
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
      videoTrack.contentHint = "detail";

      await videoTrack.applyConstraints({
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 60 },
      }).catch((e) => console.warn("[publisher] screen applyConstraints failed", e));

      const lk = new LocalVideoTrack(videoTrack, undefined, false);
      const pub = await room.localParticipant.publishTrack(lk, {
        name: "wpk-screen",
        source: Track.Source.Camera,
        videoEncoding: { maxBitrate: 8_000_000, maxFramerate: 60, priority: "high" as any },
        simulcast: false,
      });
      screenVideoSid = pub.trackSid;
      await applyStableParams(pub, { kind: "screen", maxBitrate: 8_000_000, maxFramerate: 60 });
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      const lk = new LocalAudioTrack(audioTrack, undefined, false);
      const pub = await room.localParticipant.publishTrack(lk, {
        name: "wpk-screen-audio",
        source: Track.Source.Microphone,
      });
      screenAudioSid = pub.trackSid;
    }
  }

  async function stopScreenShare() {
    await unpublishBySid(screenVideoSid);
    await unpublishBySid(screenAudioSid);
    screenVideoSid = undefined;
    screenAudioSid = undefined;
  }

  async function startWebcam(stream: MediaStream) {
    await stopWebcam();

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.contentHint = "motion";
      // 480p30 corta a area de macroblocks em ~2.25x vs 720p30 e libera CPU
      // do encoder da webcam pra screen encoder. Bitrate proporcional.
      await videoTrack.applyConstraints({
        width: { ideal: 854, max: 854 },
        height: { ideal: 480, max: 480 },
        frameRate: { ideal: 30, max: 30 },
      }).catch((e) => console.warn("[publisher] webcam applyConstraints failed", e));

      const lk = new LocalVideoTrack(videoTrack, undefined, false);
      const pub = await room.localParticipant.publishTrack(lk, {
        name: "wpk-webcam",
        source: Track.Source.ScreenShare,
        videoEncoding: { maxBitrate: 1_200_000, maxFramerate: 30, priority: "very-low" as any },
        simulcast: false,
      });
      webcamVideoSid = pub.trackSid;
      await applyStableParams(pub, { kind: "webcam", maxBitrate: 1_200_000, maxFramerate: 30 });
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      const lk = new LocalAudioTrack(audioTrack, undefined, false);
      const pub = await room.localParticipant.publishTrack(lk, {
        name: "wpk-webcam-audio",
        source: Track.Source.ScreenShareAudio,
      });
      webcamAudioSid = pub.trackSid;
    }
  }

  async function stopWebcam() {
    await unpublishBySid(webcamVideoSid);
    await unpublishBySid(webcamAudioSid);
    webcamVideoSid = undefined;
    webcamAudioSid = undefined;
  }

  async function disconnect() {
    await room.disconnect();
  }

  return { room, startScreenShare, stopScreenShare, startWebcam, stopWebcam, disconnect };
}
