// @wpk/shared
// Tipos e constantes compartilhadas entre backend, painel e extensao.

export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I

export type ParticipantRole = "host" | "viewer";

// Payload de credenciais LiveKit. Streamer publica screen share como track
// unica. Webcam nao faz parte do pipeline: a webcam do streamer ja aparece
// naturalmente na live oficial dele na Kick — o overlay nao precisa duplicar.
export interface JoinRoomResponse {
  roomCode: string;
  livekitUrl: string;
  livekitToken: string;
  identity: string;
  role: ParticipantRole;
}

export interface CreateRoomResponse extends JoinRoomResponse {
  role: "host";
}

export function isCreateRoomResponse(r: JoinRoomResponse): r is CreateRoomResponse {
  return r.role === "host";
}

// Mensagens WS de controle leves. Video/audio vao por LiveKit WebRTC direto.
export type WsMessage =
  | { type: "hello"; roomCode: string; role: ParticipantRole; identity: string }
  | { type: "presence"; viewers: number; hostOnline: boolean }
  | { type: "host-state"; webcamOn: boolean; micOn: boolean; sourceLabel: string | null }
  | { type: "ping"; t: number }
  | { type: "pong"; t: number };
