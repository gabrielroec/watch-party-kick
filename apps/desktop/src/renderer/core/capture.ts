import type { CaptureSource } from "../../preload";

declare global {
  interface Window {
    wpk: {
      listSources: () => Promise<CaptureSource[]>;
    };
  }
}

export async function listCaptureSources(): Promise<CaptureSource[]> {
  return window.wpk.listSources();
}

export async function captureSource(sourceId: string, withAudio: boolean): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: withAudio
      ? ({ mandatory: { chromeMediaSource: "desktop" } } as MediaTrackConstraints)
      : false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
        maxWidth: 1920,
        maxHeight: 1080,
        maxFrameRate: 60,
        minFrameRate: 60,
      },
    } as MediaTrackConstraints,
  });
}

export async function captureWebcam(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    },
    audio: false,
  });
}

export type { CaptureSource };
