import { create } from 'zustand';

export interface UpdateInfo {
  version: string;
  source: 'pwa' | 'electron' | 'electron-manual';
  installCmd?: string;
}

const isDesktop = !!(globalThis as any).electronAPI;

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
      if (isDesktop) {
        const result = await (window as any).electronAPI?.checkForUpdates();
        if (result) {
          const info: UpdateInfo = result.autoUpdate
            ? { version: result.version, source: 'electron' }
            : {
                version: result.version,
                source: 'electron-manual',
                installCmd: buildInstallCmd(result.version, result.pkgType ?? null),
              };
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
