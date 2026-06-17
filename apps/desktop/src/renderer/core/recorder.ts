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

const RECORDER_VERSION = "v8-raw-video-mic-direct";
const log = (...args: unknown[]) => console.log(`[wpk-rec ${RECORDER_VERSION}]`, ...args);
const errLog = (...args: unknown[]) => console.error(`[wpk-rec ${RECORDER_VERSION}]`, ...args);
log("recorder module loaded");

function pickMimeType(): string {
  for (const m of MIME_PRIORITY) {
    if (MediaRecorder.isTypeSupported(m)) {
      log("mimeType escolhido:", m);
      return m;
    }
  }
  log("nenhum mimeType da lista suportado, indo no default");
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
  onUploadError?: (msg: string) => void;
}

export interface ActiveRecording {
  id: string;
  stop: () => Promise<FinishRecordingResponse>;
  abort: () => Promise<void>;
}

export async function startRecording(cfg: RecorderConfig): Promise<ActiveRecording> {
  log("startRecording chamado", { room: cfg.roomCode, slug: cfg.streamerSlug });

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
  log("start OK, id =", id);

  // Diagnóstico das tracks
  const videoTracks = cfg.videoStream.getVideoTracks();
  log("videoStream:", {
    id: cfg.videoStream.id,
    active: cfg.videoStream.active,
    trackCount: videoTracks.length,
  });
  videoTracks.forEach((t, i) => {
    log(`videoTrack[${i}]:`, {
      label: t.label, kind: t.kind, readyState: t.readyState, enabled: t.enabled,
      muted: t.muted, settings: t.getSettings(),
    });
  });
  if (cfg.audioTrack) {
    log("audioTrack:", {
      label: cfg.audioTrack.label, kind: cfg.audioTrack.kind,
      readyState: cfg.audioTrack.readyState, enabled: cfg.audioTrack.enabled,
    });
  } else {
    log("sem audioTrack");
  }

  const composite = new MediaStream();
  videoTracks.forEach((t) => composite.addTrack(t));
  if (cfg.audioTrack) composite.addTrack(cfg.audioTrack);
  log("composite stream tracks:", composite.getTracks().length);

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(
    composite,
    mimeType ? { mimeType, videoBitsPerSecond: 6_000_000 } : { videoBitsPerSecond: 6_000_000 },
  );

  let chunkCount = 0;
  let totalBytes = 0;
  const uploadQueue: Promise<void>[] = [];

  const uploadChunk = async (blob: Blob, index: number): Promise<void> => {
    if (blob.size === 0) {
      log(`chunk #${index} vazio (size=0), skip`);
      return;
    }
    log(`uploading chunk #${index} (${blob.size} bytes)`);
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
      const text = await resp.text().catch(() => "");
      throw new Error(`chunk #${index} HTTP ${resp.status}: ${text.slice(0, 80)}`);
    }
    log(`chunk #${index} OK`);
  };

  recorder.onstart = () => log("MediaRecorder.onstart fired, state =", recorder.state);
  recorder.onerror = (e) => {
    const err = e as unknown as { error?: Error };
    errLog("MediaRecorder.onerror:", err.error);
    cfg.onUploadError?.(`recorder erro: ${err.error?.message ?? "desconhecido"}`);
  };
  recorder.onpause = () => log("MediaRecorder.onpause");
  recorder.onresume = () => log("MediaRecorder.onresume");

  recorder.ondataavailable = (e) => {
    const idx = ++chunkCount;
    log(`ondataavailable #${idx} size=${e.data?.size ?? 0}`);
    if (e.data && e.data.size > 0) {
      totalBytes += e.data.size;
      uploadQueue.push(
        uploadChunk(e.data, idx).catch((err) => {
          errLog("upload error:", err);
          cfg.onUploadError?.(err.message);
        }),
      );
    }
  };

  log(`recorder.start(${TIMESLICE_MS})`);
  recorder.start(TIMESLICE_MS);

  const stop = async (): Promise<FinishRecordingResponse> => {
    log("stop chamado, recorder.state =", recorder.state);
    await new Promise<void>((resolve) => {
      recorder.onstop = () => {
        log("MediaRecorder.onstop fired");
        resolve();
      };
      try {
        recorder.requestData();
      } catch (e) {
        log("requestData lançou:", e);
      }
      recorder.stop();
    });
    log(`aguardando ${uploadQueue.length} uploads...`);
    await Promise.all(uploadQueue);
    log(`uploads done. total chunks: ${chunkCount}, total bytes: ${totalBytes}`);
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
    const finishBody = await finishResp.json();
    log("finish OK:", finishBody);
    return finishBody;
  };

  const abort = async (): Promise<void> => {
    log("abort chamado");
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
