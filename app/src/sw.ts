/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

// Workbox precaching (manifest injected by VitePWA at build time)
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Allow the app to trigger activation of a waiting service worker
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Push Notification Handler ──────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data: { title?: string; body?: string; tag?: string; url?: string };
  try {
    data = event.data.json();
  } catch {
    return;
  }

  const options: NotificationOptions & { renotify?: boolean } = {
    body: data.body || '',
    icon: '/pwa-192x192.png',
    tag: data.tag || 'drocsid-push',
    renotify: true,
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(data.title || 'Drocsid', options));
});

// ── Notification Click Handler ─────────────────────────

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = (event.notification.data?.url as string) || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        // Focus existing tab if one is open
        for (const client of clients) {
          if (client.url.includes(self.location.origin)) {
            client.focus();
            client.postMessage({ type: 'NOTIFICATION_CLICK', url });
            return;
          }
        }
        // Otherwise open a new tab
        return self.clients.openWindow(url);
      }),
  );
});
