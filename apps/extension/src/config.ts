// Config do lado da extensao.
// Em producao, trocar BACKEND_URL pra URL publica do backend (HTTPS obrigatorio
// porque Chrome bloqueia fetch http em chrome-extension:// context).
export const BACKEND_URL = "https://watchpartykick.duckdns.org";

// Chave usada em chrome.storage.local pra lembrar a ultima sala usada.
export const STORAGE_LAST_ROOM = "wpk:lastRoom";
