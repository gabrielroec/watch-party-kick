// WebSocket leve para estado/presenca da sala.
// NAO transporta video: isso vai pelo LiveKit. Aqui fica:
// - contagem de viewers (presenca)
// - flags do host (webcam on/off, mic on/off, nome da fonte)
// - heartbeat de latencia
//
// Essas infos alimentam o HUD da extensao (ex.: "mic mutado pelo streamer")
// e metricas do painel sem poluir o canal WebRTC.

import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";
import type { Server } from "http";
import type { WsMessage } from "@wpk/shared";
import { getRoom } from "./rooms.js";

interface Client {
  ws: WebSocket;
  roomCode: string;
  identity: string;
  role: "host" | "viewer";
}

const clients = new Set<Client>();

function send(ws: WebSocket, msg: WsMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastRoom(roomCode: string, msg: WsMessage) {
  for (const c of clients) if (c.roomCode === roomCode) send(c.ws, msg);
}

function broadcastPresence(roomCode: string) {
  const room = getRoom(roomCode);
  if (!room) return;
  let viewers = 0;
  let hostOnline = false;
  for (const c of clients) {
    if (c.roomCode !== roomCode) continue;
    if (c.role === "viewer") viewers++;
    if (c.role === "host") hostOnline = true;
  }
  broadcastRoom(roomCode, { type: "presence", viewers, hostOnline });
}

export function attachWebSocketServer(httpServer: Server) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws, req) => {
    // Query: /ws?room=ABC123&identity=host-xxx&role=host
    const url = new URL(req.url ?? "", "http://localhost");
    const roomCode = (url.searchParams.get("room") ?? "").toUpperCase();
    const identity = url.searchParams.get("identity") ?? "";
    const role = (url.searchParams.get("role") ?? "viewer") as "host" | "viewer";

    const room = getRoom(roomCode);
    if (!room || !identity) {
      ws.close(1008, "sala invalida");
      return;
    }

    const client: Client = { ws, roomCode, identity, role };
    clients.add(client);

    if (role === "host") {
      room.hostIdentity = identity;
    } else {
      room.viewers.add(identity);
    }

    send(ws, { type: "hello", roomCode, role, identity });
    broadcastPresence(roomCode);
    // Ao entrar, o viewer recebe o ultimo estado conhecido do host.
    send(ws, {
      type: "host-state",
      webcamOn: room.hostState.webcamOn,
      micOn: room.hostState.micOn,
      sourceLabel: room.hostState.sourceLabel,
    });

    ws.on("message", (raw) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // Viewers nao podem publicar state: host eh a fonte da verdade.
      if (msg.type === "host-state" && role === "host") {
        room.hostState = {
          webcamOn: msg.webcamOn,
          micOn: msg.micOn,
          sourceLabel: msg.sourceLabel,
        };
        broadcastRoom(roomCode, msg);
      } else if (msg.type === "ping") {
        send(ws, { type: "pong", t: msg.t });
      }
    });

    ws.on("close", () => {
      clients.delete(client);
      if (role === "host" && room.hostIdentity === identity) {
        room.hostIdentity = null;
      } else {
        room.viewers.delete(identity);
      }
      broadcastPresence(roomCode);
    });
  });

  return wss;
}
