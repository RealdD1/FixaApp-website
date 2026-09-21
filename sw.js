// Fixa service worker — app-shell caching + offline fallback.
// Bump this on every deploy so old caches get cleared.
const CACHE_VERSION = 'fixa-v1';
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const SHELL_CACHE = `${CACHE_VERSION}-shell`;

// Best-effort precache. Missing files are skipped instead of failing install,
// so add/remove pages here as your site grows.
const SHELL_FILES = [
  '/',
  '/index.html',
  '/SignIn.html',
  '/Signup.html',
  '/offline.html',
  '/manifest.json',
  '/theme.css',
  '/responsive.css',
  '/theme.js',
  '/pwa.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.allSettled(SHELL_FILES.map((url) => cache.add(url)))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never cache POST/PUT etc (logins, payments, messages)

  const url = new URL(request.url);

  // Never cache API calls or socket.io traffic — those must always be live.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ message: 'You are offline.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Cross-origin (CDN scripts, fonts, Google/Paystack SDKs): network first, no caching interference.
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }

  // Same-origin static assets/pages: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached || caches.match('/offline.html'));
      return cached || network;
    })
  );
});
