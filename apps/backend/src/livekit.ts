// Geracao de JWT do LiveKit com permissoes minimas por papel.
// Host: pode publicar audio+video (screen-share + webcam + mic mixado).
// Viewer: so subscribe. Nunca pode publicar. Isso blinda viewers mal-
// intencionados de injetarem midia na sala.

import { AccessToken } from "livekit-server-sdk";
import { config } from "./config.js";
import type { ParticipantRole } from "@wpk/shared";

export async function issueLivekitToken(params: {
  roomCode: string;
  identity: string;
  role: ParticipantRole;
}): Promise<string> {
  const { roomCode, identity, role } = params;

  const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity,
    // TTL curto. O painel/extensao devem re-pedir token se a sala ficar aberta
    // por muitas horas. 6h cobre uma sessao de watch party tipica.
    ttl: 60 * 60 * 6,
  });

  at.addGrant({
    room: roomCode,
    roomJoin: true,
    canPublish: role === "host",
    canPublishData: role === "host",    // data channel so pra host (opcional)
    canSubscribe: true,
    // host cria a sala no LiveKit automaticamente ao entrar; viewers so entram
    // em sala existente. LiveKit trata isso pelo grant abaixo:
    canUpdateOwnMetadata: true,
  });

  return await at.toJwt();
}
