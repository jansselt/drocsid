import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  session,
  Tray,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  NativeImage,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import {
  listAudioApplications,
  createNullSink,
  destroyNullSink,
  findNodeByName,
  linkAppToNullSink,
  getPwDump,
} from './pipewire';

const isDev = !!process.env.ELECTRON_DEV;
const DEV_URL = 'http://localhost:5174';

// In production, we serve the app via a local HTTP server on a fixed port.
// This gives the page a proper http:// origin so YouTube embeds (and other
// third-party iframes) work correctly — they reject file:// and custom
// protocol origins.  A fixed port ensures the origin stays the same across
// restarts so localStorage (settings, tokens, etc.) persists.
const PROD_PORT = 47847;
let prodServerUrl = '';

// Suppress EPIPE errors on stdout/stderr — when running as an AppImage
// there's no terminal, so console.log (e.g. from electron-updater) causes
// a broken pipe crash.
process.stdout?.on?.('error', () => {});
process.stderr?.on?.('error', () => {});

let mainWindow: BrowserWindow | null = null;
let voicePopout: BrowserWindow | null = null;
let tray: Tray | null = null;
let baseIcon: NativeImage | null = null;
let isQuitting = false;

// ── Single instance lock ────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (!mainWindow.isVisible()) mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ── Icon helpers ────────────────────────────────────────────────────────

function loadBaseIcon(): NativeImage {
  const iconPath = isDev
    ? path.join(__dirname, '..', 'icons', '128x128.png')
    : path.join(process.resourcesPath, 'icons', '128x128.png');
  return nativeImage.createFromPath(iconPath);
}

