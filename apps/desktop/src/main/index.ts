import { app, BrowserWindow, desktopCapturer, session } from "electron";
import { join } from "node:path";

app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const IS_DEV = !app.isPackaged;
const RENDERER_URL = "http://localhost:5173";
const RENDERER_FILE = join(__dirname, "../../renderer/index.html");

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
      sandbox: false,
      backgroundThrottling: false,
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

const registerDisplayMediaHandler = (): void => {
  // System picker for screen/window/tab selection. Bypasses Chrome's
  // 30fps cap on standard getDisplayMedia for window/screen surfaces.
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer.getSources({ types: ["window", "screen"] }).then((sources) => {
      callback({ video: sources[0], audio: "loopback" });
    });
  }, { useSystemPicker: true });
};

app.whenReady().then(() => {
  registerDisplayMediaHandler();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
