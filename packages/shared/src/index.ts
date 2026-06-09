// @wpk/shared
// Tipos e constantes compartilhadas entre backend, painel e extensao.

export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I

export type ParticipantRole = "host" | "viewer";

// Payload de credenciais LiveKit. Host recebe CreateRoomResponse (com 1 token).
// Webcam foi removida do pipeline: viewers veem a webcam nativa da Kick atraves
// de um "buraco" (cutout) no overlay. Foco 100% no encoder do screen share.
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

// Retangulo do cutout em coordenadas NORMALIZADAS (0-1) relativas ao bounding
// box do overlay. O viewer aplica como buraco transparente via SVG mask, e
// o player nativo da Kick aparece por baixo (incluindo a webcam do streamer
// que ja faz parte da live oficial dele).
export interface ScreenCutout {
  x: number;  // 0-1
  y: number;  // 0-1
  w: number;  // 0-1
  h: number;  // 0-1
}

// Mensagens WS de controle. Vide cutout pra sincronizar o "buraco" da webcam
// (replicado em todos os viewers).
export type WsMessage =
  | { type: "hello"; roomCode: string; role: ParticipantRole; identity: string }
  | { type: "presence"; viewers: number; hostOnline: boolean }
  | { type: "host-state"; webcamOn: boolean; micOn: boolean; sourceLabel: string | null }
  | { type: "cutout"; cutout: ScreenCutout | null }
  | { type: "ping"; t: number }
  | { type: "pong"; t: number };

export type WebcamCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type WebcamSize = "S" | "M" | "L";

export interface SceneLayout {
  webcamCorner: WebcamCorner;
  webcamSize: WebcamSize;
  webcamVisible: boolean;
}

export const DEFAULT_SCENE_LAYOUT: SceneLayout = {
  webcamCorner: "bottom-right",
  webcamSize: "M",
  webcamVisible: true,
};
