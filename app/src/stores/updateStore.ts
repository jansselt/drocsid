import { create } from 'zustand';

export interface UpdateInfo {
  version: string;
  source: 'pwa' | 'tauri' | 'tauri-manual';
  installCmd?: string;
}

const isTauri = '__TAURI_INTERNALS__' in globalThis;

const REPO = 'jansselt/drocsid';

export function buildInstallCmd(version: string, pkgType: string | null): string | undefined {
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

interface UpdateState {
  /** Available update info, null if no update */
  update: UpdateInfo | null;
  /** Whether the toast was dismissed (indicator still shows) */
  dismissed: boolean;
  /** Whether an update is actively downloading */
  updating: boolean;
  /** Whether a manual check is in progress */
  checking: boolean;

  setUpdate: (update: UpdateInfo | null) => void;
  dismiss: () => void;
  undismiss: () => void;
  setUpdating: (v: boolean) => void;
  checkForUpdates: () => Promise<void>;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  update: null,
  dismissed: false,
  updating: false,
  checking: false,

  setUpdate: (update) => set({ update, dismissed: false }),
  dismiss: () => set({ dismissed: true }),
  undismiss: () => set({ dismissed: false }),
  setUpdating: (updating) => set({ updating }),

  checkForUpdates: async () => {
    if (get().checking) return;
    set({ checking: true });
    try {
      if (isTauri) {
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
          set({ update: info, dismissed: false });
        }
      } else {
        // PWA: trigger service worker update check
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) {
          await reg.update();
        }
      }
    } catch {
      // Check failed silently
    } finally {
      set({ checking: false });
    }
  },
}));
