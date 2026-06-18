import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  session,
  shell,
} from "electron";
import { join } from "node:path";

app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const IS_DEV = !app.isPackaged;
const RENDERER_URL = "http://localhost:5173";
const RENDERER_FILE = join(__dirname, "../../renderer/index.html");

const IS_MAC = process.platform === "darwin";

const createWindow = (): BrowserWindow => {
  const win = new BrowserWindow({
    width: 1024,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#0e0f13",
    titleBarStyle: IS_MAC ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      autoplayPolicy: "no-user-gesture-required",
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

// Picker handler. Mac usa o ScreenCaptureKit nativo (useSystemPicker:true).
// Windows/Linux a gente envia as sources pro renderer e ele mostra um modal
// custom com thumbnails — sem isso o app pegava sempre sources[0] (tela inteira).
const registerDisplayMediaHandler = (): void => {
  session.defaultSession.setDisplayMediaRequestHandler(
    (_req, callback) => {
      if (IS_MAC) {
        // Mac: deixa o sistema mostrar o picker do ScreenCaptureKit
        desktopCapturer
          .getSources({ types: ["window", "screen"] })
          .then((sources) => {
            callback({ video: sources[0], audio: "loopback" });
          });
        return;
      }

      // Windows/Linux: pega sources + thumbnails e pede pro renderer escolher
      const targetWin =
        BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      if (!targetWin) {
        callback({});
        return;
      }

      desktopCapturer
        .getSources({
          types: ["window", "screen"],
          thumbnailSize: { width: 320, height: 180 },
          fetchWindowIcons: true,
        })
        .then((sources) => {
          const serialized = sources.map((s) => ({
            id: s.id,
            name: s.name,
            display_id: s.display_id,
            thumbnail: s.thumbnail.toDataURL(),
            appIcon: s.appIcon?.isEmpty() === false ? s.appIcon.toDataURL() : null,
          }));

          targetWin.webContents.send("display-picker:show", serialized);

          ipcMain.once(
            "display-picker:select",
            (_e, sourceId: string | null) => {
              const picked = sourceId
                ? sources.find((s) => s.id === sourceId)
                : null;
              if (picked) {
                callback({ video: picked, audio: "loopback" });
              } else {
                callback({});
              }
            },
          );
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: IS_MAC },
  );
};

// IPC: versão atual do app (renderer mostra no canto)
const registerVersionHandler = (): void => {
  ipcMain.handle("app:get-version", () => app.getVersion());
};

// Abre URL externa no browser padrão (pra link de update)
const registerOpenExternalHandler = (): void => {
  ipcMain.handle("app:open-external", async (_e, url: string) => {
    if (typeof url !== "string") return;
    if (!url.startsWith("https://") && !url.startsWith("http://")) return;
    await shell.openExternal(url);
  });
};

app.whenReady().then(() => {
  registerDisplayMediaHandler();
  registerVersionHandler();
  registerOpenExternalHandler();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
