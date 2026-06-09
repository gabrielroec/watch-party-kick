// Publisher dedicado APENAS ao screen share. Webcam foi removida do pipeline:
// 100% do encoder budget vai pro video, FPS estoura, viewer ve a webcam nativa
// da Kick atraves de um cutout no overlay.

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
      const sender = pub.track?.sender;
      if (!sender) return;
      const p = sender.getParameters();
      if (p.encodings?.[0]) {
        p.encodings[0].maxBitrate = opts.maxBitrate;
        p.encodings[0].maxFramerate = opts.maxFramerate;
        p.encodings[0].priority = "high";
        p.encodings[0].networkPriority = "high";
        // maintain-framerate: sob pressao reduz resolucao (1080p -> 720p),
        // nao FPS. Watch party prioriza fluidez.
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
      videoTrack.contentHint = "motion";

      await videoTrack.applyConstraints({
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 60, max: 60 },
      }).catch((e) => console.warn("[publisher] screen applyConstraints failed", e));

      try {
        const settings = videoTrack.getSettings();
        const caps = (videoTrack.getCapabilities?.() ?? {}) as MediaTrackCapabilities;
        console.info("[publisher] screen track caps/settings", {
          surface: (settings as { displaySurface?: string }).displaySurface,
          capsFrameRateMax: (caps as { frameRate?: { max?: number } }).frameRate?.max,
          settingsFrameRate: settings.frameRate,
          settingsWidth: settings.width,
          settingsHeight: settings.height,
        });
      } catch { /* noop */ }

      const lk = new LocalVideoTrack(videoTrack, undefined, false);
      const pub = await room.localParticipant.publishTrack(lk, {
        name: "wpk-screen",
        source: Track.Source.ScreenShare,
        // H264 ativa HW encode no streamer + HW decode no viewer. VP8 nao tem
        // HW decode no desktop e cai em libvpx software ~30fps cap em 1080p.
        videoCodec: "h264",
        videoEncoding: { maxBitrate: 6_000_000, maxFramerate: 60, priority: "high" as any },
        simulcast: false,
      });
      screenVideoSid = pub.trackSid;
      await applyStableParams(pub, { maxBitrate: 6_000_000, maxFramerate: 60 });
    }

    const audioTrack = stream.getAudioTracks()[0];
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
  }

  async function disconnect() {
    await room.disconnect();
  }

  return { room, startScreenShare, stopScreenShare, disconnect };
}
