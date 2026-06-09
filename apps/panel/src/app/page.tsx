"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CreateRoomResponse, ScreenCutout } from "@wpk/shared";
import { isCreateRoomResponse } from "@wpk/shared";
import { connectAsPublisher, type PublisherHandle } from "@/lib/publisher";
import { openControlSocket } from "@/lib/controlSocket";

const BACKEND_URL = "https://watchpartykick.duckdns.org";

type Status = "idle" | "creating" | "connected" | "error";

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type Mode =
  | { kind: "idle" }
  | { kind: "draw"; startX: number; startY: number }
  | { kind: "move"; startX: number; startY: number; orig: ScreenCutout }
  | { kind: "resize"; handle: Handle; startX: number; startY: number; orig: ScreenCutout };

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

function normalize(rect: ScreenCutout): ScreenCutout {
  // Garante x/y >= 0 e w/h positivos.
  let { x, y, w, h } = rect;
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  // Limita ao box [0,1]
  if (x < 0) { w += x; x = 0; }
  if (y < 0) { h += y; y = 0; }
  if (x + w > 1) { w = 1 - x; }
  if (y + h > 1) { h = 1 - y; }
  return { x: clamp01(x), y: clamp01(y), w: Math.max(0, w), h: Math.max(0, h) };
}

export default function PanelPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [session, setSession] = useState<CreateRoomResponse | null>(null);
  const [viewers, setViewers] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState("");

  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);

  // Cutout normalizado (0-1). Persiste ate o usuario apagar.
  const [cutout, setCutout] = useState<ScreenCutout | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "idle" });

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

      // BLOQUEIO: Chrome tem cap hard de 30fps em window/screen capture.
      // So tab capture (displaySurface='browser') vai pelo pipeline de 60fps.
      // Sem isso, FPS sempre tem teto 30 e o problema do usuario nunca some.
      const settings = track.getSettings() as MediaTrackSettings & { displaySurface?: string };
      if (settings.displaySurface && settings.displaySurface !== "browser") {
        stream.getTracks().forEach((t) => t.stop());
        setErrorMsg(
          `Voce escolheu "${settings.displaySurface}", que o Chrome limita a 30fps. ` +
          `Pra 60fps escolha "Aba do Chrome" no picker e selecione a aba com o conteudo.`,
        );
        setBusy(null);
        return;
      }

      // Verifica capabilities: se reportar maxFrameRate < 60, o picker bugou.
      try {
        const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities;
        const fpsMax = (caps as { frameRate?: { max?: number } }).frameRate?.max;
        if (fpsMax != null && fpsMax < 60) {
          console.warn(`[panel] capabilities reportam maxFrameRate=${fpsMax}; cap pode estar ativo`);
        }
      } catch { /* noop */ }

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

  // Envia cutout pro backend sempre que muda.
  useEffect(() => {
    if (!wsRef.current || !session) return;
    wsRef.current.send({ type: "cutout", cutout });
  }, [cutout, session]);

  // ---------- Editor do cutout ----------

  // Conversao pixel -> normalizado (0-1) relativa ao container do preview.
  function pxToNorm(px: number, py: number) {
    const el = previewContainerRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: (px - r.left) / r.width, y: (py - r.top) / r.height };
  }

  function onContainerMouseDown(e: React.MouseEvent) {
    if (!screenStream) return;
    const { x, y } = pxToNorm(e.clientX, e.clientY);

    // Se ja tem cutout, checa se clicou dentro dele -> move; senao -> redesenha.
    if (cutout) {
      const inside = x >= cutout.x && x <= cutout.x + cutout.w && y >= cutout.y && y <= cutout.y + cutout.h;
      if (inside) {
        setMode({ kind: "move", startX: x, startY: y, orig: cutout });
        e.preventDefault();
        return;
      }
    }
    // Comecar a desenhar novo retangulo
    setCutout({ x, y, w: 0, h: 0 });
    setMode({ kind: "draw", startX: x, startY: y });
    e.preventDefault();
  }

  function onHandleMouseDown(handle: Handle, e: React.MouseEvent) {
    if (!cutout) return;
    const { x, y } = pxToNorm(e.clientX, e.clientY);
    setMode({ kind: "resize", handle, startX: x, startY: y, orig: cutout });
    e.preventDefault();
    e.stopPropagation();
  }

  // Global mouse move/up enquanto edita
  useEffect(() => {
    if (mode.kind === "idle") return;

    function onMove(ev: MouseEvent) {
      const { x, y } = pxToNorm(ev.clientX, ev.clientY);
      if (mode.kind === "draw") {
        const nx = Math.min(mode.startX, x);
        const ny = Math.min(mode.startY, y);
        const nw = Math.abs(x - mode.startX);
        const nh = Math.abs(y - mode.startY);
        setCutout(normalize({ x: nx, y: ny, w: nw, h: nh }));
      } else if (mode.kind === "move") {
        const dx = x - mode.startX;
        const dy = y - mode.startY;
        setCutout(normalize({
          x: mode.orig.x + dx,
          y: mode.orig.y + dy,
          w: mode.orig.w,
          h: mode.orig.h,
        }));
      } else if (mode.kind === "resize") {
        const { handle, orig, startX, startY } = mode;
        const dx = x - startX;
        const dy = y - startY;
        let { x: nx, y: ny, w: nw, h: nh } = orig;
        if (handle.includes("w")) { nx = orig.x + dx; nw = orig.w - dx; }
        if (handle.includes("e")) { nw = orig.w + dx; }
        if (handle.includes("n")) { ny = orig.y + dy; nh = orig.h - dy; }
        if (handle.includes("s")) { nh = orig.h + dy; }
        setCutout(normalize({ x: nx, y: ny, w: nw, h: nh }));
      }
    }

    function onUp() {
      if (mode.kind === "draw" && cutout && (cutout.w < 0.01 || cutout.h < 0.01)) {
        // Click sem drag (ou drag minimo) — desfaz
        setCutout(null);
      }
      setMode({ kind: "idle" });
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [mode, cutout]);

  // Cleanup
  useEffect(() => {
    return () => {
      publisherRef.current?.disconnect().catch(() => {});
      screenStream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Retangulo aplicado em pixels pra rendering.
  const appliedPx = (() => {
    if (!cutout || !previewContainerRef.current) return null;
    const r = previewContainerRef.current.getBoundingClientRect();
    return {
      x: cutout.x * r.width,
      y: cutout.y * r.height,
      w: cutout.w * r.width,
      h: cutout.h * r.height,
    };
  })();

  const cursor: React.CSSProperties["cursor"] =
    mode.kind === "draw" ? "crosshair" :
    mode.kind === "move" ? "grabbing" :
    "default";

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
              onMouseDown={onContainerMouseDown}
              style={{
                aspectRatio: "16/9",
                background: "#0a0b0f",
                border: "1px solid #262934",
                borderRadius: 12,
                overflow: "hidden",
                position: "relative",
                cursor,
                userSelect: "none",
                touchAction: "none",
              }}
            >
              <video
                ref={screenPreviewRef}
                muted
                playsInline
                style={{
                  width: "100%", height: "100%", objectFit: "contain",
                  display: screenStream ? "block" : "none",
                  pointerEvents: "none",
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

              {/* Retangulo do cutout (persistente; arrastavel e redimensionavel) */}
              {appliedPx && (
                <div style={{
                  position: "absolute",
                  left: appliedPx.x, top: appliedPx.y,
                  width: appliedPx.w, height: appliedPx.h,
                  border: "2px solid #2dd879",
                  background: "rgba(45,216,121,0.10)",
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.30)",
                  cursor: mode.kind === "move" ? "grabbing" : "grab",
                }}>
                  {/* Handles de resize nas 8 direcoes */}
                  {(["nw","n","ne","e","se","s","sw","w"] as Handle[]).map((h) => {
                    const isCorner = h.length === 2;
                    const size = 12;
                    const half = size / 2;
                    let left: string | undefined, top: string | undefined, right: string | undefined, bottom: string | undefined;
                    let cur: string = "";
                    if (h.includes("n")) { top = `-${half}px`; cur = h === "n" ? "ns-resize" : ""; }
                    if (h.includes("s")) { bottom = `-${half}px`; cur = h === "s" ? "ns-resize" : ""; }
                    if (h.includes("w")) { left = `-${half}px`; cur = h === "w" ? "ew-resize" : ""; }
                    if (h.includes("e")) { right = `-${half}px`; cur = h === "e" ? "ew-resize" : ""; }
                    if (!h.includes("n") && !h.includes("s")) { top = `calc(50% - ${half}px)`; }
                    if (!h.includes("w") && !h.includes("e")) { left = `calc(50% - ${half}px)`; }
                    if (h === "nw" || h === "se") cur = "nwse-resize";
                    if (h === "ne" || h === "sw") cur = "nesw-resize";
                    return (
                      <div
                        key={h}
                        onMouseDown={(e) => onHandleMouseDown(h, e)}
                        style={{
                          position: "absolute",
                          width: size, height: size,
                          left, top, right, bottom,
                          background: "#2dd879",
                          border: "2px solid #0e0f13",
                          borderRadius: isCorner ? 2 : 3,
                          cursor: cur,
                          zIndex: 2,
                        }}
                      />
                    );
                  })}
                  <div style={{
                    position: "absolute", bottom: -22, left: 0, fontSize: 11,
                    background: "#2dd879", color: "#0b2a18", padding: "2px 6px",
                    borderRadius: 4, fontWeight: 600, whiteSpace: "nowrap",
                  }}>
                    BURACO DA WEBCAM (arraste / redimensione)
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
              {cutout && (
                <button onClick={() => setCutout(null)}>
                  Remover buraco
                </button>
              )}
            </div>

            {!screenStream && (
              <div style={{
                marginTop: 12, padding: 12,
                background: "#1a2a18", border: "1px solid #2dd879", borderRadius: 8, fontSize: 13,
              }}>
                <strong style={{ color: "#2dd879" }}>Importante para 60fps:</strong> no picker que aparecer,
                escolha <strong>"Aba do Chrome"</strong> (NAO "Janela" nem "Tela inteira"). O Chrome trava a
                captura de janela/tela em 30fps; so a aba consegue 60fps.
              </div>
            )}

            <p style={{ fontSize: 12, opacity: 0.7, marginTop: 8, maxWidth: 700 }}>
              <strong>Como funciona:</strong> clique e arraste no preview pra desenhar o buraco onde a webcam aparece na sua live da Kick.
              Depois pode arrastar pra mover, ou puxar os pontos verdes nos cantos pra redimensionar.
              O viewer ve o buraco transparente e a webcam da Kick por baixo. Zero CPU gasto com webcam, 100% no encoder.
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
