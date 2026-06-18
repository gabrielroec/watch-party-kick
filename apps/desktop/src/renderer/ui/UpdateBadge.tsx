import { useEffect, useState } from "react";

type State =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string; percent: number }
  | { kind: "downloaded"; version: string }
  | { kind: "error"; message: string };

export function UpdateBadge() {
  const [current, setCurrent] = useState<string>("");
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    void window.wpk?.getVersion().then(setCurrent);
  }, []);

  useEffect(() => {
    const u = window.wpk?.updater;
    if (!u) return;

    const offs: Array<() => void> = [
      u.onChecking(() => setState({ kind: "checking" })),
      u.onAvailable((info) => setState({ kind: "available", version: info.version })),
      u.onNotAvailable(() => setState({ kind: "idle" })),
      u.onProgress((p) => {
        setState((prev) => ({
          kind: "downloading",
          version: prev.kind === "downloading" || prev.kind === "available"
            ? (prev as { version: string }).version
            : "",
          percent: p.percent,
        }));
      }),
      u.onDownloaded((info) => setState({ kind: "downloaded", version: info.version })),
      u.onError((err) => setState({ kind: "error", message: err.message })),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  const download = (): void => {
    void window.wpk?.updater.download();
    setState((prev) =>
      prev.kind === "available"
        ? { kind: "downloading", version: prev.version, percent: 0 }
        : prev,
    );
  };

  const install = (): void => {
    void window.wpk?.updater.install();
  };

  if (!current) return null;

  return (
    <div className="update-badge">
      {state.kind === "idle" && (
        <span className="update-pill">beta {current}</span>
      )}
      {state.kind === "checking" && (
        <span className="update-pill">verificando...</span>
      )}
      {state.kind === "available" && (
        <button className="update-pill new" onClick={download}>
          <span className="update-dot" />
          atualização {state.version} disponível · baixar
        </button>
      )}
      {state.kind === "downloading" && (
        <span className="update-pill progress">
          baixando {state.version} · {Math.round(state.percent)}%
        </span>
      )}
      {state.kind === "downloaded" && (
        <button className="update-pill ready" onClick={install}>
          <span className="update-dot" />
          {state.version} pronto · reiniciar e instalar
        </button>
      )}
      {state.kind === "error" && (
        <span className="update-pill error" title={state.message}>
          erro: {state.message.slice(0, 40)}
        </span>
      )}
    </div>
  );
}
