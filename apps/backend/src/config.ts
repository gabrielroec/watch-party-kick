// Carrega e valida env do backend.
// Falhar cedo se faltar chave critica e melhor que descobrir em runtime
// na hora que o streamer tenta criar sala.

import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
  LIVEKIT_URL: z.string().url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  STORAGE_PATH: z.string().default("./data"),
  STREAMER_MANDIOCA_KEY: z.string().min(8).default("mandioca-mvp-key-change-me"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("[config] env invalido:", parsed.error.flatten().fieldErrors);
  console.error("[config] copie apps/backend/.env.example pra .env e preencha as chaves do LiveKit.");
  process.exit(1);
}

export const config = {
  port: parsed.data.PORT,
  allowedOrigins: parsed.data.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
  livekit: {
    url: parsed.data.LIVEKIT_URL,
    apiKey: parsed.data.LIVEKIT_API_KEY,
    apiSecret: parsed.data.LIVEKIT_API_SECRET,
  },
  storagePath: parsed.data.STORAGE_PATH,
  streamerKeys: {
    mandioca: parsed.data.STREAMER_MANDIOCA_KEY,
  } as Record<string, string>,
};
