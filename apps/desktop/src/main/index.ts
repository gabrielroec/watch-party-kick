import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  session,
  shell,
} from "electron";
import { autoUpdater } from "electron-updater";
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

// Abre URL externa no browser padrão (link genérico, ex: GitHub Release)
const registerOpenExternalHandler = (): void => {
  ipcMain.handle("app:open-external", async (_e, url: string) => {
    if (typeof url !== "string") return;
    if (!url.startsWith("https://") && !url.startsWith("http://")) return;
    await shell.openExternal(url);
  });
};

// Auto-updater via electron-updater. Pega o último release do GitHub,
// baixa zip (Mac) ou exe (Win) automaticamente, e quando o user confirma
// reinicia o app já com a versão nova instalada.
const setupAutoUpdater = (mainWindow: BrowserWindow): void => {
  if (IS_DEV) {
    console.log("[updater] dev mode — pulando autoUpdater");
    return;
  }

  // Não baixa sozinho; espera o user clicar no badge "Baixar".
  // (mas a verificação por updates é automática)
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  const send = (channel: string, payload?: unknown): void => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(channel, payload);
  };

  autoUpdater.on("checking-for-update", () => send("updater:checking"));
  autoUpdater.on("update-available", (info) => send("updater:available", {
    version: info.version,
    releaseNotes: info.releaseNotes,
    releaseDate: info.releaseDate,
  }));
  autoUpdater.on("update-not-available", (info) => send("updater:not-available", {
    version: info.version,
  }));
  autoUpdater.on("download-progress", (p) => send("updater:progress", {
    percent: p.percent,
    bytesPerSecond: p.bytesPerSecond,
    transferred: p.transferred,
    total: p.total,
  }));
  autoUpdater.on("update-downloaded", (info) => send("updater:downloaded", {
    version: info.version,
  }));
  autoUpdater.on("error", (err) => send("updater:error", { message: err.message }));

  // IPC do renderer pra controlar o ciclo
  ipcMain.handle("updater:check", () => autoUpdater.checkForUpdates());
  ipcMain.handle("updater:download", () => autoUpdater.downloadUpdate());
  ipcMain.handle("updater:install", () => autoUpdater.quitAndInstall(false, true));

  // Check inicial 5s após abrir e depois a cada 30min
  setTimeout(() => { void autoUpdater.checkForUpdates().catch(() => {}); }, 5_000);
  setInterval(() => { void autoUpdater.checkForUpdates().catch(() => {}); }, 30 * 60 * 1000);
};

app.whenReady().then(() => {
  registerDisplayMediaHandler();
  registerVersionHandler();
  registerOpenExternalHandler();
  const mainWin = createWindow();
  setupAutoUpdater(mainWin);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
