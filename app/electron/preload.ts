import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  updateTrayBadge(count: number): Promise<void> {
    return ipcRenderer.invoke('update-tray-badge', count);
  },

  getSystemIdleMs(): Promise<number> {
    return ipcRenderer.invoke('get-system-idle-ms');
  },

  readFile(path: string): Promise<ArrayBuffer> {
    return ipcRenderer.invoke('read-file', path);
  },

  createVoicePopout(): Promise<void> {
    return ipcRenderer.invoke('create-voice-popout');
  },

  closeVoicePopout(): Promise<void> {
    return ipcRenderer.invoke('close-voice-popout');
  },

  checkForUpdates(): Promise<{ version: string; notes: string } | null> {
    return ipcRenderer.invoke('check-for-updates');
  },

  downloadAndInstall(): Promise<void> {
    return ipcRenderer.invoke('download-and-install');
  },

  getUpdateMethod(): Promise<{ autoUpdate: boolean; pkgType: string | null }> {
    return ipcRenderer.invoke('get-update-method');
  },

  showNotification(title: string, body: string): void {
    ipcRenderer.send('show-notification', title, body);
  },

  onPopoutMessage(callback: (msg: unknown) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, msg: unknown) => {
      callback(msg);
    };
    ipcRenderer.on('popout-message', handler);
    return () => {
      ipcRenderer.removeListener('popout-message', handler);
    };
  },

  sendPopoutMessage(msg: unknown): void {
    ipcRenderer.send('popout-message', msg);
  },

  getDesktopAudioStream(): Promise<string | null> {
    return ipcRenderer.invoke('get-desktop-audio-source-id');
  },

  isDesktop: true as const,
});
