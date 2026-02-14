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
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
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
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (!document.hidden) return;

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
