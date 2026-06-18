// Roda em MAIN world em qualquer aba kick.com. Captura o Bearer token da Kick
// monkey-patching window.fetch — qualquer XHR autenticado que o SPA dispara
// revela o Authorization header. O token vai pro extension via postMessage
// (a bridge em ISOLATED world repassa pro chrome.runtime).
//
// Por que precisamos do Bearer: o endpoint POST /api/v2/messages/send/<id>
// aceita session cookie OU Bearer; com Bearer evitamos depender só do XSRF
// cookie que rotaciona.

(() => {
  const post = (token: string): void => {
    window.postMessage({ __wpk: "kick-bearer", token }, window.location.origin);
  };

  // Sweep inicial em localStorage / sessionStorage — alguns builds da Kick
  // cacheiam o token lá com nomes variados.
  for (const k of ["kick-token", "auth_token", "access_token", "token"]) {
    try {
      const v = localStorage.getItem(k) ?? sessionStorage.getItem(k);
      if (v && v.length > 20) { post(v); break; }
    } catch { /* ignore */ }
  }

  // Wrap window.fetch. Toda chamada autenticada que o SPA da Kick faz tem
  // Authorization: Bearer <jwt> no header — pega na primeira que passar.
  const orig = window.fetch;
  window.fetch = function patched(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    try {
      const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const auth = h.get("authorization");
      if (auth && auth.startsWith("Bearer ")) post(auth.slice(7));
    } catch { /* ignore */ }
    return orig.call(this, input as RequestInfo, init);
  } as typeof window.fetch;
})();
