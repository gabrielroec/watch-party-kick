import { contextBridge, ipcRenderer } from "electron";

export interface DisplaySource {
  id: string;
  name: string;
  display_id: string;
  thumbnail: string;
  appIcon: string | null;
}

export interface UpdateInfo {
  version: string;
  releaseNotes?: string | null;
  releaseDate?: string;
}

export interface UpdateProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface UpdaterAPI {
  onChecking: (cb: () => void) => () => void;
  onAvailable: (cb: (info: UpdateInfo) => void) => () => void;
  onNotAvailable: (cb: (info: UpdateInfo) => void) => () => void;
  onProgress: (cb: (p: UpdateProgress) => void) => () => void;
  onDownloaded: (cb: (info: UpdateInfo) => void) => () => void;
  onError: (cb: (err: { message: string }) => void) => () => void;
  check: () => Promise<unknown>;
  download: () => Promise<unknown>;
  install: () => Promise<unknown>;
}

export interface WPKBridge {
  picker: {
    onShow: (cb: (sources: DisplaySource[]) => void) => () => void;
    select: (sourceId: string | null) => void;
  };
  getVersion: () => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  updater: UpdaterAPI;
}

function listener<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
}

const bridge: WPKBridge = {
  picker: {
    onShow: (cb) => {
      const h = (_e: Electron.IpcRendererEvent, sources: DisplaySource[]) => cb(sources);
      ipcRenderer.on("display-picker:show", h);
      return () => ipcRenderer.off("display-picker:show", h);
    },
    select: (sourceId) => ipcRenderer.send("display-picker:select", sourceId),
  },
  getVersion: () => ipcRenderer.invoke("app:get-version"),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  updater: {
    onChecking: (cb) => listener<void>("updater:checking", () => cb()),
    onAvailable: (cb) => listener<UpdateInfo>("updater:available", cb),
    onNotAvailable: (cb) => listener<UpdateInfo>("updater:not-available", cb),
    onProgress: (cb) => listener<UpdateProgress>("updater:progress", cb),
    onDownloaded: (cb) => listener<UpdateInfo>("updater:downloaded", cb),
    onError: (cb) => listener<{ message: string }>("updater:error", cb),
    check: () => ipcRenderer.invoke("updater:check"),
    download: () => ipcRenderer.invoke("updater:download"),
    install: () => ipcRenderer.invoke("updater:install"),
  },
};

contextBridge.exposeInMainWorld("wpk", bridge);
