// Compositor de cena estilo OBS, mas tudo no browser.
// Recebe dois MediaStreams (tela + webcam), desenha num canvas e entrega
// de volta UM unico MediaStream de video composto + uma track de audio
// mixada (audio da tela + mic do host, com gain por fonte).
//
// Essa stream composta eh o que o painel publica no LiveKit. Viewers recebem
// uma unica track de video (renderizada no overlay da extensao) e uma track
// de audio (tocada junto).

import type { SceneLayout } from "@wpk/shared";

export interface CompositorInputs {
  screen: MediaStream | null;   // getDisplayMedia
  webcam: MediaStream | null;   // getUserMedia (video+audio)
  mic: MediaStream | null;      // getUserMedia (audio only) — se separado
}

export interface CompositorOptions {
  width: number;                // ex.: 1280
  height: number;               // ex.: 720
  fps: number;                  // ex.: 30
}

export interface CompositorOutput {
  videoStream: MediaStream;     // video composto (1 track)
  audioStream: MediaStream;     // audio mixado (1 track)
  setLayout: (layout: SceneLayout) => void;
  setMicEnabled: (enabled: boolean) => void;
  setScreenAudioEnabled: (enabled: boolean) => void;
  stop: () => void;
}

export function createCompositor(
  inputs: CompositorInputs,
  options: CompositorOptions,
): CompositorOutput {
  const { width, height, fps } = options;

  // ===== VIDEO =====
  // Canvas offscreen onde a cena eh desenhada a cada frame.
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context indisponivel");

  // Video elements "escondidos" so pra ler frames dos streams e desenhar.
  const screenVideo = document.createElement("video");
  screenVideo.muted = true;
  screenVideo.playsInline = true;
  if (inputs.screen) {
    screenVideo.srcObject = inputs.screen;
    screenVideo.play().catch(() => {});
  }

  const webcamVideo = document.createElement("video");
  webcamVideo.muted = true;
  webcamVideo.playsInline = true;
  if (inputs.webcam) {
    webcamVideo.srcObject = inputs.webcam;
    webcamVideo.play().catch(() => {});
  }

  let layout: SceneLayout = {
    webcamCorner: "bottom-right",
    webcamSize: "M",
    webcamVisible: true,
  };

  // Tamanhos relativos do PiP da webcam (em fracao da largura do canvas).
  const webcamSizeFraction: Record<SceneLayout["webcamSize"], number> = {
    S: 0.18,
    M: 0.25,
    L: 0.34,
  };
  const PIP_PADDING = 24;

  let running = true;
  let rafId = 0;

  function drawFrame() {
    if (!running) return;

    ctx!.fillStyle = "#000";
    ctx!.fillRect(0, 0, width, height);

    // Camada 1: tela selecionada como fundo, preservando aspect ratio via "contain".
    if (screenVideo.videoWidth > 0) {
      const sw = screenVideo.videoWidth;
      const sh = screenVideo.videoHeight;
      const scale = Math.min(width / sw, height / sh);
      const dw = sw * scale;
      const dh = sh * scale;
      const dx = (width - dw) / 2;
      const dy = (height - dh) / 2;
      ctx!.drawImage(screenVideo, dx, dy, dw, dh);
    }

    // Camada 2: webcam PiP, se visivel e com frame pronto.
    if (layout.webcamVisible && webcamVideo.videoWidth > 0) {
      const ww = width * webcamSizeFraction[layout.webcamSize];
      const aspect = webcamVideo.videoWidth / webcamVideo.videoHeight;
      const wh = ww / aspect;

      let wx = PIP_PADDING;
      let wy = PIP_PADDING;
      if (layout.webcamCorner.includes("right")) wx = width - ww - PIP_PADDING;
      if (layout.webcamCorner.includes("bottom")) wy = height - wh - PIP_PADDING;

      // Sombra discreta pra destacar o PiP do fundo.
      ctx!.save();
      ctx!.shadowColor = "rgba(0,0,0,0.6)";
      ctx!.shadowBlur = 16;
      ctx!.drawImage(webcamVideo, wx, wy, ww, wh);
      ctx!.restore();
    }

    rafId = requestAnimationFrame(drawFrame);
  }
  drawFrame();

  // Gera MediaStream a partir do canvas: esse eh o video que vai pro LiveKit.
  const videoStream = canvas.captureStream(fps);

  // ===== AUDIO =====
  // Mixagem de 2 fontes de audio (tela + mic) em 1 track via WebAudio.
  // GainNodes permitem toggle em tempo real sem derrubar a conexao do LiveKit.
  const AudioCtx: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioCtx();

  const destination = audioCtx.createMediaStreamDestination();

  let screenGain: GainNode | null = null;
  let micGain: GainNode | null = null;

  if (inputs.screen && inputs.screen.getAudioTracks().length > 0) {
    const src = audioCtx.createMediaStreamSource(new MediaStream(inputs.screen.getAudioTracks()));
    screenGain = audioCtx.createGain();
    screenGain.gain.value = 1;
    src.connect(screenGain).connect(destination);
  }
  const micSource = inputs.mic ?? inputs.webcam;
  if (micSource && micSource.getAudioTracks().length > 0) {
    const src = audioCtx.createMediaStreamSource(new MediaStream(micSource.getAudioTracks()));
    micGain = audioCtx.createGain();
    micGain.gain.value = 0; // comeca mutado: streamer liga manualmente quando quer falar
    src.connect(micGain).connect(destination);
  }

  const audioStream = destination.stream;

  function setLayout(next: SceneLayout) {
    layout = next;
  }
  function setMicEnabled(enabled: boolean) {
    if (micGain) micGain.gain.value = enabled ? 1 : 0;
  }
  function setScreenAudioEnabled(enabled: boolean) {
    if (screenGain) screenGain.gain.value = enabled ? 1 : 0;
  }

  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
    videoStream.getTracks().forEach((t) => t.stop());
    audioStream.getTracks().forEach((t) => t.stop());
    audioCtx.close().catch(() => {});
  }

  return {
    videoStream,
    audioStream,
    setLayout,
    setMicEnabled,
    setScreenAudioEnabled,
    stop,
  };
}
