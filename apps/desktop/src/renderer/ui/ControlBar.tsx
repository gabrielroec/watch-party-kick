interface Props {
  sharing: boolean;
  webcamOn: boolean;
  micOn: boolean;
  recording: boolean;
  recordingDurationMs: number;
  busy: "screen" | "webcam" | "mic" | "recording" | null;
  onToggleShare: () => void;
  onToggleWebcam: () => void;
  onToggleMic: () => void;
  onToggleRecording: () => void;
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ControlBar({
  sharing,
  webcamOn,
  micOn,
  recording,
  recordingDurationMs,
  busy,
  onToggleShare,
  onToggleWebcam,
  onToggleMic,
  onToggleRecording,
}: Props) {
  return (
    <div className="controls">
      <button onClick={onToggleShare} disabled={busy === "screen"}>
        {busy === "screen" ? "Abrindo..." : sharing ? "Parar transmissão" : "Compartilhar tela"}
      </button>
      <button onClick={onToggleWebcam} disabled={busy === "webcam" || !sharing}>
        {busy === "webcam" ? "Abrindo..." : webcamOn ? "Desligar webcam" : "Ligar webcam"}
      </button>
      <button onClick={onToggleMic} disabled={busy === "mic" || !sharing}>
        {busy === "mic" ? "Abrindo..." : micOn ? "🎙️ Mic ON" : "🎙️ Mic OFF"}
      </button>
      <button
        onClick={onToggleRecording}
        disabled={busy === "recording" || !sharing}
        className={recording ? "recording" : ""}
      >
        {busy === "recording"
          ? "Salvando..."
          : recording
            ? `⏹️ Parar (${formatDuration(recordingDurationMs)})`
            : "🔴 Gravar"}
      </button>
    </div>
  );
}
