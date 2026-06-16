// Endpoints de gravação VOD.
// Fluxo: start -> chunk* -> finish. Cada chunk é raw bytes appendados num .webm.
// Auth por header x-streamer-key conferido contra config.streamerKeys[slug].

import express, { Router, type Request, type Response, type Router as ExpressRouter } from "express";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";
import {
  bumpSize,
  failRecording,
  findRecording,
  findRecordingFilename,
  finishRecording,
  insertRecording,
  listRecordingsByStreamer,
} from "./db.js";
import type {
  FinishRecordingResponse,
  StartRecordingResponse,
} from "@wpk/shared";

const router: ExpressRouter = Router();

const RECORDINGS_DIR = join(config.storagePath, "recordings");
mkdirSync(RECORDINGS_DIR, { recursive: true });

const openWriters = new Map<string, ReturnType<typeof createWriteStream>>();

const slugSchema = z.string().regex(/^[a-z0-9-]{2,32}$/);
const jsonParser = express.json();

function validateStreamerKey(slug: string, key: string | undefined): boolean {
  if (!key) return false;
  const expected = config.streamerKeys[slug];
  return !!expected && expected === key;
}

function filenameFor(slug: string, id: string): string {
  return join(slug, `${id}.webm`);
}

function absolutePath(filename: string): string {
  return join(RECORDINGS_DIR, filename);
}

const startSchema = z.object({
  streamerKey: z.string().min(8),
  streamerSlug: slugSchema,
  roomCode: z.string().min(3).max(12),
  title: z.string().max(120).optional(),
});

router.post("/recordings/start", jsonParser, (req: Request, res: Response) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "payload invalido" });
    return;
  }
  const { streamerKey, streamerSlug, roomCode, title } = parsed.data;
  if (!validateStreamerKey(streamerSlug, streamerKey)) {
    res.status(401).json({ error: "streamer key invalida" });
    return;
  }

  const id = randomUUID();
  const filename = filenameFor(streamerSlug, id);
  mkdirSync(join(RECORDINGS_DIR, streamerSlug), { recursive: true });

  insertRecording({
    id,
    streamerSlug,
    roomCode: roomCode.toUpperCase(),
    title: title ?? null,
    filename,
    startedAt: Date.now(),
  });

  const stream = createWriteStream(absolutePath(filename));
  openWriters.set(id, stream);

  const body: StartRecordingResponse = { id };
  res.json(body);
});

// Chunk: raw stream. Não passar por body parser pra não bufferizar tudo em RAM.
router.post("/recordings/:id/chunk", (req: Request, res: Response) => {
  const id = req.params.id;
  const slugHeader = req.header("x-streamer-slug");
  const keyHeader = req.header("x-streamer-key");

  const rec = findRecording(id);
  if (!rec) {
    res.status(404).json({ error: "gravacao nao encontrada" });
    req.resume();
    return;
  }
  if (rec.status !== "recording") {
    res.status(409).json({ error: "gravacao ja finalizada" });
    req.resume();
    return;
  }
  if (slugHeader !== rec.streamerSlug || !validateStreamerKey(rec.streamerSlug, keyHeader)) {
    res.status(401).json({ error: "auth invalida" });
    req.resume();
    return;
  }

  const writer = openWriters.get(id);
  if (!writer) {
    res.status(409).json({ error: "writer ausente" });
    req.resume();
    return;
  }

  let total = 0;
  req.on("data", (chunk: Buffer) => {
    total += chunk.length;
    writer.write(chunk);
  });
  req.on("end", () => {
    bumpSize(id, total);
    res.status(204).end();
  });
  req.on("error", (err) => {
    console.error(`[recordings] chunk error id=${id}`, err);
    if (!res.headersSent) res.status(500).end();
  });
});

router.post("/recordings/:id/finish", jsonParser, (req: Request, res: Response) => {
  const id = req.params.id;
  const slugHeader = req.header("x-streamer-slug");
  const keyHeader = req.header("x-streamer-key");

  const rec = findRecording(id);
  if (!rec) {
    res.status(404).json({ error: "gravacao nao encontrada" });
    return;
  }
  if (slugHeader !== rec.streamerSlug || !validateStreamerKey(rec.streamerSlug, keyHeader)) {
    res.status(401).json({ error: "auth invalida" });
    return;
  }

  const writer = openWriters.get(id);
  if (writer) {
    writer.end();
    openWriters.delete(id);
  }

  const endedAt = Date.now();
  finishRecording(id, endedAt);

  const refreshed = findRecording(id);
  const body: FinishRecordingResponse = {
    id,
    durationMs: endedAt - rec.startedAt,
    sizeBytes: refreshed?.sizeBytes ?? rec.sizeBytes,
  };
  res.json(body);
});

router.post("/recordings/:id/abort", (req: Request, res: Response) => {
  const id = req.params.id;
  const slugHeader = req.header("x-streamer-slug");
  const keyHeader = req.header("x-streamer-key");

  const rec = findRecording(id);
  if (!rec) {
    res.status(404).json({ error: "gravacao nao encontrada" });
    return;
  }
  if (slugHeader !== rec.streamerSlug || !validateStreamerKey(rec.streamerSlug, keyHeader)) {
    res.status(401).json({ error: "auth invalida" });
    return;
  }

  const writer = openWriters.get(id);
  if (writer) {
    writer.end();
    openWriters.delete(id);
  }
  failRecording(id);
  res.status(204).end();
});

// Públicos — usados pela landing pra montar a página de VODs.
router.get("/streamers/:slug/recordings", (req: Request, res: Response) => {
  const slugParsed = slugSchema.safeParse(req.params.slug);
  if (!slugParsed.success) {
    res.status(400).json({ error: "slug invalido" });
    return;
  }
  res.json(listRecordingsByStreamer(slugParsed.data));
});

router.get("/recordings/:id", (req: Request, res: Response) => {
  const rec = findRecording(req.params.id);
  if (!rec || rec.status !== "finished") {
    res.status(404).json({ error: "nao encontrado" });
    return;
  }
  res.json(rec);
});

// Stream do .webm com Range pra suportar scrub no <video>.
router.get("/recordings/:id/stream", (req: Request, res: Response) => {
  const rec = findRecording(req.params.id);
  if (!rec) {
    res.status(404).end();
    return;
  }
  const filename = findRecordingFilename(req.params.id);
  if (!filename) {
    res.status(404).end();
    return;
  }
  const path = absolutePath(filename);
  if (!existsSync(path)) {
    res.status(404).end();
    return;
  }
  const total = statSync(path).size;
  const range = req.headers.range;
  res.setHeader("Content-Type", "video/webm");
  res.setHeader("Accept-Ranges", "bytes");

  if (!range) {
    res.setHeader("Content-Length", String(total));
    createReadStream(path).pipe(res);
    return;
  }

  const match = /bytes=(\d+)-(\d*)/.exec(range);
  if (!match) {
    res.status(416).end();
    return;
  }
  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : total - 1;
  if (start >= total || end >= total) {
    res.status(416).setHeader("Content-Range", `bytes */${total}`).end();
    return;
  }
  res.status(206);
  res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
  res.setHeader("Content-Length", String(end - start + 1));
  createReadStream(path, { start, end }).pipe(res);
});

export { router as recordingsRouter };
