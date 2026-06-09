"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CreateRoomResponse } from "@wpk/shared";
import { isCreateRoomResponse } from "@wpk/shared";
import { connectAsPublisher, type PublisherHandle } from "@/lib/publisher";
import { openControlSocket } from "@/lib/controlSocket";

const BACKEND_URL = "https://watchpartykick.duckdns.org";

type Status = "idle" | "creating" | "connected" | "error";

export default function PanelPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [session, setSession] = useState<CreateRoomResponse | null>(null);
  const [viewers, setViewers] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState("");

  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);

  const publisherRef = useRef<PublisherHandle | null>(null);
  const wsRef = useRef<ReturnType<typeof openControlSocket> | null>(null);
  const screenPreviewRef = useRef<HTMLVideoElement | null>(null);

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
      if (!isCreateRoomResponse(raw)) {
        throw new Error("backend desatualizado");
      }
      const data: CreateRoomResponse = raw;
      setSession(data);
      setStatus("connected");

      const pub = await connectAsPublisher({
        url: data.livekitUrl,
        token: data.livekitToken,
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

      const settings = track.getSettings() as MediaTrackSettings & { displaySurface?: string };
      console.info("[panel] capture source", settings.displaySurface, "fps", settings.frameRate);

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

  // Preview da tela
  useEffect(() => {
    if (screenPreviewRef.current) {
      screenPreviewRef.current.srcObject = screenStream;
      if (screenStream) screenPreviewRef.current.play().catch(() => {});
    }
  }, [screenStream]);

  // WebSocket de controle
  useEffect(() => {
    if (!session) return;
    const ws = openControlSocket({
      backendUrl: BACKEND_URL,
      roomCode: session.roomCode,
      identity: session.identity,
      role: "host",
      onMessage: (m) => {
        if (m.type === "presence") setViewers(m.viewers);
      },
    });
    wsRef.current = ws;
    return () => { ws.close(); wsRef.current = null; };
  }, [session]);

  // Cleanup
  useEffect(() => {
    return () => {
      publisherRef.current?.disconnect().catch(() => {});
      screenStream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600 }}>Painel do Streamer — Watch Party</h1>
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
            <div style={{
              aspectRatio: "16/9",
              background: "#0a0b0f",
              border: "1px solid #262934",
              borderRadius: 12,
              overflow: "hidden",
              position: "relative",
            }}>
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
                  <div>Nenhuma tela compartilhada</div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
              <button onClick={() => toggleScreen(true)} disabled={busy === "screen"}>
                {busy === "screen" ? "Abrindo..." : screenStream ? "Parar tela" : "Compartilhar tela (com som)"}
              </button>
              {!screenStream && (
                <button onClick={() => toggleScreen(false)} disabled={busy === "screen"} style={{ fontSize: 12, opacity: 0.8 }}>
                  Sem som
                </button>
              )}
            </div>

            {!screenStream && (
              <div style={{
                marginTop: 12, padding: 12,
                background: "#1a2a18", border: "1px solid #2dd879", borderRadius: 8, fontSize: 13,
              }}>
                <strong style={{ color: "#2dd879" }}>60fps garantido em qualquer modo:</strong> compartilhe Aba,
                Janela ou Tela inteira. O publisher tem rate-lock client-side que emite 60fps mesmo
                quando o Chrome captura a 30fps no source.
              </div>
            )}

            <div style={{
              marginTop: 12, padding: 12,
              background: "#15171d", border: "1px solid #262934", borderRadius: 8, fontSize: 13, opacity: 0.85,
            }}>
              <strong>Como o viewer vê:</strong> uma janela flutuante draggable + resizable no canto da página da Kick.
              O viewer pode arrastar pra onde quiser, redimensionar pelos cantos, ou clicar em <em>Maximizar</em> pra
              cobrir o player Kick e assistir o screen share em tela cheia. A webcam do streamer fica visível
              naturalmente na live oficial da Kick por baixo.
            </div>
          </div>

          <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ padding: 16, background: "#15171d", border: "1px solid #262934", borderRadius: 12 }}>
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>CÓDIGO DA SALA</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <code style={{ fontSize: 24, letterSpacing: 2 }}>{session.roomCode}</code>
                <button onClick={() => navigator.clipboard.writeText(session.roomCode)}>Copiar</button>
              </div>
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 10 }}>
                Viewers conectados: <strong>{viewers}</strong>
              </div>
            </div>
          </aside>
        </section>
      )}
    </main>
  );
}
