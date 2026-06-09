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

  // Aplica params estaveis no sender: bitrate sustentavel + degradation que
  // SACRIFICA resolucao pra manter framerate. "disabled" era o killer principal.
  async function applyStableParams(pub: any, opts: { maxBitrate: number; maxFramerate: number }) {
    try {
      const sender = pub.track?.sender;
      if (!sender) return;
      const params = sender.getParameters();
      if (params.encodings?.[0]) {
        params.encodings[0].maxBitrate = opts.maxBitrate;
        params.encodings[0].maxFramerate = opts.maxFramerate;
        params.encodings[0].scaleResolutionDownBy = 1.0;
        params.degradationPreference = "maintain-framerate";
        await sender.setParameters(params);
      }
    } catch (e) {
      console.warn("[publisher] applyStableParams failed", e);
    }
  }

  async function startScreenShare(stream: MediaStream) {
    await stopScreenShare();

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      // 'detail' otimiza pra texto/UI; "motion" jogaria CPU em blur desnecessario
      videoTrack.contentHint = "detail";

      // Sem 'min' — getDisplayMedia/applyConstraints lancam OverconstrainedError
      // silenciosamente se nao bater, deixando o track em estado degradado.
      await videoTrack.applyConstraints({
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 60 },
      }).catch((e) => console.warn("[publisher] screen applyConstraints failed", e));

      const lk = new LocalVideoTrack(videoTrack, undefined, false);
      const pub = await room.localParticipant.publishTrack(lk, {
        name: "wpk-screen",
        // Source.Camera é hack proposital: contorna o limite de 15fps que o
        // Chromium aplica a ScreenShare. NAO trocar pra ScreenShare.
        source: Track.Source.Camera,
        videoEncoding: { maxBitrate: 8_000_000, maxFramerate: 60 },
        simulcast: false,
      });
      screenVideoSid = pub.trackSid;
      await applyStableParams(pub, { maxBitrate: 8_000_000, maxFramerate: 60 });
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
      await videoTrack.applyConstraints({
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      }).catch((e) => console.warn("[publisher] webcam applyConstraints failed", e));

      const lk = new LocalVideoTrack(videoTrack, undefined, false);
      const pub = await room.localParticipant.publishTrack(lk, {
        name: "wpk-webcam",
        // ScreenShare aqui é proposital — pareado com o swap acima pra
        // diferenciar tracks. A extensao usa o NOME (wpk-webcam) pra rotear.
        source: Track.Source.ScreenShare,
        videoEncoding: { maxBitrate: 2_500_000, maxFramerate: 30 },
        simulcast: false,
      });
      webcamVideoSid = pub.trackSid;
      await applyStableParams(pub, { maxBitrate: 2_500_000, maxFramerate: 30 });
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
