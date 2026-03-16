"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    updateTrayBadge(count) {
        return electron_1.ipcRenderer.invoke('update-tray-badge', count);
    },
    getSystemIdleMs() {
        return electron_1.ipcRenderer.invoke('get-system-idle-ms');
    },
    readFile(path) {
        return electron_1.ipcRenderer.invoke('read-file', path);
    },
    createVoicePopout() {
        return electron_1.ipcRenderer.invoke('create-voice-popout');
    },
    closeVoicePopout() {
        return electron_1.ipcRenderer.invoke('close-voice-popout');
    },
    checkForUpdates() {
        return electron_1.ipcRenderer.invoke('check-for-updates');
    },
    downloadAndInstall() {
        return electron_1.ipcRenderer.invoke('download-and-install');
    },
    getUpdateMethod() {
        return electron_1.ipcRenderer.invoke('get-update-method');
    },
    showNotification(title, body) {
        electron_1.ipcRenderer.send('show-notification', title, body);
    },
    onPopoutMessage(callback) {
        const handler = (_event, msg) => {
            callback(msg);
        };
        electron_1.ipcRenderer.on('popout-message', handler);
        return () => {
            electron_1.ipcRenderer.removeListener('popout-message', handler);
        };
    },
    sendPopoutMessage(msg) {
        electron_1.ipcRenderer.send('popout-message', msg);
    },
    getDesktopAudioStream() {
        return electron_1.ipcRenderer.invoke('get-desktop-audio-source-id');
    },
    startAudioCapture(sinkName) {
        return electron_1.ipcRenderer.invoke('start-audio-capture', sinkName);
    },
    stopAudioCapture() {
        return electron_1.ipcRenderer.invoke('stop-audio-capture');
    },
    onAudioCaptureData(callback) {
        const handler = (_event, data) => {
            callback(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
        };
        electron_1.ipcRenderer.on('audio-capture-data', handler);
        return () => electron_1.ipcRenderer.removeListener('audio-capture-data', handler);
    },
    onAudioCaptureEnded(callback) {
        const handler = () => callback();
        electron_1.ipcRenderer.on('audio-capture-ended', handler);
        return () => electron_1.ipcRenderer.removeListener('audio-capture-ended', handler);
    },
    listAudioApplications() {
        return electron_1.ipcRenderer.invoke('list-audio-applications');
    },
    startAudioShare(targetNodeIds, systemMode) {
        return electron_1.ipcRenderer.invoke('start-audio-share', targetNodeIds, systemMode);
    },
    stopAudioShare(moduleId) {
        return electron_1.ipcRenderer.invoke('stop-audio-share', moduleId);
    },
    isDesktop: true,
});
