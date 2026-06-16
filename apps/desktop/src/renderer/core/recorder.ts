// MediaRecorder do canvas + audio mix com upload em chunks pro backend.
// Cada `timeslice` segundos, o blob vai num POST /api/recordings/:id/chunk.
// Quando o usuário para, chamamos finish.

import type { StartRecordingResponse, FinishRecordingResponse } from "@wpk/shared";

const TIMESLICE_MS = 2000;
const MIME_PRIORITY = [
  'video/webm; codecs="vp9,opus"',
  'video/webm; codecs="vp8,opus"',
  "video/webm",
];

function pickMimeType(): string {
  for (const m of MIME_PRIORITY) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

export interface RecorderConfig {
  backendUrl: string;
  streamerSlug: string;
  streamerKey: string;
  roomCode: string;
  title?: string;
  videoStream: MediaStream;
  audioTrack: MediaStreamTrack | null;
}

export interface ActiveRecording {
  id: string;
  stop: () => Promise<FinishRecordingResponse>;
  abort: () => Promise<void>;
}

export async function startRecording(cfg: RecorderConfig): Promise<ActiveRecording> {
  const startResp = await fetch(`${cfg.backendUrl}/api/recordings/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      streamerKey: cfg.streamerKey,
      streamerSlug: cfg.streamerSlug,
      roomCode: cfg.roomCode,
      title: cfg.title,
    }),
  });
  if (!startResp.ok) {
    throw new Error(`start falhou (${startResp.status})`);
  }
  const { id } = (await startResp.json()) as StartRecordingResponse;

  const composite = new MediaStream();
  cfg.videoStream.getVideoTracks().forEach((t) => composite.addTrack(t));
  if (cfg.audioTrack) composite.addTrack(cfg.audioTrack);

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(
    composite,
    mimeType ? { mimeType, videoBitsPerSecond: 6_000_000 } : { videoBitsPerSecond: 6_000_000 },
  );

  const uploadQueue: Promise<void>[] = [];

  const uploadChunk = async (blob: Blob): Promise<void> => {
    if (blob.size === 0) return;
    const resp = await fetch(`${cfg.backendUrl}/api/recordings/${id}/chunk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "x-streamer-slug": cfg.streamerSlug,
        "x-streamer-key": cfg.streamerKey,
      },
      body: blob,
    });
    if (!resp.ok) {
      throw new Error(`chunk upload falhou ${resp.status}`);
    }
  };

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      uploadQueue.push(
        uploadChunk(e.data).catch((err) => {
          console.error("[recorder] chunk upload error", err);
        }),
      );
    }
  };

  recorder.start(TIMESLICE_MS);

  const stop = async (): Promise<FinishRecordingResponse> => {
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    await Promise.all(uploadQueue);
    const finishResp = await fetch(
      `${cfg.backendUrl}/api/recordings/${id}/finish`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-streamer-slug": cfg.streamerSlug,
          "x-streamer-key": cfg.streamerKey,
        },
      },
    );
    if (!finishResp.ok) {
      throw new Error(`finish falhou ${finishResp.status}`);
    }
    return finishResp.json();
  };

  const abort = async (): Promise<void> => {
    try {
      recorder.stop();
    } catch { /* ignore */ }
    await fetch(`${cfg.backendUrl}/api/recordings/${id}/abort`, {
      method: "POST",
      headers: {
        "x-streamer-slug": cfg.streamerSlug,
        "x-streamer-key": cfg.streamerKey,
      },
    }).catch(() => {});
  };

  return { id, stop, abort };
}
