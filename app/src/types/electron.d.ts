export interface AudioApp {
  nodeId: number;
  name: string;
  binary: string;
  streamName: string;
}

export interface ElectronAPI {
  updateTrayBadge(count: number): Promise<void>;
  getSystemIdleMs(): Promise<number>;
  createVoicePopout(): Promise<void>;
  closeVoicePopout(): Promise<void>;
  checkForUpdates(): Promise<{ version: string; notes: string } | null>;
  downloadAndInstall(): Promise<void>;
  getUpdateMethod(): Promise<{ autoUpdate: boolean; pkgType: string | null }>;
  showNotification(title: string, body: string): void;
  onPopoutMessage(callback: (msg: unknown) => void): () => void;
  sendPopoutMessage(msg: unknown): void;
  getDesktopAudioStream(): Promise<string | null>;
  startAudioCapture(sinkName: string): Promise<boolean>;
  stopAudioCapture(): Promise<void>;
  onAudioCaptureData(callback: (data: ArrayBuffer) => void): () => void;
  onAudioCaptureEnded(callback: () => void): () => void;
  listAudioApplications(): Promise<AudioApp[]>;
  startAudioShare(targetNodeIds: number[], systemMode: boolean): Promise<{ moduleId: number; sinkName: string }>;
  stopAudioShare(moduleId: number): Promise<void>;
  isDesktop: true;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
