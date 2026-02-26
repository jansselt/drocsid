import { useState, useEffect } from 'react';
import { usePwaUpdate } from '../../hooks/usePwaUpdate';
import { useUpdateStore } from '../../stores/updateStore';
import './UpdateToast.css';

const isTauri = '__TAURI_INTERNALS__' in globalThis;

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const INITIAL_DELAY_MS = 10_000;

const REPO = 'jansselt/drocsid';

export function UpdateToast() {
  const update = useUpdateStore((s) => s.update);
  const dismissed = useUpdateStore((s) => s.dismissed);
  const updating = useUpdateStore((s) => s.updating);
  const setUpdate = useUpdateStore((s) => s.setUpdate);
  const dismiss = useUpdateStore((s) => s.dismiss);
  const setUpdating = useUpdateStore((s) => s.setUpdating);

  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates);

  const [copied, setCopied] = useState(false);

  const { needRefresh, applyUpdate } = usePwaUpdate();

  useEffect(() => {
    if (needRefresh && !isTauri) {
      setUpdate({ version: '', source: 'pwa' });
    }
  }, [needRefresh, setUpdate]);

  // Periodic Tauri update check
  useEffect(() => {
    if (!isTauri) return;
    const initialTimeout = setTimeout(checkForUpdates, INITIAL_DELAY_MS);
    const interval = setInterval(checkForUpdates, CHECK_INTERVAL_MS);
    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [checkForUpdates]);

  const handleUpdate = async () => {
    setUpdating(true);
    try {
      if (update?.source === 'pwa') {
        // Race the SW-based update against a timeout — if the service worker
        // flow hangs (e.g. controllerchange never fires), fall back to a
        // hard reload so the user isn't stuck on "Updating..." forever.
        const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 5_000));
        const result = await Promise.race([applyUpdate(), timeout]);
        if (result === 'timeout') {
          window.location.reload();
        }
        return;
      } else if (update?.source === 'tauri') {
        const { check } = await import('@tauri-apps/plugin-updater');
        const { relaunch } = await import('@tauri-apps/plugin-process');
        const result = await check();
        if (result) {
          await result.downloadAndInstall();
          await relaunch();
        }
      } else if (update?.source === 'tauri-manual') {
        window.open(`https://github.com/${REPO}/releases/latest`, '_blank');
      }
    } catch {
      setUpdating(false);
    }
  };

  const handleCopy = async () => {
    if (!update?.installCmd) return;
    await navigator.clipboard.writeText(update.installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
      {isManual && update.installCmd && (
        <div className="update-toast-cmd-wrap">
          <code className="update-toast-cmd">{update.installCmd}</code>
          <button className="update-toast-copy" onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}
      {updating && !isManual && (
        <div className="update-toast-progress">Downloading update...</div>
      )}
      <div className="update-toast-actions">
        <button
          className="update-toast-later"
          onClick={dismiss}
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
