import { contextBridge, ipcRenderer } from "electron";

export interface CaptureSource {
  id: string;
  name: string;
  thumbnail: string;
}

const bridge = {
  listSources: (): Promise<CaptureSource[]> => ipcRenderer.invoke("capture:list-sources"),
};

contextBridge.exposeInMainWorld("wpk", bridge);

export type WpkBridge = typeof bridge;
