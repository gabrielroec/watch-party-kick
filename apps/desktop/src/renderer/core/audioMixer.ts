// Mixa múltiplas tracks de áudio em uma única MediaStreamTrack
// usando WebAudio AudioContext. Streamer pode ligar mic + audio do sistema
// e o viewer recebe um único audio track misturado.

// Verifica se há sinal de áudio numa MediaStreamTrack — útil pra diagnosticar
// tracks "live" mas mudas. Retorna RMS médio em N samples.
export async function probeAudioLevel(track: MediaStreamTrack, durationMs = 1000): Promise<number> {
  if (track.kind !== "audio") return 0;
  const ctx = new AudioContext();
  try {
    if (ctx.state === "suspended") await ctx.resume();
    const stream = new MediaStream([track]);
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const samples: number[] = [];
    const interval = 100;
    const iters = Math.ceil(durationMs / interval);
    for (let i = 0; i < iters; i++) {
      await new Promise((r) => setTimeout(r, interval));
      analyser.getFloatTimeDomainData(buf);
      let sumSq = 0;
      for (let j = 0; j < buf.length; j++) sumSq += buf[j] * buf[j];
      samples.push(Math.sqrt(sumSq / buf.length));
    }
    source.disconnect();
    return samples.reduce((a, b) => a + b, 0) / samples.length;
  } finally {
    ctx.close().catch(() => {});
  }
}

export interface AudioMixer {
  outputTrack: MediaStreamTrack;
  addSource: (key: string, stream: MediaStream) => void;
  removeSource: (key: string) => void;
  stop: () => void;
}

export function createAudioMixer(): AudioMixer {
  const ctx = new AudioContext();
  const destination = ctx.createMediaStreamDestination();
  const sources = new Map<string, MediaStreamAudioSourceNode>();

  const ensureRunning = (): void => {
    if (ctx.state === "suspended") {
      ctx.resume().catch((e) => console.warn("[audioMixer] resume failed", e));
    }
  };
  ensureRunning();

  return {
    outputTrack: destination.stream.getAudioTracks()[0],
    addSource: (key, stream) => {
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) return;
      if (sources.has(key)) {
        sources.get(key)!.disconnect();
      }
      const source = ctx.createMediaStreamSource(stream);
      source.connect(destination);
      sources.set(key, source);
      ensureRunning();
    },
    removeSource: (key) => {
      const source = sources.get(key);
      if (source) {
        source.disconnect();
        sources.delete(key);
      }
    },
    stop: () => {
      sources.forEach((s) => s.disconnect());
      sources.clear();
      ctx.close().catch(() => {});
    },
  };
}
