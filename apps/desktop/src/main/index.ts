import { app, BrowserWindow, ipcMain, desktopCapturer, session } from "electron";
import { join } from "node:path";

const IS_DEV = !app.isPackaged;
const RENDERER_URL = "http://localhost:5173";
const RENDERER_FILE = join(__dirname, "../renderer/index.html");

const createWindow = (): BrowserWindow => {
  const win = new BrowserWindow({
    width: 1024,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#0e0f13",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (IS_DEV) {
    win.loadURL(RENDERER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(RENDERER_FILE);
  }

  return win;
};

const registerCaptureHandlers = (): void => {
  // System picker for screen/window selection. Uses Electron desktopCapturer
  // which bypasses Chrome's 30fps cap on getDisplayMedia.
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer.getSources({ types: ["window", "screen"] }).then((sources) => {
      callback({ video: sources[0], audio: "loopback" });
    });
  }, { useSystemPicker: true });

  ipcMain.handle("capture:list-sources", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["window", "screen"],
      thumbnailSize: { width: 320, height: 180 },
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
    }));
  });
};

app.whenReady().then(() => {
  registerCaptureHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
