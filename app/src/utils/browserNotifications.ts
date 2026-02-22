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

// ── Notification batching ──────────────────────────────

interface PendingNotification {
  title: string;
  body: string;
  onClick?: () => void;
  tag: string;
  channelId: string;
}

const BATCH_WINDOW_MS = 2000;
let pendingNotifications: PendingNotification[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;

function showNotificationDirect(
  title: string,
  body: string,
  onClick?: () => void,
  tag?: string,
): void {
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

function flushNotifications(): void {
  batchTimer = null;
  const batch = pendingNotifications;
  pendingNotifications = [];

  if (batch.length === 0) return;

  if (batch.length === 1) {
    const n = batch[0];
    showNotificationDirect(n.title, n.body, n.onClick, n.tag);
    return;
  }

  // Group by channel
  const byChannel = new Map<string, PendingNotification[]>();
  for (const n of batch) {
    const existing = byChannel.get(n.channelId) || [];
    existing.push(n);
    byChannel.set(n.channelId, existing);
  }

  if (byChannel.size === 1) {
    // All from same channel — summarize
    const items = [...byChannel.values()][0];
    const title = `${items.length} new messages`;
    const body = items.map((n) => `${n.title}: ${n.body}`).join('\n').slice(0, 200);
    showNotificationDirect(title, body, items[items.length - 1].onClick, items[0].tag);
  } else {
    // Multiple channels
    const title = `${batch.length} new messages in ${byChannel.size} conversations`;
    const body = [...byChannel.entries()]
      .map(([, items]) => `${items[0].title}: ${items.length} message${items.length > 1 ? 's' : ''}`)
      .join('\n')
      .slice(0, 200);
    showNotificationDirect(title, body, batch[batch.length - 1].onClick, 'drocsid-batch');
  }
}

export function showBrowserNotification(
  title: string,
  body: string,
  onClick?: () => void,
  tag?: string,
): void {
  if (!browserNotificationsEnabled) return;
  if (!document.hidden) return;

  const channelId = tag?.replace(/^(mention-|dm-)/, '') || 'unknown';

  pendingNotifications.push({ title, body, onClick, tag: tag || 'drocsid-message', channelId });

  if (batchTimer) clearTimeout(batchTimer);
  batchTimer = setTimeout(flushNotifications, BATCH_WINDOW_MS);
}
