// SQLite local. Um arquivo único em config.storagePath/wpk.sqlite.
// Zero infra de banco — só uma lib que abre o arquivo.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";
import type { RecordingMeta, RecordingStatus } from "@wpk/shared";

mkdirSync(config.storagePath, { recursive: true });

const db = new Database(join(config.storagePath, "wpk.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS recordings (
    id TEXT PRIMARY KEY,
    streamer_slug TEXT NOT NULL,
    room_code TEXT NOT NULL,
    title TEXT,
    filename TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK(status IN ('recording','finished','failed'))
  );
  CREATE INDEX IF NOT EXISTS idx_recordings_streamer
    ON recordings(streamer_slug, started_at DESC);
`);

interface RecordingRow {
  id: string;
  streamer_slug: string;
  room_code: string;
  title: string | null;
  filename: string;
  started_at: number;
  ended_at: number | null;
  size_bytes: number;
  status: RecordingStatus;
}

const rowToMeta = (r: RecordingRow): RecordingMeta => ({
  id: r.id,
  streamerSlug: r.streamer_slug,
  roomCode: r.room_code,
  title: r.title,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  durationMs: r.ended_at ? r.ended_at - r.started_at : null,
  sizeBytes: r.size_bytes,
  status: r.status,
});

const insertStmt = db.prepare(`
  INSERT INTO recordings (id, streamer_slug, room_code, title, filename, started_at, status)
  VALUES (@id, @streamer_slug, @room_code, @title, @filename, @started_at, 'recording')
`);

const findStmt = db.prepare(`SELECT * FROM recordings WHERE id = ?`);
const findFilenameStmt = db.prepare(`SELECT filename FROM recordings WHERE id = ?`);
const listByStreamerStmt = db.prepare(`
  SELECT * FROM recordings
  WHERE streamer_slug = ? AND status = 'finished'
  ORDER BY started_at DESC LIMIT 200
`);
const updateSizeStmt = db.prepare(
  `UPDATE recordings SET size_bytes = size_bytes + ? WHERE id = ?`,
);
const finishStmt = db.prepare(
  `UPDATE recordings SET status = 'finished', ended_at = ? WHERE id = ?`,
);
const failStmt = db.prepare(`UPDATE recordings SET status = 'failed' WHERE id = ?`);

export interface InsertRecordingParams {
  id: string;
  streamerSlug: string;
  roomCode: string;
  title: string | null;
  filename: string;
  startedAt: number;
}

export function insertRecording(p: InsertRecordingParams): void {
  insertStmt.run({
    id: p.id,
    streamer_slug: p.streamerSlug,
    room_code: p.roomCode,
    title: p.title,
    filename: p.filename,
    started_at: p.startedAt,
  });
}

export function findRecording(id: string): RecordingMeta | null {
  const row = findStmt.get(id) as RecordingRow | undefined;
  return row ? rowToMeta(row) : null;
}

export function findRecordingFilename(id: string): string | null {
  const row = findFilenameStmt.get(id) as { filename: string } | undefined;
  return row?.filename ?? null;
}

export function listRecordingsByStreamer(slug: string): RecordingMeta[] {
  const rows = listByStreamerStmt.all(slug) as RecordingRow[];
  return rows.map(rowToMeta);
}

export function bumpSize(id: string, bytes: number): void {
  updateSizeStmt.run(bytes, id);
}

export function finishRecording(id: string, endedAt: number): void {
  finishStmt.run(endedAt, id);
}

export function failRecording(id: string): void {
  failStmt.run(id);
}
