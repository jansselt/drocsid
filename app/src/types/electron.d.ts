export interface ElectronAPI {
  updateTrayBadge(count: number): Promise<void>;
  getSystemIdleMs(): Promise<number>;
  readFile(path: string): Promise<ArrayBuffer>;
  createVoicePopout(): Promise<void>;
  closeVoicePopout(): Promise<void>;
  checkForUpdates(): Promise<{ version: string; notes: string } | null>;
  downloadAndInstall(): Promise<void>;
  getUpdateMethod(): Promise<{ autoUpdate: boolean; pkgType: string | null }>;
  showNotification(title: string, body: string): void;
  onPopoutMessage(callback: (msg: unknown) => void): () => void;
  sendPopoutMessage(msg: unknown): void;
  getDesktopAudioStream(): Promise<string | null>;
  isDesktop: true;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
