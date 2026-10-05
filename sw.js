const VERSION = 'fixa-v2';
const SHELL = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/config.js',
  '/pwa.js',
  '/sw.js',
  '/icons/icon-192.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION)
      .then(cache => cache.addAll(SHELL))
      .catch(error => {
        console.error('[Fixa SW] Precache failed:', error);
      })
  );

  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== VERSION)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Only handle Fixa's own origin.
  // API, Socket.IO, Paystack and external CDNs are untouched.
  if (url.origin !== self.location.origin) return;

  // HTML navigation: network first, offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();

          caches.open(VERSION).then(cache => {
            cache.put(request, copy);
          });

          return response;
        })
        .catch(() => caches.match('/offline.html'))
    );

    return;
  }

  // Static assets: cache first, then network.
  if (
    /\.(png|jpg|jpeg|svg|webp|gif|mp3|wav|woff|woff2|css|js)$/i.test(
      url.pathname
    )
  ) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;

        return fetch(request).then(response => {
          if (!response || !response.ok) {
            return response;
          }

          const copy = response.clone();

          caches.open(VERSION).then(cache => {
            cache.put(request, copy);
          });

          return response;
        });
      })
    );
  }
});

// Web Push
self.addEventListener('push', event => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    console.error('[Fixa SW] Invalid push payload:', error);
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Fixa', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || 'fixa',
      data: {
        url: data.url || '/SignIn.html'
      }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  const url = event.notification.data?.url || '/SignIn.html';

  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then(clientList => {
      const existing = clientList.find(client => {
        return client.url.includes(self.location.origin);
      });

      if (existing) {
        return existing.focus().then(() => {
          if ('navigate' in existing) {
            return existing.navigate(url);
          }
        });
      }

      return clients.openWindow(url);
    })
  );
});