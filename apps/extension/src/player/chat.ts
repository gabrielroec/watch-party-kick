// Chat custom que renderiza exatamente como o chat da Kick:
// emotes via files.kick.com/emotes/<id>/fullsize, badges, reply context, cores.
// Dados vindos do mesmo Pusher WS que o site da Kick usa — é a mesma fonte.

interface KickIdentity {
  color?: string;
  badges?: KickBadge[];
}

interface KickBadge {
  type?: string;
  text?: string;
  count?: number;
  active?: boolean;
}

interface KickSender {
  id?: number;
  username?: string;
  slug?: string;
  identity?: KickIdentity;
}

interface KickMessageMetadata {
  original_sender?: { username?: string };
  original_message?: { content?: string };
}

interface KickMessageEvent {
  id?: string;
  content?: string;
  type?: string;
  created_at?: string;
  chatroom_id?: number;
  sender?: KickSender;
  metadata?: KickMessageMetadata;
}

interface PortPayload {
  kind: string;
  event?: string;
  data?: unknown;
  chatroomId?: number;
  state?: string;
  error?: string;
}

const MAX_MESSAGES = 200;

// Emotes vêm marcados como [emote:ID:nome] no content. A URL real da imagem
// está no CDN da Kick.
const EMOTE_REGEX = /\[emote:(\d+):([^\]]+)\]/g;

const BADGE_ICON: Record<string, string> = {
  broadcaster:  "📺",
  moderator:    "🛡",
  verified:     "✓",
  vip:          "⭐",
  og:           "🔥",
  founder:      "👑",
  staff:        "⚙",
  subscriber:   "★",
  sub_gifter:   "🎁",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c] as string);
}

function renderContent(text: string): string {
  let out = "";
  let last = 0;
  EMOTE_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMOTE_REGEX.exec(text)) != null) {
    if (m.index > last) out += escapeHtml(text.slice(last, m.index));
    const [, id, name] = m;
    out += `<img class="kc-emote" src="https://files.kick.com/emotes/${escapeHtml(id)}/fullsize" alt="${escapeHtml(name)}" title="${escapeHtml(name)}">`;
    last = m.index + m[0].length;
  }
  if (last < text.length) out += escapeHtml(text.slice(last));
  return out;
}

function renderBadges(badges: KickBadge[] | undefined): string {
  if (!badges || badges.length === 0) return "";
  return badges.map((b) => {
    const icon = BADGE_ICON[b.type ?? ""] ?? "•";
    const title = b.text ?? b.type ?? "";
    return `<span class="kc-badge" title="${escapeHtml(title)}">${icon}</span>`;
  }).join("");
}

function formatTime(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  } catch { return ""; }
}

function renderMessage(m: KickMessageEvent): HTMLDivElement | null {
  if (!m.content || !m.sender?.username) return null;

  const row = document.createElement("div");
  row.className = "kc-msg";

  // Reply preview (se for reply)
  const replyOriginal = m.metadata?.original_sender?.username;
  const replyContent = m.metadata?.original_message?.content;
  if (replyOriginal && replyContent) {
    const reply = document.createElement("div");
    reply.className = "kc-reply";
    reply.innerHTML = `↪ <span class="kc-reply-user">${escapeHtml(replyOriginal)}</span>: <span class="kc-reply-text">${escapeHtml(replyContent.slice(0, 80))}</span>`;
    row.appendChild(reply);
  }

  const head = document.createElement("div");
  head.className = "kc-line";

  const time = document.createElement("span");
  time.className = "kc-time";
  time.textContent = formatTime(m.created_at);
  head.appendChild(time);

  const badges = renderBadges(m.sender.identity?.badges);
  if (badges) {
    const bWrap = document.createElement("span");
    bWrap.className = "kc-badges";
    bWrap.innerHTML = badges;
    head.appendChild(bWrap);
  }

  const name = document.createElement("span");
  name.className = "kc-name";
  name.style.color = m.sender.identity?.color ?? "#75fd46";
  name.textContent = m.sender.username;
  head.appendChild(name);

  const sep = document.createElement("span");
  sep.className = "kc-sep";
  sep.textContent = ": ";
  head.appendChild(sep);

  const body = document.createElement("span");
  body.className = "kc-body";
  body.innerHTML = renderContent(m.content);
  head.appendChild(body);

  row.appendChild(head);
  return row;
}

