// Mixa múltiplas tracks de áudio em uma única MediaStreamTrack
// usando WebAudio AudioContext. Streamer pode ligar mic + audio do sistema
// e o viewer recebe um único audio track misturado.

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
