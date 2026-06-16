(function () {
  const cfg = window.WPK_CONFIG || { downloads: {} };
  const ua = navigator.userAgent;
  const isMac = /Mac/i.test(ua);
  const isWin = /Windows/i.test(ua);

  const mac = document.getElementById("download-mac");
  const win = document.getElementById("download-win");

  function bindDownload(el, href) {
    if (href) {
      el.href = href;
    } else {
      el.classList.add("disabled");
      el.title = "Em breve";
      const small = el.querySelector("small");
      if (small) small.textContent = "em breve";
    }
  }

  bindDownload(mac, cfg.downloads.mac);
  bindDownload(win, cfg.downloads.win);

  if (isMac && !mac.classList.contains("disabled")) mac.classList.add("recommended");
  if (isWin && !win.classList.contains("disabled")) win.classList.add("recommended");
})();
