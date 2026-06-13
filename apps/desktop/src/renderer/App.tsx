import { useCallback, useEffect, useRef, useState } from "react";
import type { CreateRoomResponse } from "@wpk/shared";
import { createRoom } from "./core/api";
import { connectPublisher, type Publisher } from "./core/publisher";
import { createCompositor, type Compositor, type WebcamCorner, type WebcamSize } from "./core/compositor";
import { captureSource, captureWebcam, listCaptureSources } from "./core/capture";
import { RoomInput } from "./ui/RoomInput";
import { Preview } from "./ui/Preview";
import { ControlBar } from "./ui/ControlBar";
import { WebcamLayout } from "./ui/WebcamLayout";
import { RoomInfo } from "./ui/RoomInfo";

type Phase = "idle" | "connecting" | "ready" | "error";

export function App() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<CreateRoomResponse | null>(null);
  const [viewers] = useState(0); // TODO: wire WS presence

  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [busy, setBusy] = useState<"screen" | "webcam" | null>(null);

  const [corner, setCorner] = useState<WebcamCorner>("bottom-right");
  const [size, setSize] = useState<WebcamSize>("medium");

  const publisherRef = useRef<Publisher | null>(null);
  const compositorRef = useRef<Compositor | null>(null);

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

  const startScreenShare = useCallback(async () => {
    if (screenStream) {
      stopScreenShare();
      return;
    }
    setBusy("screen");
    setError(null);
    try {
      const sources = await listCaptureSources();
      if (sources.length === 0) {
        throw new Error("nenhuma fonte de captura disponível");
      }
      // For MVP we pick the first source; UI for choosing comes next iteration.
      const stream = await captureSource(sources[0].id, true);

      const compositor = compositorRef.current ?? createCompositor();
      compositorRef.current = compositor;
      compositor.setScreen(stream);
      compositor.setLayout({ corner, size });

      const publisher = publisherRef.current;
      if (publisher) {
        const videoTrack = compositor.outputStream.getVideoTracks()[0];
        if (videoTrack) await publisher.publishVideo(videoTrack);
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) await publisher.publishAudio(audioTrack);
      }

      setScreenStream(stream);
      setPreviewStream(compositor.outputStream);
    } catch (err) {
      console.error("[app] screen share failed", err);
      setError(err instanceof Error ? err.message : "erro ao iniciar tela");
    } finally {
      setBusy(null);
    }
  }, [screenStream, corner, size]);

  const stopScreenShare = useCallback(() => {
    screenStream?.getTracks().forEach((t) => t.stop());
    webcamStream?.getTracks().forEach((t) => t.stop());
    compositorRef.current?.stop();
    compositorRef.current = null;
    publisherRef.current?.unpublishAll();
    setScreenStream(null);
    setWebcamStream(null);
    setPreviewStream(null);
  }, [screenStream, webcamStream]);

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

  useEffect(() => {
    compositorRef.current?.setLayout({ corner, size });
  }, [corner, size]);

  useEffect(() => {
    return () => {
      compositorRef.current?.stop();
      publisherRef.current?.disconnect();
    };
  }, []);

  const isIdle = phase !== "ready" || !session;

  return (
    <div className="app">
      <div className="header">
        <h1>Watch Party — Streamer</h1>
        <div className="status">
          {session && (
            <>
              <span className="dot" />
              <span>Sala <code>{session.roomCode}</code></span>
            </>
          )}
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
                busy={busy}
                onToggleShare={startScreenShare}
                onToggleWebcam={toggleWebcam}
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