function updateTrayBadge(count: number): void {
  if (!tray || !baseIcon) return;

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
          img[offset] = 220;     // R
          img[offset + 1] = 38;  // G
          img[offset + 2] = 38;  // B
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
  const glyphs: Record<string, number[][]> = {
    '0': [[1,1,1],[1,0,1],[1,0,1],[1,0,1],[1,1,1]],
    '1': [[0,1,0],[1,1,0],[0,1,0],[0,1,0],[1,1,1]],
    '2': [[1,1,1],[0,0,1],[1,1,1],[1,0,0],[1,1,1]],
    '3': [[1,1,1],[0,0,1],[1,1,1],[0,0,1],[1,1,1]],
    '4': [[1,0,1],[1,0,1],[1,1,1],[0,0,1],[0,0,1]],
    '5': [[1,1,1],[1,0,0],[1,1,1],[0,0,1],[1,1,1]],
    '6': [[1,1,1],[1,0,0],[1,1,1],[1,0,1],[1,1,1]],
    '7': [[1,1,1],[0,0,1],[0,0,1],[0,0,1],[0,0,1]],
    '8': [[1,1,1],[1,0,1],[1,1,1],[1,0,1],[1,1,1]],
    '9': [[1,1,1],[1,0,1],[1,1,1],[0,0,1],[1,1,1]],
    '+': [[0,0,0],[0,1,0],[1,1,1],[0,1,0],[0,0,0]],
  };

  // Scale factor for glyph pixels
  const scaleX = Math.max(1, Math.round(charWidth / 3));
  const scaleY = Math.max(1, Math.round(charHeight / 5));

  let offsetX = startX;
  for (const ch of label) {
    const glyph = glyphs[ch];
    if (!glyph) continue;
    for (let gy = 0; gy < glyph.length; gy++) {
      for (let gx = 0; gx < glyph[gy].length; gx++) {
        if (!glyph[gy][gx]) continue;
        // Draw scaled pixel
        for (let sy = 0; sy < scaleY; sy++) {
          for (let sx = 0; sx < scaleX; sx++) {
            const px = offsetX + gx * scaleX + sx;
            const py = startY + gy * scaleY + sy;
            if (px >= 0 && px < w && py >= 0 && py < h) {
              const off = (py * w + px) * 4;
              img[off] = 255;     // R
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

  const badged = nativeImage.createFromBuffer(Buffer.from(img), {
    width: w,
    height: h,
  });
  tray.setImage(badged);
}

// ── Tray ────────────────────────────────────────────────────────────────

function createTray(): void {
  baseIcon = loadBaseIcon();
  // Use a 16x16 or 22x22 resized version for the tray
  const trayIcon = baseIcon.resize({ width: 22, height: 22 });
  tray = new Tray(trayIcon);
  // Re-assign baseIcon to tray-sized version for badge rendering
  baseIcon = trayIcon;

  const contextMenu = Menu.buildFromTemplate([
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
        app.quit();
      },
    },
  ]);

  tray.setToolTip('Drocsid');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// ── Main window ─────────────────────────────────────────────────────────

function createMainWindow(): void {
  const preloadPath = path.join(__dirname, 'preload.js');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: loadBaseIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  // Auto-grant microphone and camera permissions
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      const allowed = ['media', 'mediaKeySystem', 'display-capture', 'notifications'];
      callback(allowed.includes(permission));
    }
  );

  // Handle screen share via Electron's desktopCapturer.
  // getDisplayMedia() doesn't work in Electron on Linux — we provide sources manually.
  mainWindow.webContents.session.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
      });
      // Auto-select the first screen (primary display)
      if (sources.length > 0) {
        callback({ video: sources[0] });
      } else {
        callback({});
      }
    }
  );

  // YouTube blocks Electron's default user-agent. Strip Electron/app tokens
  // so requests look like regular Chrome.
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.youtube.com/*', '*://*.googlevideo.com/*'] },
    (details, callback) => {
      details.requestHeaders['User-Agent'] = details.requestHeaders['User-Agent']
        .replace(/Electron\/[\d.]+ /, '')
        .replace(/drocsid\/[\d.]+ /, '');
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  // Inject Content-Security-Policy headers into all responses
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https: http:",
            "media-src 'self' blob: https: http:",
            "connect-src 'self' https: wss: http: ws:",
            "frame-src https://www.youtube.com https://open.spotify.com https://embed.bsky.app https://www.tiktok.com https://www.instagram.com https://www.threads.net",
            "font-src 'self' https://cdn.jsdelivr.net",
          ].join('; '),
        ],
      },
    });
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadURL(prodServerUrl);
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

function createVoicePopout(): void {
  if (voicePopout && !voicePopout.isDestroyed()) {
    voicePopout.focus();
    return;
  }

  const preloadPath = path.join(__dirname, 'preload.js');

  voicePopout = new BrowserWindow({
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
    : `${prodServerUrl}?popout=voice`;

  voicePopout.loadURL(popoutUrl);

  voicePopout.on('closed', () => {
    voicePopout = null;
  });
}

function closeVoicePopout(): void {
  if (voicePopout && !voicePopout.isDestroyed()) {
    voicePopout.close();
    voicePopout = null;
  }
}

// ── Auto-updater ────────────────────────────────────────────────────────

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

let pendingUpdate: { version: string; notes: string } | null = null;

autoUpdater.on('update-available', (info) => {
  pendingUpdate = {
    version: info.version,
    notes: typeof info.releaseNotes === 'string'
      ? info.releaseNotes
      : Array.isArray(info.releaseNotes)
        ? info.releaseNotes.map((n) => (typeof n === 'string' ? n : n.note)).join('\n')
        : '',
  };
});

autoUpdater.on('update-not-available', () => {
  pendingUpdate = null;
});

// ── IPC handlers ────────────────────────────────────────────────────────

function registerIpcHandlers(): void {
  ipcMain.handle('update-tray-badge', (_event, count: number) => {
    updateTrayBadge(count);
  });

  ipcMain.handle('get-system-idle-ms', () => {
    return powerMonitor.getSystemIdleTime() * 1000;
  });

  // Return a desktop capturer source ID for system audio capture.
  ipcMain.handle('get-desktop-audio-source-id', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 },
    });
    return sources.length > 0 ? sources[0].id : null;
  });

  // Capture audio from a PipeWire null-sink monitor using parec.
  // Streams Float32 PCM at 48kHz stereo to the renderer via IPC.
  let parecProcess: import('child_process').ChildProcess | null = null;

  ipcMain.handle('start-audio-capture', (_event, sinkName: string) => {
    if (parecProcess) {
      parecProcess.kill();
      parecProcess = null;
    }

    const { spawn } = require('child_process') as typeof import('child_process');
    // parec records from a PulseAudio/PipeWire monitor source
    // --monitor-stream isn't reliable, use the sink monitor directly
    const monitorSource = `${sinkName}.monitor`;
    parecProcess = spawn('parec', [
      '--device', monitorSource,
      '--format=float32le',
      '--rate=48000',
      '--channels=2',
      '--raw',
    ]);

    parecProcess.stdout?.on('data', (chunk: Buffer) => {
      // Send raw PCM to renderer
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('audio-capture-data', chunk);
      }
    });

    parecProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[parec]', data.toString());
    });

    parecProcess.on('close', (code) => {
      console.log(`[parec] exited with code ${code}`);
      parecProcess = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('audio-capture-ended');
      }
    });

    return true;
  });

  ipcMain.handle('stop-audio-capture', () => {
    if (parecProcess) {
      parecProcess.kill();
      parecProcess = null;
    }
  });

  ipcMain.handle('create-voice-popout', () => {
    createVoicePopout();
  });

  ipcMain.handle('close-voice-popout', () => {
    closeVoicePopout();
  });

  ipcMain.handle('check-for-updates', async () => {
    pendingUpdate = null;
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      // Network error or no update server configured
    }
    return pendingUpdate;
  });

  ipcMain.handle('download-and-install', async () => {
    await autoUpdater.downloadUpdate();
    autoUpdater.quitAndInstall(false, true);
  });

  ipcMain.handle('get-update-method', () => {
    const platform = process.platform;

    if (platform === 'win32' || platform === 'darwin') {
      return { autoUpdate: true, pkgType: null };
    }

    // Linux: check AppImage FIRST (env var set by AppImage runtime),
    // then fall back to distro detection for deb/rpm/pacman.
    if (platform === 'linux') {
      if (process.env.APPIMAGE) {
        return { autoUpdate: true, pkgType: 'appimage' };
      }

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
      } catch {
        // Cannot read os-release
      }

      return { autoUpdate: false, pkgType: null };
    }

    return { autoUpdate: false, pkgType: null };
  });

  ipcMain.on('show-notification', (_event, title: string, body: string) => {
    new Notification({ title, body, icon: loadBaseIcon() }).show();
  });

  // Popout <-> main window messaging
  ipcMain.on('popout-message', (_event, msg: unknown) => {
    // Forward to all other windows
    const allWindows = [mainWindow, voicePopout].filter(
      (w) => w && !w.isDestroyed() && w.webContents.id !== _event.sender.id,
    );
    for (const win of allWindows) {
      win?.webContents.send('popout-message', msg);
    }
  });

  // ── PipeWire audio sharing (Linux only) ──────────────────────────────
  ipcMain.handle('list-audio-applications', () => {
    return listAudioApplications();
  });

  ipcMain.handle('start-audio-share', async (_event, targetNodeIds: number[], _systemMode: boolean) => {
    const sinkName = `drocsid_share_${Date.now()}`;

    // 1. Create null-sink
    const moduleId = createNullSink(sinkName);

    // 2. Wait for PipeWire to register it
    await new Promise((r) => setTimeout(r, 300));

    // 3. Run pw-dump to find the null-sink node and link apps
    const objects = getPwDump();
    const sinkNodeId = findNodeByName(objects, sinkName);

    if (sinkNodeId === null) {
      destroyNullSink(moduleId);
      throw new Error('Failed to find null-sink node after creation');
    }

    // 4. Link target apps to null-sink
    for (const targetNodeId of targetNodeIds) {
      linkAppToNullSink(objects, targetNodeId, sinkNodeId);
    }

    // 5. Return info for cleanup and monitor device discovery
    return { moduleId, sinkName };
  });

  ipcMain.handle('stop-audio-share', (_event, moduleId: number) => {
    destroyNullSink(moduleId);
  });
}

// ── App lifecycle ───────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // In production, start a local HTTP server to serve the built app.
  // This gives the renderer a real http:// origin so third-party embeds
  // (YouTube, Twitter, etc.) work — they reject file:// and custom schemes.
  if (!isDev) {
    const distPath = path.join(__dirname, '..', 'dist');
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.webp': 'image/webp',
      '.webm': 'video/webm',
      '.mp4': 'video/mp4',
      '.wav': 'audio/wav',
      '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg',
    };

    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      let filePath = path.join(distPath, urlPath);

      // SPA fallback: serve index.html for routes without file extensions
      if (!path.extname(filePath)) {
        filePath = path.join(distPath, 'index.html');
      }

      try {
        const data = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] ?? 'application/octet-stream' });
        res.end(data);
      } catch {
        // Fallback to index.html for SPA routing
        try {
          const index = fs.readFileSync(path.join(distPath, 'index.html'));
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(index);
        } catch {
          res.writeHead(404);
          res.end('Not found');
        }
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(PROD_PORT, '127.0.0.1', () => {
        prodServerUrl = `http://127.0.0.1:${PROD_PORT}/index.html`;
        resolve();
      });
    });
  }

  registerIpcHandlers();
  createTray();
  createMainWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  // On macOS, apps typically stay open until explicitly quit
  if (process.platform !== 'darwin') {
    // Don't quit — we have a tray icon. The user quits via tray menu.
  }
});

app.on('activate', () => {
  // macOS dock click
  if (!mainWindow) {
    createMainWindow();
  } else {
    mainWindow.show();
  }
});
