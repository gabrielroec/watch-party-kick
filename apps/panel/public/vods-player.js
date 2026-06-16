(function () {
  const cfg = window.WPK_CONFIG || {};
  const backend = cfg.backendUrl || "https://watchpartykick.duckdns.org";

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");

  const video = document.getElementById("video");
  const titleEl = document.getElementById("title");
  const metaEl = document.getElementById("meta-line");

  function fmtDuration(ms) {
    if (!ms) return "—";
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
    if (m > 0) return `${m}m${String(s).padStart(2, "0")}s`;
    return `${s}s`;
  }

  function fmtDate(ts) {
    return new Date(ts).toLocaleString("pt-BR", {
      day: "2-digit", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  if (!id) {
    titleEl.textContent = "Falta o id no link";
    return;
  }

  fetch(`${backend}/api/recordings/${encodeURIComponent(id)}`)
    .then((r) => {
      if (!r.ok) throw new Error(`backend ${r.status}`);
      return r.json();
    })
    .then((rec) => {
      document.title = `${rec.title || rec.roomCode} · Watch Party`;
      titleEl.textContent = rec.title || `Live em ${rec.roomCode}`;
      metaEl.textContent = `${fmtDate(rec.startedAt)} · ${fmtDuration(rec.durationMs)} · sala ${rec.roomCode}`;
      video.src = `${backend}/api/recordings/${encodeURIComponent(id)}/stream`;
    })
    .catch((err) => {
      titleEl.textContent = "Não encontrei essa gravação";
      metaEl.textContent = err.message;
    });
})();
