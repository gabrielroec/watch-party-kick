// Cliente Kick: Pusher WebSocket (mensagens) + REST API (envio + chatroomId).
//
// Por que aqui no SW e não no player: WebSocket no SW é mantido vivo enquanto
// a port long-lived do player tiver aberta. E o SW tem acesso a chrome.cookies
// (que o player não tem direto).

const PUSHER_KEY = "32cbd69e4b950bf97679";
const PUSHER_URL = (key: string): string =>
  `wss://ws-us2.pusher.com/app/${key}?protocol=7&client=js&version=8.4.0&flash=false`;
const FALLBACK_KEYS = ["eb1d5f283081a78b932c"];

type Frame = { event: string; data?: string; channel?: string };

interface Sub {
  slug: string;
  chatroomId: number;
  ws: WebSocket | null;
  ports: Set<chrome.runtime.Port>;
  retry: number;
  closed: boolean;
}

const subs = new Map<string, Sub>();

async function getChatroomId(slug: string): Promise<number> {
  const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`channel ${slug} -> HTTP ${res.status}`);
  const json = await res.json() as { chatroom?: { id?: number } };
  const id = json.chatroom?.id;
  if (typeof id !== "number") throw new Error("chatroom id missing");
  return id;
}

function broadcast(sub: Sub, payload: unknown): void {
  for (const p of sub.ports) {
    try { p.postMessage(payload); } catch { /* ignore */ }
  }
}

function openSocket(sub: Sub, keyIdx = 0): void {
  if (sub.closed) return;
  const key = keyIdx === 0 ? PUSHER_KEY : FALLBACK_KEYS[keyIdx - 1];
  if (!key) return;

  const ws = new WebSocket(PUSHER_URL(key));
  sub.ws = ws;

  ws.onopen = () => {
    ws.send(JSON.stringify({
      event: "pusher:subscribe",
      data: { auth: "", channel: `chatrooms.${sub.chatroomId}.v2` },
    }));
    broadcast(sub, { kind: "kick.status", state: "connected" });
    sub.retry = 0;
  };

  ws.onmessage = (ev) => {
    let frame: Frame;
    try { frame = JSON.parse(ev.data); } catch { return; }
    if (frame.event === "pusher:ping") {
      ws.send(JSON.stringify({ event: "pusher:pong" }));
      return;
    }
    if (frame.event === "pusher:error") {
      // 4001/4007 = invalid app key → rotate
      if (keyIdx < FALLBACK_KEYS.length) {
        try { ws.close(); } catch { /* ignore */ }
        openSocket(sub, keyIdx + 1);
      }
      return;
    }
    let data: unknown = frame.data;
    if (typeof frame.data === "string") {
      try { data = JSON.parse(frame.data); } catch { /* keep string */ }
    }
    broadcast(sub, { kind: "kick.event", event: frame.event, data });
  };

  ws.onclose = () => {
    if (sub.closed || sub.ports.size === 0) return;
    sub.retry++;
    const delay = Math.min(30_000, 500 * 2 ** sub.retry);
    broadcast(sub, { kind: "kick.status", state: "reconnecting" });
    setTimeout(() => openSocket(sub, 0), delay);
  };

  ws.onerror = () => {
    broadcast(sub, { kind: "kick.status", state: "error" });
  };
}

export async function attachPort(port: chrome.runtime.Port, slug: string): Promise<void> {
  let sub = subs.get(slug);
  if (!sub) {
    const chatroomId = await getChatroomId(slug);
    sub = { slug, chatroomId, ws: null, ports: new Set(), retry: 0, closed: false };
    subs.set(slug, sub);
    openSocket(sub);
  }
  sub.ports.add(port);
  port.postMessage({ kind: "kick.ready", chatroomId: sub.chatroomId });

  port.onDisconnect.addListener(() => {
    if (!sub) return;
    sub.ports.delete(port);
    if (sub.ports.size === 0) {
      sub.closed = true;
      try { sub.ws?.close(); } catch { /* ignore */ }
      subs.delete(slug);
    }
  });
}

export interface SendResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export async function sendMessage(slug: string, content: string): Promise<SendResult> {
  let chatroomId = subs.get(slug)?.chatroomId;
  if (chatroomId == null) chatroomId = await getChatroomId(slug);

  const xsrf = await chrome.cookies.get({ url: "https://kick.com", name: "XSRF-TOKEN" });
  if (!xsrf) return { ok: false, error: "Você não está logado na Kick. Abra kick.com e faça login." };

  const { kickBearer } = await chrome.storage.session.get("kickBearer");

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "accept": "application/json",
    "x-xsrf-token": decodeURIComponent(xsrf.value),
    "cluster": "v2",
  };
  if (kickBearer) headers["authorization"] = `Bearer ${kickBearer}`;

  const url = `https://kick.com/api/v2/messages/send/${chatroomId}`;

  const tryOnce = async (): Promise<Response> => fetch(url, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify({ content, type: "message" }),
  });

  let res = await tryOnce();
  if (res.status === 419) {
    // CSRF rotacionou — warm-up + retry
    await fetch("https://kick.com/api/v1/user", { credentials: "include" }).catch(() => {});
    const fresh = await chrome.cookies.get({ url: "https://kick.com", name: "XSRF-TOKEN" });
    if (fresh) headers["x-xsrf-token"] = decodeURIComponent(fresh.value);
    res = await tryOnce();
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: body.slice(0, 200) };
  }
  return { ok: true, status: res.status };
}

export async function storeBearer(token: string): Promise<void> {
  await chrome.storage.session.set({ kickBearer: token });
}
