// Bridge ISOLATED world. MAIN world não tem acesso a chrome.runtime; ele
// posta via window.postMessage e a gente repassa pro service worker.

window.addEventListener("message", (ev) => {
  if (ev.source !== window) return;
  const data = ev.data as { __wpk?: string; token?: string } | null;
  if (!data || data.__wpk !== "kick-bearer" || typeof data.token !== "string") return;
  chrome.runtime.sendMessage({ kind: "kick-bearer", token: data.token }).catch(() => {});
});
