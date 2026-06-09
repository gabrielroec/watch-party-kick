// Gerenciamento em memoria das salas ativas.
// MVP: store in-memory. Producao depois migra pra Redis/Postgres para
// permitir cluster multi-no e persistencia de auditoria.

import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, type ParticipantRole } from "@wpk/shared";

export interface Room {
  code: string;
  createdAt: number;
  hostIdentity: string | null;  // preenchido quando o host se conecta
  camIdentity: string | null;   // pareada com hostIdentity; LiveKit-only, sem WS
  viewers: Set<string>;          // identidades conectadas ao WS
  hostState: {
    webcamOn: boolean;
    micOn: boolean;
    sourceLabel: string | null;  // nome amigavel da fonte (ex.: "Janela: VLC")
  };
}

const rooms = new Map<string, Room>();

// Gera codigo curto e legivel. Retenta se colidir (improvavel com 32^6).
export function createRoom(customCode?: string): Room {
  let code = "";
  if (customCode) {
    code = customCode.toUpperCase();
  } else {
    do {
      code = "";
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
      }
    } while (rooms.has(code));
  }

  const room: Room = {
    code,
    createdAt: Date.now(),
    hostIdentity: null,
    camIdentity: null,
    viewers: new Set(),
    hostState: { webcamOn: false, micOn: false, sourceLabel: null },
  };
  rooms.set(code, room);
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code.toUpperCase());
}

// Identidade unica por participante. Como nao temos login, geramos random.
// O identity e importante pro LiveKit nao permitir 2 conexoes da mesma identity.
export function makeIdentity(role: ParticipantRole): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${role}-${rand}`;
}

// Para o host com 2 PeerConnections (screen + cam em rooms LiveKit separadas
// mas mesmo roomCode), geramos par compartilhando o mesmo nonce. Ambas tem
// prefixo distinto pra LiveKit aceitar como participantes diferentes.
export function makeHostIdentities(): { mainIdentity: string; camIdentity: string } {
  const nonce = Math.random().toString(36).slice(2, 10);
  return {
    mainIdentity: `host-${nonce}`,
    camIdentity: `cam-${nonce}`,
  };
}

// Limpeza periodica de salas abandonadas (sem host e sem viewers).
// Evita vazamento de memoria em processos de longa duracao.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const empty = !room.hostIdentity && room.viewers.size === 0;
    const old = now - room.createdAt > 1000 * 60 * 60 * 12; // 12h
    if (empty && old) rooms.delete(code);
  }
}, 1000 * 60 * 10);
