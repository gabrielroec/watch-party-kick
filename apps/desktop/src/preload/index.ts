import { contextBridge, ipcRenderer } from "electron";

export interface DisplaySource {
  id: string;
  name: string;
  display_id: string;
  thumbnail: string;
  appIcon: string | null;
}

export interface WPKBridge {
  // Picker custom (Windows/Linux). No Mac não é chamado — sistema usa picker nativo.
  picker: {
    onShow: (cb: (sources: DisplaySource[]) => void) => () => void;
    select: (sourceId: string | null) => void;
  };
  // App info / utilidades
  getVersion: () => Promise<string>;
  openExternal: (url: string) => Promise<void>;
}

const bridge: WPKBridge = {
  picker: {
    onShow: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, sources: DisplaySource[]) => cb(sources);
      ipcRenderer.on("display-picker:show", listener);
      return () => ipcRenderer.off("display-picker:show", listener);
    },
    select: (sourceId) => {
      ipcRenderer.send("display-picker:select", sourceId);
    },
  },
  getVersion: () => ipcRenderer.invoke("app:get-version"),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
};

contextBridge.exposeInMainWorld("wpk", bridge);
