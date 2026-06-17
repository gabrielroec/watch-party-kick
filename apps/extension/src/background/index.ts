import { BACKEND_URL, STORAGE_LAST_ROOM, STORAGE_SESSION } from "../config";

let playerWindowId: number | null = null;

type ExtMessage =
  | { kind: "join-room"; code: string }
  | { kind: "leave-room" }
  | { kind: "get-last-room" };

type ExtResponse = { ok: true; data?: unknown } | { ok: false; error: string };

chrome.runtime.onMessage.addListener(
  (msg: ExtMessage, _sender, sendResponse: (r: ExtResponse) => void) => {
    handleMessage(msg)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  },
);

async function handleMessage(msg: ExtMessage): Promise<ExtResponse> {
  switch (msg.kind) {
    case "join-room":
      return joinRoom(msg.code);
    case "leave-room":
      return leaveRoom();
    case "get-last-room":
      return getLastRoom();
  }
}

async function joinRoom(code: string): Promise<ExtResponse> {
  const response = await fetch(
    `${BACKEND_URL}/api/rooms/${encodeURIComponent(code)}/join`,
    { method: "POST" },
  );
  if (!response.ok) {
    return { ok: false, error: `backend ${response.status}` };
  }
  const session = await response.json();
  await chrome.storage.local.set({
    [STORAGE_LAST_ROOM]: code,
    [STORAGE_SESSION]: session,
  });
  await openPlayerWindow();
  return { ok: true };
}

async function leaveRoom(): Promise<ExtResponse> {
  await chrome.storage.local.remove(STORAGE_SESSION);
  if (playerWindowId != null) {
    await chrome.windows.remove(playerWindowId).catch(() => {});
    playerWindowId = null;
  }
  return { ok: true };
}

async function getLastRoom(): Promise<ExtResponse> {
  const result = await chrome.storage.local.get(STORAGE_LAST_ROOM);
  return { ok: true, data: result[STORAGE_LAST_ROOM] ?? null };
}

async function openPlayerWindow(): Promise<void> {
  const url = chrome.runtime.getURL("src/player/index.html");

  if (playerWindowId != null) {
    try {
      await chrome.windows.update(playerWindowId, { focused: true });
      return;
    } catch {
      playerWindowId = null;
    }
  }

  const created = await chrome.windows.create({
    url,
    type: "popup",
    width: 640,
    height: 360,
  });
  playerWindowId = created.id ?? null;
}

chrome.windows.onRemoved.addListener((id) => {
  if (id === playerWindowId) playerWindowId = null;
});
