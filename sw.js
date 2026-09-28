// Fixa service worker (v4)
//
// HOW UPDATES REACH YOUR USERS
//   * Your own pages, scripts and styles are fetched NETWORK-FIRST. Whenever the visitor is
//     online, a normal refresh shows the newest deploy. No hard refresh, no waiting.
//   * The cache is only a fallback: it is used when the visitor is offline, or when the network
//     takes longer than NETWORK_TIMEOUT_MS (slow mobile data), so pages still open quickly.
//   * Other sites (Google sign-in, Paystack, CDN scripts, your API on api.fixaapp.net) are never
//     touched by this file.
//
// You do NOT need to bump CACHE_VERSION for normal deploys. Change it only when you want to
// wipe every visitor's cache.

const CACHE_VERSION = 'fixa-v4';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const OFFLINE_URL = '/offline.html';

// After this long without an answer from the network, show the cached copy (if there is one)
// while the network keeps loading in the background. Raise it for "always latest", lower it for "faster".
const NETWORK_TIMEOUT_MS = 3500;

// Caches left behind by older Fixa workers (fixa-v0 ... fixa-v3)
const LEGACY_CACHE = /^fixa-v[0-3](-|$)/;

// Small precache so the offline page and core assets exist from the first visit
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

self.addEventListener('install', (event) => {
  self.skipWaiting(); // take over as soon as installed, don't wait for every tab to close
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // 'reload' bypasses the browser's HTTP cache. GitHub Pages tells browsers to keep files 10 minutes.
      Promise.allSettled(SHELL_FILES.map((url) => cache.add(new Request(url, { cache: 'reload' }))))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const stale = keys.filter((k) => k.startsWith('fixa-') && k !== SHELL_CACHE && k !== RUNTIME_CACHE);
    const cameFromLegacyWorker = stale.some((k) => LEGACY_CACHE.test(k));

    await Promise.all(stale.map((k) => caches.delete(k)));
    await self.clients.claim();

    // One-time migration: tabs that are still showing pages served by an old worker get reloaded once,
    // so nobody stays stuck on an old version. Later updates show the "Update" banner from pwa.js instead.
    if (cameFromLegacyWorker) {
      const windows = await self.clients.matchAll({ type: 'window' });
      windows.forEach((w) => { try { w.navigate(w.url).catch(() => {}); } catch (e) { /* ignore */ } });
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;                       // logins, payments, messages: never touched
  if (request.headers.has('range')) return;                   // audio/video seeking
  if (request.destination === 'audio' || request.destination === 'video') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;            // other sites + api.fixaapp.net: browser handles them

  event.respondWith(networkFirst(event));
});

function networkFirst(event) {
  const { request } = event;

  // 'no-cache' = ask the server whether the file changed (skips the browser's 10-minute HTTP cache)
  let cacheWrite = Promise.resolve();
  const networkPromise = fetch(request, { cache: 'no-cache' }).then((response) => {
    if (response && response.ok && response.status === 200) {
      const copy = response.clone();
      cacheWrite = caches.open(RUNTIME_CACHE)
        .then(async (cache) => { await cache.put(request, copy); await trimCache(cache); })
        .catch(() => {});
    }
    return response;
  });

  // Keep the worker alive until the network + cache write finish, even if we already answered from cache
  event.waitUntil(networkPromise.then(() => cacheWrite, () => {}));

  return new Promise((resolve) => {
    let answered = false;
    const answer = (response) => {
      if (response && !answered) { answered = true; resolve(response); }
    };

    // Slow network: show the cached copy now, the fresh copy is saved for next time
    const timer = setTimeout(() => { cachedCopy(request).then(answer); }, NETWORK_TIMEOUT_MS);

    networkPromise.then(
      (response) => { clearTimeout(timer); answer(response); },
      async () => {
        clearTimeout(timer);
        answer(await fromCache(request));               // offline: cached copy, or the offline page
        if (!answered) resolve(Response.error());       // nothing to show at all
      }
    );
  });
}

// caches.match() searches caches in creation order, so it would return the OLD copy saved at install
// time before the newer copy saved on a later visit. Look in the runtime cache (newest) first.
async function cachedCopy(request, options) {
  const runtime = await caches.open(RUNTIME_CACHE);
  return (await runtime.match(request, options)) || (await caches.match(request, options));
}

async function fromCache(request) {
  const hit = await cachedCopy(request);
  if (hit) return hit;
  if (request.mode === 'navigate') {
    const loose = await cachedCopy(request, { ignoreSearch: true }); // e.g. ?reference=... after a payment
    return loose || caches.match(OFFLINE_URL);
  }
  return undefined;
}

async function trimCache(cache, max = 80) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}
