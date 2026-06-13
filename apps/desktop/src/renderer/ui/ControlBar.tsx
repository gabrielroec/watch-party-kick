interface Props {
  sharing: boolean;
  webcamOn: boolean;
  busy: "screen" | "webcam" | null;
  onToggleShare: () => void;
  onToggleWebcam: () => void;
}

export function ControlBar({ sharing, webcamOn, busy, onToggleShare, onToggleWebcam }: Props) {
  return (
    <div className="controls">
      <button onClick={onToggleShare} disabled={busy === "screen"}>
        {busy === "screen" ? "Abrindo..." : sharing ? "Parar transmissão" : "Compartilhar tela"}
      </button>
      <button onClick={onToggleWebcam} disabled={busy === "webcam" || !sharing}>
        {busy === "webcam" ? "Abrindo..." : webcamOn ? "Desligar webcam" : "Ligar webcam"}
      </button>
    </div>
  );
}
