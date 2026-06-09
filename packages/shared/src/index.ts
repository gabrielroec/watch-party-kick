// @wpk/shared
// Tipos e constantes compartilhadas entre backend, painel e extensao.
// Centralizar aqui evita divergencia de schema entre os 3 clientes.

// Formato do codigo de sala que o streamer copia e o viewer cola.
// Mantemos curto e facil de ditar no chat (6 chars alfanumericos sem ambiguidade).
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I

// Papel do participante na sala. So o host publica midia; viewers so assinam.
export type ParticipantRole = "host" | "viewer";

// Payload enviado pelo backend ao painel/extensao com as credenciais prontas
// pra conectar direto no LiveKit. O backend nunca expoe api secret pro cliente:
// ele assina um JWT com permissoes minimas (publish ou subscribe conforme role).
export interface JoinRoomResponse {
  roomCode: string;        // codigo publico da sala (ABC123)
  livekitUrl: string;      // wss://... endpoint do LiveKit
  livekitToken: string;    // JWT assinado para essa sessao
  identity: string;        // identidade unica do participante dentro da sala
  role: ParticipantRole;
}

// Mensagens trocadas pelo canal WebSocket leve do nosso backend.
// Este canal NAO transporta video: so metadados/controle (presenca, toggles).
// Video e audio vao por LiveKit WebRTC direto.
export type WsMessage =
  | { type: "hello"; roomCode: string; role: ParticipantRole; identity: string }
  | { type: "presence"; viewers: number; hostOnline: boolean }
  | { type: "host-state"; webcamOn: boolean; micOn: boolean; sourceLabel: string | null }
  | { type: "ping"; t: number }
  | { type: "pong"; t: number };

// Parametros de layout da webcam sobreposta na cena composta.
// Sao aplicados pelo compositor canvas do painel (nao pelo viewer).
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
