// Fixa Service Worker
// Network-first for same-origin files.
// Cache is only a fallback for slow/offline situations.

'use strict';

const CACHE_VERSION = 'fixa-v5';

const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const OFFLINE_URL = '/offline.html';

const NETWORK_TIMEOUT_MS = 3500;

const SHELL_FILES = [
  '/offline.html',
  '/manifest.json',
  '/config.js',
  '/theme.css',
  '/responsive.css',
  '/theme.js',
  '/pwa.js',
  '/fixa-logo.png'
];


// ─────────────────────────────────────────────
// INSTALL
// ─────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      await Promise.allSettled(
        SHELL_FILES.map((url) =>
          cache.add(
            new Request(url, {
              cache: 'reload'
            })
          )
        )
      );
    })
  );

  // Activate the new worker immediately.
  self.skipWaiting();
});


// ─────────────────────────────────────────────
// ACTIVATE
// ─────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys
          .filter(
            (key) =>
              key.startsWith('fixa-') &&
              key !== SHELL_CACHE &&
              key !== RUNTIME_CACHE
          )
          .map((key) => caches.delete(key))
      );

      // Let the new service worker control existing tabs.
      await self.clients.claim();
    })()
  );
});


// ─────────────────────────────────────────────
// FETCH
// ─────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only GET requests.
  if (request.method !== 'GET') return;

  // Don't interfere with range requests.
  if (request.headers.has('range')) return;

  // Don't interfere with audio/video.
  if (
    request.destination === 'audio' ||
    request.destination === 'video'
  ) {
    return;
  }

  const url = new URL(request.url);

  // Only handle Fixa's own origin.
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(networkFirst(request));
});


// ─────────────────────────────────────────────
// NETWORK FIRST
// ─────────────────────────────────────────────

async function networkFirst(request) {
  const networkPromise = fetch(request, {
    cache: 'no-cache'
  })
    .then(async (response) => {
      if (response && response.ok && response.status === 200) {
        const cache = await caches.open(RUNTIME_CACHE);

        try {
          await cache.put(request, response.clone());
          await trimCache(cache);
        } catch (error) {
          // Cache failure should never break the request.
          console.warn('[Fixa SW] Cache write failed:', error);
        }
      }

      return response;
    });

  const cachedPromise = cachedCopy(request);

  try {
    // Give the network a short chance to respond.
    return await Promise.race([
      networkPromise,
      timeout(NETWORK_TIMEOUT_MS).then(() => cachedPromise)
    ]);
  } catch (error) {
    // Offline fallback.
    return await fromCache(request);
  }
}


// ─────────────────────────────────────────────
// CACHE HELPERS
// ─────────────────────────────────────────────

async function cachedCopy(request) {
  const runtime = await caches.open(RUNTIME_CACHE);

  const runtimeHit = await runtime.match(request);

  if (runtimeHit) {
    return runtimeHit;
  }

  const shell = await caches.open(SHELL_CACHE);

  return await shell.match(request);
}


async function fromCache(request) {
  const hit = await cachedCopy(request);

  if (hit) {
    return hit;
  }

  if (request.mode === 'navigate') {
    const loose = await cachedCopy(
      new Request(request.url, {
        method: 'GET'
      })
    );

    if (loose) {
      return loose;
    }

    const offline = await caches.match(OFFLINE_URL);

    if (offline) {
      return offline;
    }
  }

  return new Response(
    'Fixa is currently offline.',
    {
      status: 503,
      headers: {
        'Content-Type': 'text/plain'
      }
    }
  );
}


function timeout(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}


async function trimCache(cache, max = 80) {
  const keys = await cache.keys();

  if (keys.length <= max) {
    return;
  }

  const excess = keys.length - max;

  for (let i = 0; i < excess; i++) {
    await cache.delete(keys[i]);
  }
}
