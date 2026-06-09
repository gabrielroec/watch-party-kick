"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CreateRoomResponse, SceneLayout, WebcamCorner, WebcamSize } from "@wpk/shared";
import { DEFAULT_SCENE_LAYOUT, isCreateRoomResponse } from "@wpk/shared";
import { connectAsPublisher, type PublisherHandle } from "@/lib/publisher";
import { openControlSocket } from "@/lib/controlSocket";

const BACKEND_URL = "https://watchpartykick.duckdns.org";

type Status = "idle" | "creating" | "connected" | "error";

export default function PanelPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // session carrega o pacote completo (main + cam) pro host.
  const [session, setSession] = useState<CreateRoomResponse | null>(null);
  const [viewers, setViewers] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState("");

  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);

  const [layout, setLayoutState] = useState<SceneLayout>(DEFAULT_SCENE_LAYOUT);
  const [micOn, setMicOn] = useState(true);

  const publisherRef = useRef<PublisherHandle | null>(null);
  const wsRef = useRef<ReturnType<typeof openControlSocket> | null>(null);
  const screenPreviewRef = useRef<HTMLVideoElement | null>(null);
  const webcamPreviewRef = useRef<HTMLVideoElement | null>(null);

  const createRoom = useCallback(async () => {
    if (roomCode.trim().length < 3) {
      setErrorMsg("Código precisa ter pelo menos 3 caracteres");
      return;
    }
    setStatus("creating");
    setErrorMsg(null);
    try {
      const resp = await fetch(`${BACKEND_URL}/api/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: roomCode.trim().toUpperCase() }),
      });
      if (!resp.ok) throw new Error(`backend respondeu ${resp.status}`);
      const raw = await resp.json();
      // Backend deve devolver CreateRoomResponse pro host. Narrowing detecta
      // deploy desatualizado em vez de silenciar.
      if (!isCreateRoomResponse(raw)) {
        throw new Error("backend desatualizado: faltam camToken/camIdentity");
      }
      const data: CreateRoomResponse = raw;
      setSession(data);
      setStatus("connected");

      const pub = await connectAsPublisher({
        url: data.livekitUrl,
        screenToken: data.mainToken,
        // Token ja vem no payload — funcao apenas devolve. Sem round-trip extra.
        getCamToken: async () => data.camToken,
      });
      publisherRef.current = pub;
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "erro desconhecido");
    }
  }, [roomCode]);

  const toggleScreen = useCallback(async (withAudio: boolean = true) => {
    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
      setScreenStream(null);
      await publisherRef.current?.stopScreenShare();
      return;
    }
    setBusy("screen");
    setErrorMsg(null);
    try {
      // displaySurface: 'browser' sugere o picker abrir na aba "Aba do Chrome".
      // Window/screen capture do Chrome esta hard-capped em 30fps. Apenas
      // tab capture (WebContentsVideoCaptureDevice) entrega 60fps. Sugestao,
      // nao obrigatorio — o usuario ainda pode escolher janela/tela e cair
      // pro caminho de 30fps.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 60, max: 60 },
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          displaySurface: "browser",
        } as MediaTrackConstraints & { displaySurface?: string },
        audio: withAudio,
        selfBrowserSurface: "include",
        surfaceSwitching: "include",
      } as DisplayMediaStreamOptions & { selfBrowserSurface?: string; surfaceSwitching?: string });
      const track = stream.getVideoTracks()[0];
      if (!track) { stream.getTracks().forEach((t) => t.stop()); setBusy(null); return; }

      // Avisa se caiu no path de 30fps (window/screen capture).
      const settings = track.getSettings() as MediaTrackSettings & { displaySurface?: string };
      if (settings.displaySurface && settings.displaySurface !== "browser") {
        setErrorMsg(
          `Atencao: voce escolheu '${settings.displaySurface}'. Chrome limita janela/tela a 30fps. ` +
          `Pra 60fps, compartilhe uma ABA do Chrome (recarregue e escolha "Aba do Chrome").`,
        );
      }

      track.addEventListener("ended", () => {
        setScreenStream(null);
        publisherRef.current?.stopScreenShare();
      });
      setScreenStream(stream);
      await publisherRef.current?.startScreenShare(stream);
    } catch (e) {
      console.warn("[panel] screen share falhou", e);
      if (e instanceof Error && e.name !== "NotAllowedError") {
        setErrorMsg(e.message);
      }
    } finally {
      setBusy(null);
    }
  }, [screenStream]);

  const toggleWebcam = useCallback(async () => {
    if (webcamStream) {
      webcamStream.getTracks().forEach((t) => t.stop());
      setWebcamStream(null);
      await publisherRef.current?.stopWebcam();
      return;
    }
    setBusy("webcam");
    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          // 480p30 deixa a webcam ~2.25x mais barata de encodar vs 720p,
          // liberando CPU pro encoder da screen manter 60fps estavel.
          width: { ideal: 854, max: 854 },
          height: { ideal: 480, max: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: true,
      });
      setWebcamStream(stream);
      await publisherRef.current?.startWebcam(stream);
    } catch (e) {
      console.error("[panel] falha webcam", e);
      setErrorMsg(e instanceof Error ? e.message : "erro ao acessar webcam");
    } finally {
      setBusy(null);
    }
  }, [webcamStream]);

  // Preview da tela
  useEffect(() => {
    if (screenPreviewRef.current) {
      screenPreviewRef.current.srcObject = screenStream;
      if (screenStream) screenPreviewRef.current.play().catch(() => {});
    }
  }, [screenStream]);

  // Preview da webcam
  useEffect(() => {
    if (webcamPreviewRef.current) {
      webcamPreviewRef.current.srcObject = webcamStream;
      if (webcamStream) webcamPreviewRef.current.play().catch(() => {});
    }
  }, [webcamStream]);

  // Mic toggle
  useEffect(() => {
    if (!webcamStream) return;
    webcamStream.getAudioTracks().forEach((t) => { t.enabled = micOn; });
  }, [micOn, webcamStream]);

  // WebSocket de controle
  useEffect(() => {
    if (!session) return;
    const ws = openControlSocket({
      backendUrl: BACKEND_URL,
      roomCode: session.roomCode,
      identity: session.mainIdentity, // cam-* nao usa WS
      role: "host",
      onMessage: (m) => {
        if (m.type === "presence") setViewers(m.viewers);
      },
    });
    wsRef.current = ws;
    return () => { ws.close(); wsRef.current = null; };
  }, [session]);

  useEffect(() => {
    if (!wsRef.current || !session) return;
    wsRef.current.send({
      type: "host-state",
      webcamOn: !!webcamStream,
      micOn,
      sourceLabel: screenStream ? "Compartilhando tela" : null,
    });
  }, [webcamStream, micOn, screenStream, session]);

  // Cleanup
  useEffect(() => {
    return () => {
      publisherRef.current?.disconnect().catch(() => {});
      screenStream?.getTracks().forEach((t) => t.stop());
      webcamStream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600 }}>Painel do Streamer - Watch Party</h1>
        <div style={{ fontSize: 13, opacity: 0.7 }}>
          {status === "connected" && session ? `Sala: ` : null}
          {session ? <code>{session.roomCode}</code> : null}
        </div>
      </header>

      {errorMsg && (
        <div style={{ color: "#ff8b8b", marginBottom: 16, padding: 12, background: "#1a1215", border: "1px solid #4d1f24", borderRadius: 8 }}>
          {errorMsg}
          <button onClick={() => setErrorMsg(null)} style={{ marginLeft: 12, fontSize: 12 }}>X</button>
        </div>
      )}

      {!session && (
        <section style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-start" }}>
          <p style={{ opacity: 0.8, maxWidth: 620 }}>
            Escolha um código para a sala e passe pros viewers no chat da Kick.
          </p>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              placeholder="Ex: WATCHPARTY"
              maxLength={12}
              style={{ width: 200, fontSize: 16, letterSpacing: 1 }}
            />
            <button className="primary" onClick={createRoom} disabled={status === "creating" || roomCode.trim().length < 3}>
              {status === "creating" ? "Criando..." : "Criar sala"}
            </button>
          </div>
        </section>
      )}

      {session && (
        <section style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24 }}>
          <div>
            {/* Preview estilo OBS */}
            <div style={{
              aspectRatio: "16/9", background: "#0a0b0f", border: "1px solid #262934",
              borderRadius: 12, overflow: "hidden", position: "relative",
            }}>
              {/* Tela principal */}
              <video
                ref={screenPreviewRef}
                muted
                playsInline
                style={{
                  width: "100%", height: "100%", objectFit: "contain",
                  display: screenStream ? "block" : "none",
                }}
              />
              {!screenStream && (
                <div style={{
                  position: "absolute", inset: 0, display: "flex", alignItems: "center",
                  justifyContent: "center", opacity: 0.6, flexDirection: "column", gap: 8,
                }}>
                  <div>Nenhuma tela selecionada</div>
                </div>
              )}
              {/* Webcam PiP */}
              {webcamStream && (
                <div style={{
                  position: "absolute",
                  ...(layout.webcamCorner.includes("bottom") ? { bottom: 12 } : { top: 12 }),
                  ...(layout.webcamCorner.includes("right") ? { right: 12 } : { left: 12 }),
                  width: layout.webcamSize === "S" ? "18%" : layout.webcamSize === "M" ? "25%" : "34%",
                  aspectRatio: "16/9",
                  borderRadius: 8, overflow: "hidden",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.6)", border: "2px solid rgba(255,255,255,0.15)",
                }}>
                  <video ref={webcamPreviewRef} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
              )}
            </div>

            {/* Botões */}
            <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
              <button onClick={() => toggleScreen(true)} disabled={busy === "screen"}>
                {busy === "screen" ? "Abrindo..." : screenStream ? "Parar tela" : "Compartilhar tela (com som)"}
              </button>
              {!screenStream && (
                <button onClick={() => toggleScreen(false)} disabled={busy === "screen"} style={{ fontSize: 12, opacity: 0.8 }}>
                  Sem som
                </button>
              )}
              <button onClick={toggleWebcam} disabled={busy === "webcam"}>
                {busy === "webcam" ? "Abrindo..." : webcamStream ? "Desligar webcam" : "Ligar webcam"}
              </button>
              <button
                onClick={() => setMicOn((v) => !v)}
                className={micOn ? "primary" : undefined}
                disabled={!webcamStream}
              >
                Mic: {micOn ? "ON" : "OFF"}
              </button>
            </div>
          </div>

          {/* Sidebar */}
          <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ padding: 16, background: "#15171d", border: "1px solid #262934", borderRadius: 12 }}>
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>CODIGO DA SALA</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <code style={{ fontSize: 24, letterSpacing: 2 }}>{session.roomCode}</code>
                <button onClick={() => navigator.clipboard.writeText(session.roomCode)}>Copiar</button>
              </div>
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 10 }}>
                Viewers conectados: <strong>{viewers}</strong>
              </div>
            </div>

            <div style={{ padding: 16, background: "#15171d", border: "1px solid #262934", borderRadius: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>LAYOUT DA WEBCAM (viewer)</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {(["top-left", "top-right", "bottom-left", "bottom-right"] as WebcamCorner[]).map((c) => (
                  <button key={c} onClick={() => setLayoutState((l) => ({ ...l, webcamCorner: c }))}
                    className={layout.webcamCorner === c ? "primary" : undefined}>
                    {c}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {(["S", "M", "L"] as WebcamSize[]).map((s) => (
                  <button key={s} onClick={() => setLayoutState((l) => ({ ...l, webcamSize: s }))}
                    className={layout.webcamSize === s ? "primary" : undefined}>
                    Tamanho {s}
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </section>
      )}
    </main>
  );
}