export function mountKickChat(slug: string, root: HTMLElement): () => void {
  root.innerHTML = `
    <div class="kc-header">
      <span class="kc-title">Chat · ${escapeHtml(slug)}</span>
      <span class="kc-status" id="kc-status">conectando...</span>
    </div>
    <div class="kc-messages" id="kc-messages"></div>
    <form class="kc-form" id="kc-form">
      <input
        id="kc-input"
        class="kc-input"
        type="text"
        placeholder="Mande uma mensagem"
        maxlength="500"
        autocomplete="off"
      />
      <button id="kc-send" class="kc-send" type="submit">↵</button>
    </form>
    <div class="kc-error" id="kc-error" hidden></div>
  `;

  const messagesEl = root.querySelector<HTMLDivElement>("#kc-messages")!;
  const statusEl = root.querySelector<HTMLSpanElement>("#kc-status")!;
  const formEl = root.querySelector<HTMLFormElement>("#kc-form")!;
  const inputEl = root.querySelector<HTMLInputElement>("#kc-input")!;
  const sendBtn = root.querySelector<HTMLButtonElement>("#kc-send")!;
  const errorEl = root.querySelector<HTMLDivElement>("#kc-error")!;

  const showError = (msg: string | null): void => {
    if (!msg) { errorEl.hidden = true; return; }
    errorEl.hidden = false;
    errorEl.textContent = msg;
  };

  const appendMessage = (m: KickMessageEvent): void => {
    const row = renderMessage(m);
    if (!row) return;
    messagesEl.appendChild(row);
    while (messagesEl.children.length > MAX_MESSAGES) messagesEl.firstChild?.remove();
    const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
    if (nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  const handleEvent = (event: string, data: unknown): void => {
    // Kick dispara "App\Events\ChatMessageEvent", "App\Events\MessageDeletedEvent", etc.
    if (event.includes("ChatMessage") || event.includes("MessageEvent")) {
      appendMessage(data as KickMessageEvent);
    }
  };

  let port: chrome.runtime.Port | null = null;

  const connectPort = (): void => {
    port = chrome.runtime.connect({ name: `kick.chat:${slug}` });
    port.onMessage.addListener((payload: PortPayload) => {
      if (payload.kind === "kick.ready") {
        statusEl.textContent = "ao vivo";
      } else if (payload.kind === "kick.status") {
        statusEl.textContent = payload.state === "connected" ? "ao vivo"
          : payload.state === "reconnecting" ? "reconectando..."
          : payload.state ?? "?";
      } else if (payload.kind === "kick.event") {
        handleEvent(payload.event ?? "", payload.data);
      } else if (payload.kind === "kick.error") {
        statusEl.textContent = "offline";
        showError(payload.error ?? "erro");
      }
    });
    port.onDisconnect.addListener(() => {
      statusEl.textContent = "desconectado";
      port = null;
    });
  };
  connectPort();

  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text) return;
    sendBtn.disabled = true;
    showError(null);
    try {
      const resp = await chrome.runtime.sendMessage({
        kind: "kick-send",
        slug,
        content: text,
      }) as { ok: boolean; error?: string };
      if (resp.ok) {
        inputEl.value = "";
      } else {
        showError(resp.error ?? "erro ao enviar");
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : "erro desconhecido");
    } finally {
      sendBtn.disabled = false;
      inputEl.focus();
    }
  });

  return () => {
    try { port?.disconnect(); } catch { /* ignore */ }
    port = null;
  };
}
