import { isTauri } from '../api/instance';
import { getApiUrl } from '../api/instance';
import { getAccessToken } from '../api/client';

const PUSH_ENABLED_KEY = 'drocsid:push-notifications-enabled';

export function isPushSupported(): boolean {
  return !isTauri() && 'serviceWorker' in navigator && 'PushManager' in window;
}

export function getPushEnabled(): boolean {
  try {
    return localStorage.getItem(PUSH_ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

function setPushEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PUSH_ENABLED_KEY, String(enabled));
  } catch {
    /* localStorage unavailable */
  }
}

async function getVapidPublicKey(): Promise<string | null> {
  try {
    const res = await fetch(`${getApiUrl()}/push/vapid-key`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.public_key || null;
  } catch {
    return null;
  }
}

export async function subscribeToPush(): Promise<boolean> {
  if (!isPushSupported()) return false;

  const vapidKey = await getVapidPublicKey();
  if (!vapidKey) return false;

  const registration = await navigator.serviceWorker.ready;
  const applicationServerKey = urlBase64ToUint8Array(vapidKey);

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });

  // Send subscription to backend
  const subJson = subscription.toJSON();
  const token = getAccessToken();
  if (!token) return false;

  const res = await fetch(`${getApiUrl()}/push/subscribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      endpoint: subJson.endpoint,
      keys: subJson.keys,
    }),
  });

  if (res.ok) {
    setPushEnabled(true);
    return true;
  }
  return false;
}

export async function unsubscribeFromPush(): Promise<boolean> {
  if (!isPushSupported()) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();

      // Remove from backend
      const token = getAccessToken();
      if (token) {
        await fetch(`${getApiUrl()}/push/unsubscribe`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ endpoint }),
        }).catch(() => {});
      }
    }
  } catch {
    // Silently fail
  }

  setPushEnabled(false);
  return true;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from(rawData, (char) => char.charCodeAt(0));
}
