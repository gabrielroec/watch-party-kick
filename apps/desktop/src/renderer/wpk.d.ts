// Tipos da bridge window.wpk exposta pelo preload.
// Mantemos em um arquivo só pra todos os componentes do renderer usarem
// o mesmo shape (evita declarações divergentes no `declare global`).

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

declare global {
  interface Window {
    wpk?: WPKBridge;
  }
}
