"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const electron_updater_1 = require("electron-updater");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const isDev = !!process.env.ELECTRON_DEV;
const DEV_URL = 'http://localhost:5174';
let mainWindow = null;
let voicePopout = null;
let tray = null;
let baseIcon = null;
let isQuitting = false;
// ── Single instance lock ────────────────────────────────────────────────
const gotLock = electron_1.app.requestSingleInstanceLock();
if (!gotLock) {
    electron_1.app.quit();
}
electron_1.app.on('second-instance', () => {
    if (mainWindow) {
        if (!mainWindow.isVisible())
            mainWindow.show();
        if (mainWindow.isMinimized())
            mainWindow.restore();
        mainWindow.focus();
    }
});
// ── Icon helpers ────────────────────────────────────────────────────────
function loadBaseIcon() {
    const iconPath = isDev
        ? path.join(__dirname, '..', 'icons', '128x128.png')
        : path.join(process.resourcesPath, 'icons', '128x128.png');
    return electron_1.nativeImage.createFromPath(iconPath);
}
function updateTrayBadge(count) {
    if (!tray || !baseIcon)
        return;
    if (count <= 0) {
        tray.setImage(baseIcon);
        return;
    }
    // Render a red badge with white count text onto the icon
    const size = baseIcon.getSize();
    const img = baseIcon.toBitmap();
    const w = size.width;
    const h = size.height;
    // Badge parameters: circle in top-right quadrant
    const badgeRadius = Math.round(w * 0.22);
    const cx = w - badgeRadius - 2;
    const cy = badgeRadius + 2;
    // Draw filled red circle
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const dx = x - cx;
            const dy = y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= badgeRadius) {
                const offset = (y * w + x) * 4; // BGRA format on most platforms, but nativeImage uses RGBA
                // Edge anti-aliasing
                const alpha = Math.min(1, Math.max(0, badgeRadius - dist + 0.5));
                if (alpha >= 0.5) {
                    img[offset] = 220; // R
                    img[offset + 1] = 38; // G
                    img[offset + 2] = 38; // B
                    img[offset + 3] = 255; // A
                }
            }
        }
    }
    // Draw simple digit(s) in white using a basic pixel font approach
    // We draw a small centered text representation
    const label = count > 99 ? '99+' : String(count);
    const charWidth = Math.max(3, Math.round(badgeRadius * 0.5));
    const charHeight = Math.max(5, Math.round(badgeRadius * 0.7));
    const totalWidth = label.length * (charWidth + 1) - 1;
    const startX = cx - Math.round(totalWidth / 2);
    const startY = cy - Math.round(charHeight / 2);
    // Simple pixel font for digits 0-9 and +
    const glyphs = {
        '0': [[1, 1, 1], [1, 0, 1], [1, 0, 1], [1, 0, 1], [1, 1, 1]],
        '1': [[0, 1, 0], [1, 1, 0], [0, 1, 0], [0, 1, 0], [1, 1, 1]],
        '2': [[1, 1, 1], [0, 0, 1], [1, 1, 1], [1, 0, 0], [1, 1, 1]],
        '3': [[1, 1, 1], [0, 0, 1], [1, 1, 1], [0, 0, 1], [1, 1, 1]],
        '4': [[1, 0, 1], [1, 0, 1], [1, 1, 1], [0, 0, 1], [0, 0, 1]],
        '5': [[1, 1, 1], [1, 0, 0], [1, 1, 1], [0, 0, 1], [1, 1, 1]],
        '6': [[1, 1, 1], [1, 0, 0], [1, 1, 1], [1, 0, 1], [1, 1, 1]],
        '7': [[1, 1, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]],
        '8': [[1, 1, 1], [1, 0, 1], [1, 1, 1], [1, 0, 1], [1, 1, 1]],
        '9': [[1, 1, 1], [1, 0, 1], [1, 1, 1], [0, 0, 1], [1, 1, 1]],
        '+': [[0, 0, 0], [0, 1, 0], [1, 1, 1], [0, 1, 0], [0, 0, 0]],
    };
    // Scale factor for glyph pixels
    const scaleX = Math.max(1, Math.round(charWidth / 3));
    const scaleY = Math.max(1, Math.round(charHeight / 5));
    let offsetX = startX;
    for (const ch of label) {
        const glyph = glyphs[ch];
        if (!glyph)
            continue;
        for (let gy = 0; gy < glyph.length; gy++) {
            for (let gx = 0; gx < glyph[gy].length; gx++) {
                if (!glyph[gy][gx])
                    continue;
                // Draw scaled pixel
                for (let sy = 0; sy < scaleY; sy++) {
                    for (let sx = 0; sx < scaleX; sx++) {
                        const px = offsetX + gx * scaleX + sx;
                        const py = startY + gy * scaleY + sy;
                        if (px >= 0 && px < w && py >= 0 && py < h) {
                            const off = (py * w + px) * 4;
                            img[off] = 255; // R
                            img[off + 1] = 255; // G
                            img[off + 2] = 255; // B
                            img[off + 3] = 255; // A
                        }
                    }
                }
            }
        }
        offsetX += (3 * scaleX) + 1;
    }
    const badged = electron_1.nativeImage.createFromBuffer(Buffer.from(img), {
        width: w,
        height: h,
    });
    tray.setImage(badged);
}
// ── Tray ────────────────────────────────────────────────────────────────
function createTray() {
    baseIcon = loadBaseIcon();
    // Use a 16x16 or 22x22 resized version for the tray
    const trayIcon = baseIcon.resize({ width: 22, height: 22 });
    tray = new electron_1.Tray(trayIcon);
    // Re-assign baseIcon to tray-sized version for badge rendering
    baseIcon = trayIcon;
    const contextMenu = electron_1.Menu.buildFromTemplate([
        {
            label: 'Show Drocsid',
            click: () => {
                mainWindow?.show();
                mainWindow?.focus();
            },
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                isQuitting = true;
                electron_1.app.quit();
            },
        },
    ]);
    tray.setToolTip('Drocsid');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.focus();
            }
            else {
                mainWindow.show();
                mainWindow.focus();
            }
        }
    });
}
// ── Main window ─────────────────────────────────────────────────────────
function createMainWindow() {
    const preloadPath = path.join(__dirname, 'preload.js');
    mainWindow = new electron_1.BrowserWindow({
        width: 1280,
        height: 800,
        icon: loadBaseIcon(),
        webPreferences: {
            preload: preloadPath,
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
        },
    });
    if (isDev) {
        mainWindow.loadURL(DEV_URL);
    }
    else {
        mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    }
    // Minimize to tray on close instead of quitting
    mainWindow.on('close', (e) => {
        if (!isQuitting) {
            e.preventDefault();
            mainWindow?.hide();
        }
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
// ── Voice popout ────────────────────────────────────────────────────────
function createVoicePopout() {
    if (voicePopout && !voicePopout.isDestroyed()) {
        voicePopout.focus();
        return;
    }
    const preloadPath = path.join(__dirname, 'preload.js');
    voicePopout = new electron_1.BrowserWindow({
        width: 640,
        height: 480,
        resizable: true,
        alwaysOnTop: true,
        icon: loadBaseIcon(),
        webPreferences: {
            preload: preloadPath,
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
        },
    });
    const popoutUrl = isDev
        ? `${DEV_URL}?popout=voice`
        : `file://${path.join(__dirname, '..', 'dist', 'index.html')}?popout=voice`;
    voicePopout.loadURL(popoutUrl);
    voicePopout.on('closed', () => {
        voicePopout = null;
    });
}
function closeVoicePopout() {
    if (voicePopout && !voicePopout.isDestroyed()) {
        voicePopout.close();
        voicePopout = null;
    }
}
// ── Auto-updater ────────────────────────────────────────────────────────
electron_updater_1.autoUpdater.autoDownload = false;
electron_updater_1.autoUpdater.autoInstallOnAppQuit = true;
let pendingUpdate = null;
electron_updater_1.autoUpdater.on('update-available', (info) => {
    pendingUpdate = {
        version: info.version,
        notes: typeof info.releaseNotes === 'string'
            ? info.releaseNotes
            : Array.isArray(info.releaseNotes)
                ? info.releaseNotes.map((n) => (typeof n === 'string' ? n : n.note)).join('\n')
                : '',
    };
});
electron_updater_1.autoUpdater.on('update-not-available', () => {
    pendingUpdate = null;
});
// ── IPC handlers ────────────────────────────────────────────────────────
function registerIpcHandlers() {
    electron_1.ipcMain.handle('update-tray-badge', (_event, count) => {
        updateTrayBadge(count);
    });
    electron_1.ipcMain.handle('get-system-idle-ms', () => {
        return electron_1.powerMonitor.getSystemIdleTime() * 1000;
    });
    electron_1.ipcMain.handle('read-file', (_event, filePath) => {
        const buf = fs.readFileSync(filePath);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    });
    electron_1.ipcMain.handle('create-voice-popout', () => {
        createVoicePopout();
    });
    electron_1.ipcMain.handle('close-voice-popout', () => {
        closeVoicePopout();
    });
    electron_1.ipcMain.handle('check-for-updates', async () => {
        pendingUpdate = null;
        try {
            await electron_updater_1.autoUpdater.checkForUpdates();
        }
        catch {
            // Network error or no update server configured
        }
        return pendingUpdate;
    });
    electron_1.ipcMain.handle('download-and-install', async () => {
        await electron_updater_1.autoUpdater.downloadUpdate();
        electron_updater_1.autoUpdater.quitAndInstall(false, true);
    });
    electron_1.ipcMain.handle('get-update-method', () => {
        const platform = process.platform;
        if (platform === 'win32' || platform === 'darwin') {
            return { autoUpdate: true, pkgType: null };
        }
        // Linux: detect package type from /etc/os-release
        if (platform === 'linux') {
            try {
                const osRelease = fs.readFileSync('/etc/os-release', 'utf-8');
                const idLine = osRelease.split('\n').find((l) => l.startsWith('ID='));
                const id = idLine?.split('=')[1]?.replace(/"/g, '').trim().toLowerCase() ?? '';
                const idLikeLine = osRelease.split('\n').find((l) => l.startsWith('ID_LIKE='));
                const idLike = idLikeLine?.split('=')[1]?.replace(/"/g, '').trim().toLowerCase() ?? '';
                const combined = `${id} ${idLike}`;
                if (combined.includes('debian') || combined.includes('ubuntu')) {
                    return { autoUpdate: false, pkgType: 'deb' };
                }
                if (combined.includes('fedora') || combined.includes('rhel') || combined.includes('centos') || combined.includes('suse')) {
                    return { autoUpdate: false, pkgType: 'rpm' };
                }
                if (combined.includes('arch') || combined.includes('manjaro') || combined.includes('endeavour')) {
                    return { autoUpdate: false, pkgType: 'pacman' };
                }
            }
            catch {
                // Cannot read os-release
            }
            // Check if running as AppImage
            if (process.env.APPIMAGE) {
                return { autoUpdate: true, pkgType: 'appimage' };
            }
            return { autoUpdate: false, pkgType: null };
        }
        return { autoUpdate: false, pkgType: null };
    });
    electron_1.ipcMain.on('show-notification', (_event, title, body) => {
        new electron_1.Notification({ title, body, icon: loadBaseIcon() }).show();
    });
    // Popout <-> main window messaging
    electron_1.ipcMain.on('popout-message', (_event, msg) => {
        // Forward to all other windows
        const allWindows = [mainWindow, voicePopout].filter((w) => w && !w.isDestroyed() && w.webContents.id !== _event.sender.id);
        for (const win of allWindows) {
            win?.webContents.send('popout-message', msg);
        }
    });
}
// ── App lifecycle ───────────────────────────────────────────────────────
electron_1.app.whenReady().then(() => {
    registerIpcHandlers();
    createTray();
    createMainWindow();
});
electron_1.app.on('before-quit', () => {
    isQuitting = true;
});
electron_1.app.on('window-all-closed', () => {
    // On macOS, apps typically stay open until explicitly quit
    if (process.platform !== 'darwin') {
        // Don't quit — we have a tray icon. The user quits via tray menu.
    }
});
electron_1.app.on('activate', () => {
    // macOS dock click
    if (!mainWindow) {
        createMainWindow();
    }
    else {
        mainWindow.show();
    }
});
