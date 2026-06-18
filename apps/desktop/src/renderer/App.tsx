import { useCallback, useEffect, useRef, useState } from "react";
import type { CreateRoomResponse } from "@wpk/shared";
import { createRoom } from "./core/api";
import { connectPublisher, type Publisher } from "./core/publisher";
import {
  createCompositor,
  type Compositor,
  type WebcamCorner,
  type WebcamSize,
} from "./core/compositor";
import { captureScreen, captureWebcam, captureMic } from "./core/capture";
import { createAudioMixer, type AudioMixer } from "./core/audioMixer";
import { startRecording, type ActiveRecording } from "./core/recorder";
import { BACKEND_URL, STREAMER_SLUG, STREAMER_KEY } from "./core/config";
import { RoomInput } from "./ui/RoomInput";
import { Preview } from "./ui/Preview";
import { ControlBar } from "./ui/ControlBar";
import { WebcamLayout } from "./ui/WebcamLayout";
import { RoomInfo } from "./ui/RoomInfo";
import { DisplayPicker } from "./ui/DisplayPicker";
import { UpdateBadge } from "./ui/UpdateBadge";

type Phase = "idle" | "connecting" | "ready" | "error";
type Busy = "screen" | "webcam" | "mic" | "recording" | null;

export function App() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<CreateRoomResponse | null>(null);
  const [viewers] = useState(0);

  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [busy, setBusy] = useState<Busy>(null);

  const [corner, setCorner] = useState<WebcamCorner>("bottom-right");
  const [size, setSize] = useState<WebcamSize>("medium");

  const [recording, setRecording] = useState(false);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);

  const publisherRef = useRef<Publisher | null>(null);
  const compositorRef = useRef<Compositor | null>(null);
  const audioMixerRef = useRef<AudioMixer | null>(null);
  const recordingRef = useRef<ActiveRecording | null>(null);

  const handleCreateRoom = useCallback(async (code: string) => {
    setPhase("connecting");
    setError(null);
    try {
      const data = await createRoom(code);
      const publisher = await connectPublisher(data.livekitUrl, data.livekitToken);
      publisherRef.current = publisher;
      setSession(data);
      setPhase("ready");
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "erro desconhecido");
    }
  }, []);

  const ensureAudioMixer = useCallback((): AudioMixer => {
    if (audioMixerRef.current) return audioMixerRef.current;
    const mixer = createAudioMixer();
    audioMixerRef.current = mixer;
    return mixer;
  }, []);

  const startScreenShare = useCallback(async () => {
    if (screenStream) {
      stopScreenShare();
      return;
    }
    setBusy("screen");
    setError(null);
    try {
      const stream = await captureScreen(true);

      const compositor = compositorRef.current ?? createCompositor();
      compositorRef.current = compositor;
      compositor.setScreen(stream);
      compositor.setLayout({ corner, size });

      const publisher = publisherRef.current;
      if (publisher) {
        const videoTrack = compositor.outputStream.getVideoTracks()[0];
        if (videoTrack) await publisher.publishVideo(videoTrack);

        const mixer = ensureAudioMixer();
        if (stream.getAudioTracks().length > 0) {
          mixer.addSource("screen", stream);
        } else {
          setError("Atenção: você não compartilhou o áudio do PC. No próximo picker, marque 'Compartilhar áudio'.");
        }
        await publisher.publishAudio(mixer.outputTrack);
      }

      setScreenStream(stream);
      setPreviewStream(compositor.outputStream);

      // Auto-liga mic na hora do share. Streamer quase sempre quer o mic on.
      // Se ele quiser mudo, clica em "🎙️ Mic ON" pra desligar.
      if (!micStream) {
        try {
          const mic = await captureMic();
          audioMixerRef.current?.addSource("mic", mic);
          setMicStream(mic);
          console.log("[wpk-app] mic auto-enabled");
        } catch (e) {
          console.warn("[wpk-app] mic auto-enable failed:", e);
        }
      }
    } catch (err) {
      console.error("[app] screen share failed", err);
      setError(err instanceof Error ? err.message : "erro ao iniciar tela");
    } finally {
      setBusy(null);
    }
  }, [screenStream, micStream, corner, size, ensureAudioMixer]);

  const stopScreenShare = useCallback(() => {
    if (recordingRef.current) {
      recordingRef.current.abort().catch(() => {});
      recordingRef.current = null;
      setRecording(false);
      setRecordingStartedAt(null);
    }
    screenStream?.getTracks().forEach((t) => t.stop());
    webcamStream?.getTracks().forEach((t) => t.stop());
    micStream?.getTracks().forEach((t) => t.stop());
    compositorRef.current?.stop();
    compositorRef.current = null;
    audioMixerRef.current?.stop();
    audioMixerRef.current = null;
    publisherRef.current?.unpublishAll();
    setScreenStream(null);
    setWebcamStream(null);
    setMicStream(null);
    setPreviewStream(null);
  }, [screenStream, webcamStream, micStream]);

  const toggleWebcam = useCallback(async () => {
    if (webcamStream) {
      webcamStream.getTracks().forEach((t) => t.stop());
      compositorRef.current?.setWebcam(null);
      setWebcamStream(null);
      return;
    }
    if (!compositorRef.current) {
      setError("Compartilhe a tela primeiro");
      return;
    }
    setBusy("webcam");
    setError(null);
    try {
      const stream = await captureWebcam();
      compositorRef.current.setWebcam(stream);
      setWebcamStream(stream);
    } catch (err) {
      setError(err instanceof Error ? err.message : "erro ao acessar webcam");
    } finally {
      setBusy(null);
    }
  }, [webcamStream]);

  const toggleMic = useCallback(async () => {
    if (micStream) {
      audioMixerRef.current?.removeSource("mic");
      micStream.getTracks().forEach((t) => t.stop());
      setMicStream(null);
      return;
    }
    if (!audioMixerRef.current) {
      setError("Compartilhe a tela primeiro");
      return;
    }
    setBusy("mic");
    setError(null);
    try {
      const stream = await captureMic();
      audioMixerRef.current.addSource("mic", stream);
      setMicStream(stream);
    } catch (err) {
      setError(err instanceof Error ? err.message : "erro ao acessar microfone");
    } finally {
      setBusy(null);
    }
  }, [micStream]);

  const toggleRecording = useCallback(async () => {
    if (recording) {
      const active = recordingRef.current;
      if (!active) {
        setRecording(false);
        return;
      }
      setBusy("recording");
      try {
        await active.stop();
      } catch (err) {
        setError(err instanceof Error ? err.message : "erro ao parar gravação");
      } finally {
        recordingRef.current = null;
        setRecording(false);
        setRecordingStartedAt(null);
        setBusy(null);
      }
      return;
    }
    if (!screenStream || !compositorRef.current || !session) {
      setError("Compartilhe a tela primeiro");
      return;
    }
    setBusy("recording");
    setError(null);
    try {
      // V9: tenta canvas composite (com webcam PiP) novamente, mas agora
      // o recorder prioriza H.264 (avc1) em vez de VP9 — Chromium 130 tem
      // stall conhecido no VP9 com frames de canvas timed via JS.
      // Stream nova do canvas (não a do publisher) pra evitar single-sink.
      const recordVideoStream = compositorRef.current.createConsumerStream();

      const micTrack = micStream?.getAudioTracks()[0];
      console.log("[wpk-app] recording sources:", {
        hasMicAudio: !!micTrack,
        micAudioLabel: micTrack?.label,
      });
      const recordAudio = micTrack ? micTrack.clone() : null;

      const active = await startRecording({
        backendUrl: BACKEND_URL,
        streamerSlug: STREAMER_SLUG,
        streamerKey: STREAMER_KEY,
        roomCode: session.roomCode,
        videoStream: recordVideoStream,
        audioTrack: recordAudio,
        onUploadError: (msg) => setError(`gravação: ${msg}`),
      });
      recordingRef.current = active;
      setRecording(true);
      setRecordingStartedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "erro ao iniciar gravação");
    } finally {
      setBusy(null);
    }
  }, [recording, session, screenStream, micStream]);

  useEffect(() => {
    compositorRef.current?.setLayout({ corner, size });
  }, [corner, size]);

  useEffect(() => {
    if (!recording || !recordingStartedAt) return;
    const id = setInterval(() => {
      setRecordingDurationMs(Date.now() - recordingStartedAt);
    }, 500);
    return () => clearInterval(id);
  }, [recording, recordingStartedAt]);

  useEffect(() => {
    return () => {
      recordingRef.current?.abort().catch(() => {});
      compositorRef.current?.stop();
      audioMixerRef.current?.stop();
      publisherRef.current?.disconnect();
    };
  }, []);

  const isIdle = phase !== "ready" || !session;

  return (
    <div className="app">
      <DisplayPicker />
      <div className="header">
        <h1>Watch Party — Streamer</h1>
        <div className="status">
          {session && (
            <>
              <span className="dot" />
              <span>Sala <code>{session.roomCode}</code></span>
            </>
          )}
          <UpdateBadge />
        </div>
      </div>

      <div className={`body ${isIdle ? "idle" : ""}`}>
        {error && (
          <div className="error" style={{ gridColumn: "1 / -1" }}>
            <span>{error}</span>
            <button onClick={() => setError(null)}>X</button>
          </div>
        )}

        {!session && <RoomInput busy={phase === "connecting"} onCreate={handleCreateRoom} />}

        {session && (
          <>
            <div>
              <Preview
                stream={previewStream}
                empty="Clique em 'Compartilhar tela' pra começar"
              />
              <ControlBar
                sharing={!!screenStream}
                webcamOn={!!webcamStream}
                micOn={!!micStream}
                recording={recording}
                recordingDurationMs={recordingDurationMs}
                busy={busy}
                onToggleShare={startScreenShare}
                onToggleWebcam={toggleWebcam}
                onToggleMic={toggleMic}
                onToggleRecording={toggleRecording}
              />
            </div>

            <aside className="sidebar">
              <RoomInfo code={session.roomCode} viewers={viewers} />
              {webcamStream && (
                <WebcamLayout
                  corner={corner}
                  size={size}
                  onCornerChange={setCorner}
                  onSizeChange={setSize}
                />
              )}
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
