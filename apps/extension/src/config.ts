export const BACKEND_URL = "https://watchpartykick.duckdns.org";

export const STORAGE_LAST_ROOM = "wpk:lastRoom";
export const STORAGE_SESSION = "wpk:session";

// Kick channel da streamer. Quando tivermos +1 streamer, vira parte do
// JoinRoomResponse vindo do backend.
// Por que NÃO embedamos via iframe: chrome-extension:// é cross-site pra
// kick.com, e os cookies de sessão da Kick (SameSite=Lax) não vão pra
// third-party. Resultado: iframe aparece deslogado mesmo o usuário tendo
// kick.com aberta logada. A solução real é abrir o popout chat numa JANELA
// separada do Chrome (mesma sessão de cookies = já logado).
export const KICK_CHANNEL = "mandiocaa";
