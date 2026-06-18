import { useEffect, useState } from "react";
import type { DisplaySource } from "../wpk";

type Tab = "screens" | "windows";

export function DisplayPicker() {
  const [sources, setSources] = useState<DisplaySource[] | null>(null);
  const [tab, setTab] = useState<Tab>("screens");

  useEffect(() => {
    if (!window.wpk?.picker) return;
    const off = window.wpk.picker.onShow((s) => {
      setSources(s);
      // Default tab: se tem screen, mostra screens; senão windows
      const hasScreen = s.some((src) => src.id.startsWith("screen:"));
      setTab(hasScreen ? "screens" : "windows");
    });
    return off;
  }, []);

  if (!sources) return null;

  const screens = sources.filter((s) => s.id.startsWith("screen:"));
  const windows = sources.filter((s) => s.id.startsWith("window:"));
  const visible = tab === "screens" ? screens : windows;

  const cancel = (): void => {
    window.wpk?.picker.select(null);
    setSources(null);
  };

  const choose = (id: string): void => {
    window.wpk?.picker.select(id);
    setSources(null);
  };

  return (
    <div className="dp-overlay" onClick={cancel}>
      <div className="dp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dp-header">
          <h2>Compartilhar tela</h2>
          <button className="dp-close" onClick={cancel} aria-label="Cancelar">✕</button>
        </div>

        <div className="dp-tabs">
          <button
            className={tab === "screens" ? "active" : ""}
            onClick={() => setTab("screens")}
            disabled={screens.length === 0}
          >
            🖥 Telas inteiras ({screens.length})
          </button>
          <button
            className={tab === "windows" ? "active" : ""}
            onClick={() => setTab("windows")}
            disabled={windows.length === 0}
          >
            🪟 Janelas ({windows.length})
          </button>
        </div>

        <div className="dp-grid">
          {visible.length === 0 && (
            <div className="dp-empty">Nada encontrado nessa categoria.</div>
          )}
          {visible.map((src) => (
            <button
              key={src.id}
              className="dp-card"
              onClick={() => choose(src.id)}
              title={src.name}
            >
              <div className="dp-thumb">
                <img src={src.thumbnail} alt={src.name} />
              </div>
              <div className="dp-label">
                {src.appIcon && <img className="dp-icon" src={src.appIcon} alt="" />}
                <span className="dp-name">{src.name}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="dp-footer">
          <small>O áudio do sistema vai junto automaticamente (loopback).</small>
          <button className="dp-cancel" onClick={cancel}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
