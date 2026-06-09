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
    dynacast: false,
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

  async function forceMaxParams(pub: any) {
    try {
      const sender = pub.track?.sender;
      if (!sender) return;
      const params = sender.getParameters();
      if (params.encodings?.[0]) {
        params.encodings[0].maxBitrate = 15_000_000;
        params.encodings[0].maxFramerate = 120;
        params.encodings[0].scaleResolutionDownBy = 1.0;
        params.degradationPreference = "disabled";
        delete params.encodings[0].adaptivePtime;
        await sender.setParameters(params);
      }
    } catch {}
  }

  async function startScreenShare(stream: MediaStream) {
    await stopScreenShare();

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.contentHint = "motion";
      await videoTrack.applyConstraints({
        width: { ideal: 1920, min: 1280 },
        height: { ideal: 1080, min: 720 },
        frameRate: { ideal: 120, min: 60 },
      }).catch(() => {});

      const lk = new LocalVideoTrack(videoTrack, undefined, false);
      const pub = await room.localParticipant.publishTrack(lk, {
        name: "wpk-screen",
        source: Track.Source.Camera,
        videoEncoding: { maxBitrate: 15_000_000, maxFramerate: 120 },
        simulcast: false,
      });
      screenVideoSid = pub.trackSid;
      await forceMaxParams(pub);
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
        width: { ideal: 1280, min: 720 },
        height: { ideal: 720, min: 480 },
        frameRate: { ideal: 60, min: 30 },
      }).catch(() => {});

      const lk = new LocalVideoTrack(videoTrack, undefined, false);
      const pub = await room.localParticipant.publishTrack(lk, {
        name: "wpk-webcam",
        source: Track.Source.ScreenShare,
        videoEncoding: { maxBitrate: 5_000_000, maxFramerate: 60 },
        simulcast: false,
      });
      webcamVideoSid = pub.trackSid;
      await forceMaxParams(pub);
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
