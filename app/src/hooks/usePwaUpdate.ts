import { useState, useEffect } from 'react';

/**
 * Hook that registers the service worker in prompt mode and exposes
 * whether a new version is available plus a function to apply the update.
 * Only active in web builds (not Tauri).
 */
export function usePwaUpdate() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateSW, setUpdateSW] = useState<((reloadPage?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    // Skip in Tauri — no service worker there
    if ('__TAURI_INTERNALS__' in window) return;

    let cancelled = false;

    async function register() {
      try {
        // Dynamic import so the virtual module is only resolved in web builds
        const { registerSW } = await import('virtual:pwa-register');
        if (cancelled) return;

        const update = registerSW({
          onNeedRefresh() {
            setNeedRefresh(true);
          },
          onOfflineReady() {
            // silently ready — no action needed
          },
        });

        setUpdateSW(() => update);
      } catch {
        // vite-plugin-pwa not available (e.g., dev mode without SW)
      }
    }

    register();
    return () => { cancelled = true; };
  }, []);

  const applyUpdate = async () => {
    if (updateSW) {
      await updateSW(true); // reloads the page
    }
  };

  return { needRefresh, applyUpdate };
}
