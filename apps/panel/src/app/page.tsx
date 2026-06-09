"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CreateRoomResponse, ScreenCutout } from "@wpk/shared";
import { isCreateRoomResponse } from "@wpk/shared";
import { connectAsPublisher, type PublisherHandle } from "@/lib/publisher";
import { openControlSocket } from "@/lib/controlSocket";

const BACKEND_URL = "https://watchpartykick.duckdns.org";

type Status = "idle" | "creating" | "connected" | "error";

// Coordenadas em pixels do retangulo sendo desenhado (relativos ao container do preview).
interface DraftRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export default function PanelPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [session, setSession] = useState<CreateRoomResponse | null>(null);
  const [viewers, setViewers] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState("");

  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);

  // Cutout normalizado (0-1) que vai pro viewer via WS.
  const [cutout, setCutout] = useState<ScreenCutout | null>(null);
  // Modo desenho — quando ON, mouse drag no preview cria o cutout.
  const [drawMode, setDrawMode] = useState(false);
  const [draftRect, setDraftRect] = useState<DraftRect | null>(null);
  const draftRef = useRef<{ startX: number; startY: number } | null>(null);

  const publisherRef = useRef<PublisherHandle | null>(null);
  const wsRef = useRef<ReturnType<typeof openControlSocket> | null>(null);
  const screenPreviewRef = useRef<HTMLVideoElement | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);

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
      if (settings.displaySurface && settings.displaySurface !== "browser") {
        setErrorMsg(
          `Atencao: voce escolheu '${settings.displaySurface}'. Chrome limita janela/tela a 30fps. ` +
          `Pra 60fps, compartilhe uma ABA do Chrome.`,
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

  // Envia cutout pro backend sempre que muda (debounce minimo via React state).
  useEffect(() => {
    if (!wsRef.current || !session) return;
    wsRef.current.send({ type: "cutout", cutout });
  }, [cutout, session]);

  // ---- Cutout drawing (mouse events no preview container) ----
  const onPreviewMouseDown = useCallback((e: React.MouseEvent) => {
    if (!drawMode || !previewContainerRef.current) return;
    const rect = previewContainerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    draftRef.current = { startX: x, startY: y };
    setDraftRect({ x, y, w: 0, h: 0 });
  }, [drawMode]);

  const onPreviewMouseMove = useCallback((e: React.MouseEvent) => {
    if (!draftRef.current || !previewContainerRef.current) return;
    const rect = previewContainerRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const { startX, startY } = draftRef.current;
    setDraftRect({
      x: Math.min(startX, cx),
      y: Math.min(startY, cy),
      w: Math.abs(cx - startX),
      h: Math.abs(cy - startY),
    });
  }, []);

  const onPreviewMouseUp = useCallback(() => {
    if (!draftRef.current || !previewContainerRef.current || !draftRect) return;
    const rect = previewContainerRef.current.getBoundingClientRect();
    // Normaliza 0-1 relativo ao container 16:9 do preview.
    if (draftRect.w > 8 && draftRect.h > 8) {
      const normalized: ScreenCutout = {
        x: draftRect.x / rect.width,
        y: draftRect.y / rect.height,
        w: draftRect.w / rect.width,
        h: draftRect.h / rect.height,
      };
      setCutout(normalized);
    }
    draftRef.current = null;
    setDraftRect(null);
    setDrawMode(false);
  }, [draftRect]);

  // Cleanup
  useEffect(() => {
    return () => {
      publisherRef.current?.disconnect().catch(() => {});
      screenStream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Visualizacao do cutout aplicado (preview do que o viewer vai ver).
  const appliedRect = (() => {
    if (!cutout || !previewContainerRef.current) return null;
    const rect = previewContainerRef.current.getBoundingClientRect();
    return {
      x: cutout.x * rect.width,
      y: cutout.y * rect.height,
      w: cutout.w * rect.width,
      h: cutout.h * rect.height,
    };
  })();

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
            <div
              ref={previewContainerRef}
              onMouseDown={onPreviewMouseDown}
              onMouseMove={onPreviewMouseMove}
              onMouseUp={onPreviewMouseUp}
              onMouseLeave={onPreviewMouseUp}
              style={{
                aspectRatio: "16/9",
                background: "#0a0b0f",
                border: "1px solid #262934",
                borderRadius: 12,
                overflow: "hidden",
                position: "relative",
                cursor: drawMode ? "crosshair" : "default",
                userSelect: "none",
              }}
            >
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

              {/* Retangulo sendo desenhado em tempo real */}
              {draftRect && (
                <div style={{
                  position: "absolute",
                  left: draftRect.x, top: draftRect.y,
                  width: draftRect.w, height: draftRect.h,
                  border: "2px dashed #2dd879",
                  background: "rgba(45,216,121,0.15)",
                  pointerEvents: "none",
                }} />
              )}

              {/* Cutout aplicado (sempre visivel quando ha cutout) */}
              {appliedRect && !draftRect && (
                <div style={{
                  position: "absolute",
                  left: appliedRect.x, top: appliedRect.y,
                  width: appliedRect.w, height: appliedRect.h,
                  border: "2px solid #2dd879",
                  background: "rgba(45,216,121,0.08)",
                  pointerEvents: "none",
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)",
                }}>
                  <div style={{
                    position: "absolute", bottom: -22, left: 0, fontSize: 11,
                    background: "#2dd879", color: "#0b2a18", padding: "2px 6px",
                    borderRadius: 4, fontWeight: 600,
                  }}>
                    BURACO DA WEBCAM (viewer ve a Kick por baixo)
                  </div>
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
              <button
                onClick={() => setDrawMode((v) => !v)}
                disabled={!screenStream}
                className={drawMode ? "primary" : undefined}
                title="Desenhe um retangulo onde a webcam da Kick deve aparecer"
              >
                {drawMode ? "Desenhando... (clique e arraste)" : cutout ? "Redesenhar buraco da webcam" : "Marcar buraco da webcam"}
              </button>
              {cutout && (
                <button onClick={() => setCutout(null)} style={{ fontSize: 12 }}>
                  Remover buraco
                </button>
              )}
            </div>

            <p style={{ fontSize: 12, opacity: 0.7, marginTop: 8, maxWidth: 700 }}>
              Como funciona: o overlay da extensao mostra sua tela compartilhada por cima do player da Kick.
              Marque um retangulo onde a sua webcam fica na live da Kick — esse pedaco fica TRANSPARENTE no
              overlay, e os viewers veem a webcam nativa da Kick por baixo. Resultado: zero CPU gasto com
              webcam, 100% do encoder no video.
            </p>
          </div>

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

            {cutout && (
              <div style={{ padding: 16, background: "#15171d", border: "1px solid #262934", borderRadius: 12, fontSize: 12 }}>
                <div style={{ opacity: 0.7, marginBottom: 6 }}>BURACO ATUAL</div>
                <div style={{ fontFamily: "monospace" }}>
                  x: {(cutout.x * 100).toFixed(1)}% · y: {(cutout.y * 100).toFixed(1)}%<br />
                  w: {(cutout.w * 100).toFixed(1)}% · h: {(cutout.h * 100).toFixed(1)}%
                </div>
              </div>
            )}
          </aside>
        </section>
      )}
    </main>
  );
}
