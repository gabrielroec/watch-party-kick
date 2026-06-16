(function () {
  const slug = window.WPK_STREAMER_SLUG;
  const cfg = window.WPK_CONFIG || {};
  const backend = cfg.backendUrl || "https://watchpartykick.duckdns.org";

  const list = document.getElementById("list");

  function fmtDuration(ms) {
    if (!ms) return "—";
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}h${String(m).padStart(2, "0")}`;
    if (m > 0) return `${m}m${String(s).padStart(2, "0")}`;
    return `${s}s`;
  }

  function fmtSize(bytes) {
    if (!bytes) return "—";
    const mb = bytes / 1024 / 1024;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
  }

  function fmtDate(ts) {
    const d = new Date(ts);
    return d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  fetch(`${backend}/api/streamers/${slug}/recordings`)
    .then((r) => {
      if (!r.ok) throw new Error(`backend ${r.status}`);
      return r.json();
    })
    .then((recs) => {
      if (!Array.isArray(recs) || recs.length === 0) {
        list.innerHTML = '<p class="empty">Nenhuma gravação ainda.</p>';
        return;
      }
      list.innerHTML = "";
      for (const r of recs) {
        const card = document.createElement("a");
        card.className = "vod-card";
        card.href = `/vods/${slug}/play?id=${encodeURIComponent(r.id)}`;
        card.innerHTML = `
          <div>
            <div class="vod-title">${r.title ? escapeHtml(r.title) : fmtDate(r.startedAt)}</div>
            <div class="vod-meta">${fmtDate(r.startedAt)} · ${fmtDuration(r.durationMs)} · ${fmtSize(r.sizeBytes)}</div>
          </div>
          <span class="vod-room">${escapeHtml(r.roomCode)}</span>
        `;
        list.appendChild(card);
      }
    })
    .catch((err) => {
      console.error(err);
      list.innerHTML = `<p class="empty">Erro ao carregar: ${escapeHtml(err.message)}</p>`;
    });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }
})();
