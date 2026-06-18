(function () {
  const cfg = window.WPK_CONFIG || { downloads: {} };
  const ua = navigator.userAgent;
  const platform = (navigator.userAgentData?.platform || navigator.platform || "").toLowerCase();
  const isMac = /mac/i.test(ua) || platform.includes("mac");
  const isWin = /windows/i.test(ua) || platform.includes("win");
  // Apple Silicon detection: heurística (UA não fala, mas plataforma "MacIntel"
  // pode rodar Rosetta — então não é 100%). Padrão: Apple Silicon (M1+ é dominante).
  const isAppleSilicon = isMac && !/intel/i.test(ua);

  const macArm = document.getElementById("download-mac-arm");
  const macIntel = document.getElementById("download-mac-intel");
  const win = document.getElementById("download-win");

  function bindDownload(el, href) {
    if (!el) return;
    if (href) {
      el.href = href;
      el.setAttribute("download", "");
    } else {
      el.classList.add("disabled");
      el.title = "Em breve";
      const small = el.querySelector("small");
      if (small) small.textContent = "em breve";
    }
  }

  bindDownload(macArm, cfg.downloads.macAppleSilicon);
  bindDownload(macIntel, cfg.downloads.macIntel);
  bindDownload(win, cfg.downloads.win);

  // Recomenda o botão certo baseado no SO detectado
  if (isMac && isAppleSilicon && !macArm.classList.contains("disabled")) {
    macArm.classList.add("recommended");
  } else if (isMac && !macIntel.classList.contains("disabled")) {
    macIntel.classList.add("recommended");
  } else if (isWin && !win.classList.contains("disabled")) {
    win.classList.add("recommended");
  }
})();
