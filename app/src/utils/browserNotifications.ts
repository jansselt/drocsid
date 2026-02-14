import { isTauri } from '../api/instance';

const PREF_KEY = 'drocsid:browser-notifications-enabled';

let browserNotificationsEnabled = (() => {
  try {
    const stored = localStorage.getItem(PREF_KEY);
    if (stored !== null) return stored === 'true';
  } catch {
    /* localStorage unavailable */
  }
  return true; // enabled by default
})();

export function setBrowserNotificationsEnabled(enabled: boolean): void {
  browserNotificationsEnabled = enabled;
  try {
    localStorage.setItem(PREF_KEY, String(enabled));
  } catch {
    /* */
  }
}

export function getBrowserNotificationsEnabled(): boolean {
  return browserNotificationsEnabled;
}

export function getPermissionState(): NotificationPermission | 'unsupported' {
  if (isTauri()) return 'granted'; // Tauri handles permissions natively
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (isTauri()) {
    try {
      const { isPermissionGranted, requestPermission } = await import(
        '@tauri-apps/plugin-notification'
      );
      let granted = await isPermissionGranted();
      if (!granted) {
        const result = await requestPermission();
        granted = result === 'granted';
      }
      return granted ? 'granted' : 'denied';
    } catch {
      return 'granted'; // Tauri notifications usually work without explicit permission on Linux
    }
  }
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.requestPermission();
}

export function showBrowserNotification(
  title: string,
  body: string,
  onClick?: () => void,
  tag?: string,
): void {
  if (!browserNotificationsEnabled) return;
  if (!document.hidden) return;

  if (isTauri()) {
    import('@tauri-apps/plugin-notification').then(({ sendNotification }) => {
      sendNotification({ title, body });
    }).catch(() => {
      // Fall through silently if plugin unavailable
    });
    return;
  }

  // Web fallback
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const notification = new Notification(title, {
    body,
    icon: '/favicon.ico',
    tag: tag || 'drocsid-message',
    renotify: true,
  } as NotificationOptions);

  notification.onclick = () => {
    window.focus();
    notification.close();
    onClick?.();
  };
}
