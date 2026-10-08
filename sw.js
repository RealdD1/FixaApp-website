const VERSION = 'fixa-v3';                       // bump on every deploy
const SHELL = ['/offline.html', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // allSettled: one missing file must not abort the whole install
    await Promise.allSettled(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

async function networkFirst(request, key, ms = 4000) {
  const cache = await caches.open(VERSION);
  try {
    const res = await withTimeout(fetch(request), ms);
    if (res && res.ok && res.type === 'basic') cache.put(key, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  const net = fetch(request).then((res) => {
    if (res && res.status === 200) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await net) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // API, sockets, Paystack, CDNs untouched

  // Pages: network first. Cached copy is keyed WITHOUT the query string.
  if (req.mode === 'navigate') {
    const key = url.origin + url.pathname;
    event.respondWith((async () => {
      try {
        let res = await networkFirst(req, key, 6000);
        if (res.redirected) {          // Safari refuses redirected responses from a SW
          const body = await res.blob();
          res = new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
        }
        return res;
      } catch {
        return (await caches.match(key)) || (await caches.match('/offline.html')) || Response.error();
      }
    })());
    return;
  }

  // Code + config: ALWAYS try network first so deploys reach users immediately
  if (/\.(js|css|webmanifest)$/i.test(url.pathname)) {
    event.respondWith(networkFirst(req, req, 4000).catch(() => Response.error()));
    return;
  }

  // Images, fonts, sounds: fast from cache, refreshed in the background
  if (/\.(png|jpg|jpeg|svg|webp|gif|ico|mp3|wav|woff2?)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req));
  }
});

// ── Web Push ──
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Fixa', {
    body: d.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: d.tag || 'fixa',
    renotify: true,
    data: { url: d.url || '/SignIn.html' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || '/SignIn.html', self.location.origin).href;
  e.waitUntil((async () => {
    const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        if ('navigate' in c) return c.navigate(target);
        return;
      }
    }
    return clients.openWindow(target);
  })());
});