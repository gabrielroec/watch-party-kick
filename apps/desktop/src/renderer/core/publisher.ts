import {
  Room,
  RoomEvent,
  LocalVideoTrack,
  LocalAudioTrack,
  Track,
} from "livekit-client";

const VIDEO_BITRATE = 8_000_000;
const VIDEO_FRAMERATE = 60;

export interface Publisher {
  publishVideo: (track: MediaStreamTrack) => Promise<void>;
  publishAudio: (track: MediaStreamTrack) => Promise<void>;
  unpublishAll: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export async function connectPublisher(url: string, token: string): Promise<Publisher> {
  const room = new Room({ adaptiveStream: false, dynacast: true });

  room.on(RoomEvent.Disconnected, () => {
    console.log("[publisher] disconnected");
  });

  await room.connect(url, token);

  let videoSid: string | undefined;
  let audioSid: string | undefined;

  const publishVideo = async (track: MediaStreamTrack): Promise<void> => {
    track.contentHint = "detail";
    const lk = new LocalVideoTrack(track, undefined, false);
    const publication = await room.localParticipant.publishTrack(lk, {
      name: "wpk-screen",
      source: Track.Source.ScreenShare,
      videoCodec: "vp9",
      backupCodec: { codec: "h264" },
      videoEncoding: {
        maxBitrate: VIDEO_BITRATE,
        maxFramerate: VIDEO_FRAMERATE,
        priority: "high" as any,
      },
      scalabilityMode: "L1T3",
      simulcast: false,
      degradationPreference: "maintain-framerate",
    } as any);
    videoSid = publication.trackSid;
    await tuneSender(publication);
  };

  const publishAudio = async (track: MediaStreamTrack): Promise<void> => {
    const lk = new LocalAudioTrack(track, undefined, false);
    const publication = await room.localParticipant.publishTrack(lk, {
      name: "wpk-screen-audio",
      source: Track.Source.ScreenShareAudio,
    });
    audioSid = publication.trackSid;
  };

  const unpublishAll = async (): Promise<void> => {
    await unpublishBySid(room, videoSid);
    await unpublishBySid(room, audioSid);
    videoSid = undefined;
    audioSid = undefined;
  };

  const disconnect = async (): Promise<void> => {
    await room.disconnect();
  };

  return { publishVideo, publishAudio, unpublishAll, disconnect };
}

async function unpublishBySid(room: Room, sid: string | undefined): Promise<void> {
  if (!sid) return;
  const pub = Array.from(room.localParticipant.trackPublications.values())
    .find((p) => p.trackSid === sid);
  if (pub?.track) {
    await room.localParticipant.unpublishTrack(pub.track as LocalVideoTrack | LocalAudioTrack);
  }
}

async function tuneSender(publication: { track?: { sender?: RTCRtpSender } }): Promise<void> {
  const sender = publication.track?.sender;
  if (!sender) return;
  const params = sender.getParameters();
  params.degradationPreference = "maintain-framerate";
  params.encodings?.forEach((enc) => {
    enc.maxBitrate = VIDEO_BITRATE;
    enc.maxFramerate = VIDEO_FRAMERATE;
    enc.priority = "high";
    enc.networkPriority = "high";
    (enc as RTCRtpEncodingParameters & { scalabilityMode?: string }).scalabilityMode = "L1T3";
    delete enc.scaleResolutionDownBy;
  });
  await sender.setParameters(params);
}
