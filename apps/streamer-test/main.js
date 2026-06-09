let app, BrowserWindow, desktopCapturer, ipcMain, session;
try {
  ({ app, BrowserWindow, desktopCapturer, ipcMain, session } = require("electron"));
} catch {
  console.error("Electron not loaded properly");
  process.exit(1);
}
const path = require("path");

let mainWindow;

try {
  app.commandLine.appendSwitch("enable-features", "WebRTCPipeWireCapturer,PlatformHEVCEncoderSupport");
  app.commandLine.appendSwitch("disable-features", "SpareRendererForSitePerProcess");
  app.commandLine.appendSwitch("enable-accelerated-video-encode");
  app.commandLine.appendSwitch("enable-gpu-rasterization");
  app.commandLine.appendSwitch("ignore-gpu-blocklist");
} catch {}

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile("renderer.html");

  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer.getSources({ types: ["screen", "window"] }).then((sources) => {
        callback({ video: sources[0], audio: "loopback" });
      });
    },
    { useSystemPicker: true }
  );
});

ipcMain.handle("get-sources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL(),
  }));
});

app.on("window-all-closed", () => app.quit());
