// sw.js — Service Worker (FIXED for Fixa Push)

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// 🔔 PUSH EVENT (main fix)
self.addEventListener('push', (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    console.warn('[SW] Push data parse error', e);
  }

  const title = data.title || 'Fixa Notification';
  const options = {
    body: data.body || 'You have a new update',
    icon: data.icon || '/icon.png',
    data: {
      url: data.url || '/',
      chatId: data.chatId || null,
      type: data.type || null
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// 📌 Notification click handling
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';
  const chatId = event.notification.data?.chatId;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientsArr) => {
        // If tab already open, focus it
        for (const client of clientsArr) {
          if (client.url.includes(self.location.origin)) {
            client.focus();

            client.postMessage({
              type: 'OPEN_CHAT',
              chatId
            });

            return;
          }
        }

        // Otherwise open new tab
        return self.clients.openWindow(url);
      })
  );
});