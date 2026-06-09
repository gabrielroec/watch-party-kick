// Ponto de entrada do backend.
// Expoe:
//   POST /api/rooms                   -> cria sala, devolve host token LiveKit
//   POST /api/rooms/:code/join        -> viewer pede token LiveKit pra entrar
//   GET  /health                      -> healthcheck
//   WS   /ws?room=...&identity=...    -> canal leve de presenca/estado
//
// O painel chama /api/rooms; a extensao chama /api/rooms/:code/join com o
// codigo que o viewer colar. Nenhum endpoint devolve api secret.

import http from "node:http";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { config } from "./config.js";
import { createRoom, getRoom, makeIdentity } from "./rooms.js";
import { issueLivekitToken } from "./livekit.js";
import { attachWebSocketServer } from "./ws.js";
import type { CreateRoomResponse, JoinRoomResponse } from "@wpk/shared";

const app = express();

app.use(express.json());
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (origin.startsWith("chrome-extension://")) return cb(null, true);
      if (origin.endsWith(".vercel.app")) return cb(null, true);
      if (config.allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`origin nao permitida: ${origin}`));
    },
  }),
);

app.get("/health", (_req, res) => {
  res.json({ ok: true, t: Date.now() });
});

// Streamer cria sala. Se mandar { code: "XPTO" } no body, usa esse código.
// Senão, gera um aleatório.
const createRoomSchema = z.object({ code: z.string().min(3).max(12).optional() });

app.post("/api/rooms", async (req, res) => {
  const parsed = createRoomSchema.safeParse(req.body);
  const customCode = parsed.success ? parsed.data.code?.toUpperCase() : undefined;
  const room = createRoom(customCode);

  // Webcam removida do pipeline — 100% do encoder budget no screen share.
  // Viewer ve a webcam nativa da Kick atraves de um cutout no overlay.
  const identity = makeIdentity("host");
  const livekitToken = await issueLivekitToken({
    roomCode: room.code,
    identity,
    role: "host",
  });

  const body: CreateRoomResponse = {
    roomCode: room.code,
    livekitUrl: config.livekit.url,
    livekitToken,
    identity,
    role: "host",
  };
  res.json(body);
});

// Viewer cola o codigo na extensao -> cai aqui.
const joinSchema = z.object({ code: z.string().min(4).max(12) });

app.post("/api/rooms/:code/join", async (req, res) => {
  const parsed = joinSchema.safeParse({ code: req.params.code });
  if (!parsed.success) {
    res.status(400).json({ error: "codigo invalido" });
    return;
  }
  const room = getRoom(parsed.data.code);
  if (!room) {
    res.status(404).json({ error: "sala nao encontrada" });
    return;
  }
  const identity = makeIdentity("viewer");
  const token = await issueLivekitToken({
    roomCode: room.code,
    identity,
    role: "viewer",
  });
  const body: JoinRoomResponse = {
    roomCode: room.code,
    livekitUrl: config.livekit.url,
    livekitToken: token,
    identity,
    role: "viewer",
  };
  res.json(body);
});

const httpServer = http.createServer(app);
attachWebSocketServer(httpServer);

httpServer.listen(config.port, "0.0.0.0", () => {
  console.log(`[backend] HTTP+WS rodando em http://0.0.0.0:${config.port}`);
  console.log(`[backend] LiveKit URL: ${config.livekit.url}`);
});
