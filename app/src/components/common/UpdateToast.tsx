import { useState, useEffect, useCallback } from 'react';
import { usePwaUpdate } from '../../hooks/usePwaUpdate';
import './UpdateToast.css';

const isTauri = '__TAURI_INTERNALS__' in globalThis;

// How often to check for desktop updates (30 minutes)
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
// Delay before first check to avoid blocking startup
const INITIAL_DELAY_MS = 10_000;

const RELEASES_URL = 'https://github.com/jansselt/drocsid/releases/latest';

interface UpdateInfo {
  version?: string;
  source: 'pwa' | 'tauri' | 'tauri-manual';
}

export function UpdateToast() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [updating, setUpdating] = useState(false);

  // PWA update detection (web only)
  const { needRefresh, applyUpdate } = usePwaUpdate();

  useEffect(() => {
    if (needRefresh && !isTauri) {
      setUpdate({ source: 'pwa' });
      setDismissed(false);
    }
  }, [needRefresh]);

  // Tauri updater detection (desktop only)
  const checkTauriUpdate = useCallback(async () => {
    if (!isTauri) return;
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await check();
      if (result) {
        const autoUpdateSupported = await invoke<boolean>('can_auto_update');
        setUpdate({
          version: result.version,
          source: autoUpdateSupported ? 'tauri' : 'tauri-manual',
        });
        setDismissed(false);
      }
    } catch {
      // Update check failed — network error, no release, etc.
    }
  }, []);

  useEffect(() => {
    if (!isTauri) return;

    const initialTimeout = setTimeout(checkTauriUpdate, INITIAL_DELAY_MS);
    const interval = setInterval(checkTauriUpdate, CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [checkTauriUpdate]);

  const handleUpdate = async () => {
    setUpdating(true);
    try {
      if (update?.source === 'pwa') {
        await applyUpdate();
      } else if (update?.source === 'tauri') {
        const { check } = await import('@tauri-apps/plugin-updater');
        const { relaunch } = await import('@tauri-apps/plugin-process');
        const result = await check();
        if (result) {
          await result.downloadAndInstall();
          await relaunch();
        }
      } else if (update?.source === 'tauri-manual') {
        window.open(RELEASES_URL, '_blank');
      }
    } catch {
      setUpdating(false);
    }
  };

  if (!update || dismissed) return null;

  const isManual = update.source === 'tauri-manual';

  return (
    <div className="update-toast">
      <div className="update-toast-message">
        A new version of Drocsid is available
      </div>
      {update.version && (
        <div className="update-toast-version">Version {update.version}</div>
      )}
      {updating && !isManual && (
        <div className="update-toast-progress">Downloading update...</div>
      )}
      <div className="update-toast-actions">
        <button
          className="update-toast-later"
          onClick={() => setDismissed(true)}
          disabled={updating}
        >
          Later
        </button>
        <button
          className="update-toast-update"
          onClick={handleUpdate}
          disabled={updating && !isManual}
        >
          {isManual ? 'View Release' : updating ? 'Updating...' : 'Update Now'}
        </button>
      </div>
    </div>
  );
}
