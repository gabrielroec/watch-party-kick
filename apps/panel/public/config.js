// URLs de download. /latest/download/<name> sempre aponta pra release mais recente,
// então não precisa mudar quando publicar v0.2.0, v0.3.0, etc.
window.WPK_CONFIG = {
  downloads: {
    macAppleSilicon: "https://github.com/gabrielroec/watch-party-kick/releases/latest/download/Watch-Party-darwin-arm64.dmg",
    macIntel: "https://github.com/gabrielroec/watch-party-kick/releases/latest/download/Watch-Party-darwin-x64.dmg",
    win: "https://github.com/gabrielroec/watch-party-kick/releases/latest/download/Watch-Party-win32-x64.exe",
  },
  extensionZipUrl: "/watch-party-extension.zip",
  backendUrl: "https://watchpartykick.duckdns.org",
};
