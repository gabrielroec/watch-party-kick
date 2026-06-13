import type { WebcamCorner, WebcamSize } from "../core/compositor";

interface Props {
  corner: WebcamCorner;
  size: WebcamSize;
  onCornerChange: (corner: WebcamCorner) => void;
  onSizeChange: (size: WebcamSize) => void;
}

const CORNER_LABELS: Record<WebcamCorner, string> = {
  "top-left": "↖ Topo Esq",
  "top-right": "↗ Topo Dir",
  "bottom-left": "↙ Base Esq",
  "bottom-right": "↘ Base Dir",
};

const SIZE_LABELS: Record<WebcamSize, string> = {
  small: "P",
  medium: "M",
  large: "G",
};

export function WebcamLayout({ corner, size, onCornerChange, onSizeChange }: Props) {
  return (
    <div className="card">
      <div className="label">Posição da webcam</div>
      <div className="corner-grid">
        {(Object.keys(CORNER_LABELS) as WebcamCorner[]).map((c) => (
          <button
            key={c}
            className={corner === c ? "primary" : ""}
            onClick={() => onCornerChange(c)}
          >
            {CORNER_LABELS[c]}
          </button>
        ))}
      </div>
      <div className="label" style={{ marginTop: 4 }}>Tamanho</div>
      <div className="size-row">
        {(Object.keys(SIZE_LABELS) as WebcamSize[]).map((s) => (
          <button
            key={s}
            className={size === s ? "primary" : ""}
            onClick={() => onSizeChange(s)}
          >
            {SIZE_LABELS[s]}
          </button>
        ))}
      </div>
    </div>
  );
}
