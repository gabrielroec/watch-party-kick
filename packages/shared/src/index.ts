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
//
// IMPORTANTE: pro fluxo de HOST, o servidor responde com CreateRoomResponse
// (subtipo abaixo) que inclui credenciais de DOIS participantes LiveKit pro
// mesmo roomCode — main (screen) + cam (webcam) — pra rodar 2 PeerConnections
// independentes no navegador do host. Viewers continuam recebendo apenas o
// JoinRoomResponse padrao.
export interface JoinRoomResponse {
  roomCode: string;        // codigo publico da sala (ABC123)
  livekitUrl: string;      // wss://... endpoint do LiveKit
  livekitToken: string;    // JWT assinado para essa sessao (MAIN p/ host)
  identity: string;        // identidade unica do participante (MAIN p/ host)
  role: ParticipantRole;
}

// Resposta do POST /api/rooms (criacao pelo host).
// Estende JoinRoomResponse mantendo livekitToken/identity como MAIN
// (compat legacy), e adiciona o par camToken/camIdentity pro webcam-PC.
// Ambas as credenciais sao pro MESMO roomCode no LiveKit; LiveKit aceita
// como 2 participantes distintos porque as identities tem prefixos
// diferentes (host-<nonce> vs cam-<nonce>).
export interface CreateRoomResponse extends JoinRoomResponse {
  role: "host";
  mainToken: string;
  mainIdentity: string;
  camToken: string;
  camIdentity: string;
}

// Narrowing guard pra fluxo de host. Use em vez de cast manual nos call-sites.
export function isCreateRoomResponse(r: JoinRoomResponse): r is CreateRoomResponse {
  return (
    r.role === "host" &&
    typeof (r as CreateRoomResponse).camToken === "string" &&
    typeof (r as CreateRoomResponse).camIdentity === "string"
  );
}

// Mensagens trocadas pelo canal WebSocket leve do nosso backend.
// Este canal NAO transporta video: so metadados/controle (presenca, toggles).
// Video e audio vao por LiveKit WebRTC direto.
// O WS so conhece a identidade MAIN do host; cam-<nonce> e LiveKit-only.
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
