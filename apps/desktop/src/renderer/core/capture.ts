// Captura dos sources: tela, webcam, microfone.
//
// Constraints de áudio são diferentes por fonte:
// - Tela (loopback do sistema): SEM echo cancel, noise sup, AGC. Esses
//   processamentos foram desenhados pra voz e estragam música/game audio.
//   48kHz stereo é o padrão de broadcast — preserva graves, separação de
//   instrumentos, espacialização de jogos.
// - Mic: COM echo cancel + noise sup + AGC pra voz limpa.

export async function captureScreen(withAudio: boolean): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: { ideal: 60, max: 60 },
      width: { ideal: 1920, max: 1920 },
      height: { ideal: 1080, max: 1080 },
    },
    audio: withAudio
      ? {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          // @ts-expect-error — googAutoGainControl é flag do Chromium pra desligar AGC2
          googAutoGainControl: false,
          sampleRate: 48000,
          channelCount: 2,
        }
      : false,
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

export async function captureMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 48000,
      channelCount: 1,
    },
    video: false,
  });
}
