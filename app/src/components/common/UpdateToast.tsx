import { useState, useEffect, useCallback } from 'react';
import { usePwaUpdate } from '../../hooks/usePwaUpdate';
import { useUpdateStore } from '../../stores/updateStore';
import type { UpdateInfo } from '../../stores/updateStore';
import './UpdateToast.css';

const isTauri = '__TAURI_INTERNALS__' in globalThis;

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const INITIAL_DELAY_MS = 10_000;

const REPO = 'jansselt/drocsid';

function buildInstallCmd(version: string, pkgType: string | null): string | undefined {
  const tag = `drocsid-v${version}`;
  const base = `https://github.com/${REPO}/releases/download/${tag}`;

  switch (pkgType) {
    case 'deb': {
      const file = `Drocsid_${version}_amd64.deb`;
      return `curl -LO '${base}/${file}' && sudo dpkg -i ${file}`;
    }
    case 'rpm':
      return `sudo dnf install '${base}/Drocsid-${version}-1.x86_64.rpm'`;
    case 'pacman': {
      const file = `drocsid-${version}-1-x86_64.pkg.tar.zst`;
      return `curl -LO '${base}/${file}' && sudo pacman -U ${file}`;
    }
    default:
      return undefined;
  }
}

export function UpdateToast() {
  const update = useUpdateStore((s) => s.update);
  const dismissed = useUpdateStore((s) => s.dismissed);
  const updating = useUpdateStore((s) => s.updating);
  const setUpdate = useUpdateStore((s) => s.setUpdate);
  const dismiss = useUpdateStore((s) => s.dismiss);
  const setUpdating = useUpdateStore((s) => s.setUpdating);

  const [copied, setCopied] = useState(false);

  const { needRefresh, applyUpdate } = usePwaUpdate();

  useEffect(() => {
    if (needRefresh && !isTauri) {
      setUpdate({ version: '', source: 'pwa' });
    }
  }, [needRefresh, setUpdate]);

  const checkTauriUpdate = useCallback(async () => {
    if (!isTauri) return;
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await check();
      if (result) {
        const method = await invoke<{ auto_update: boolean; pkg_type: string | null }>('get_update_method');
        let info: UpdateInfo;
        if (method.auto_update) {
          info = { version: result.version, source: 'tauri' };
        } else {
          info = {
            version: result.version,
            source: 'tauri-manual',
            installCmd: buildInstallCmd(result.version, method.pkg_type),
          };
        }
        setUpdate(info);
      }
    } catch {
      // Update check failed
    }
  }, [setUpdate]);

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
