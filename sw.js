// Fixa PWA bootstrap
//   1. registers the service worker (sw.js)
//   2. checks for a new version on load, when the tab becomes visible again, and every 30 minutes
//   3. shows a small "Update" banner when a new version has arrived (never reloads by itself,
//      so nobody loses a half-typed message or a payment in progress)
//   4. shows an "Install App" button where the browser supports it
(function () {
  'use strict';

  // Safe even if a page includes this script twice
  if (window.__fixaPwaLoaded) return;
  window.__fixaPwaLoaded = true;

  function onBodyReady(fn) {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  // ── 1 + 2 + 3: service worker + update banner ─────────────────────────────
  function showUpdateBanner() {
    onBodyReady(function () {
      if (document.getElementById('fixaUpdateBanner')) return;

      var bar = document.createElement('div');
      bar.id = 'fixaUpdateBanner';
      bar.setAttribute('role', 'status');
      bar.style.cssText =
        'position:fixed;left:12px;right:12px;bottom:calc(96px + env(safe-area-inset-bottom,0px));' +
        'z-index:6000;display:flex;align-items:center;justify-content:space-between;gap:12px;' +
        'background:#0a1f33;color:#fff;border:1px solid rgba(255,215,0,.45);border-radius:14px;' +
        'padding:12px 14px;font:600 13px/1.3 system-ui,Arial,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.45)';

      var msg = document.createElement('span');
      msg.textContent = 'A new version of Fixa is ready.';

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Update';
      btn.style.cssText =
        'background:#ffd700;color:#001;border:none;border-radius:999px;padding:8px 16px;' +
        'font-weight:800;font-size:13px;cursor:pointer;flex-shrink:0';
      btn.addEventListener('click', function () { window.location.reload(); });

      bar.appendChild(msg);
      bar.appendChild(btn);
      document.body.appendChild(bar);
    });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      // Was this page already under a service worker when it opened? If not (first visit ever),
      // the takeover at the end of installation is not an "update" and must not show the banner.
      var hadController = !!navigator.serviceWorker.controller;

      navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })   // always fetch sw.js fresh, never from HTTP cache
        .then(function (registration) {
          if (hadController) {
            navigator.serviceWorker.addEventListener('controllerchange', showUpdateBanner);
          }

          function check() { registration.update().catch(function () {}); }
          check();
          document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') check();
          });
          setInterval(check, 30 * 60 * 1000);
        })
        .catch(function (err) { console.warn('[PWA] Service worker registration failed:', err); });
    });
  }

  // ── 4: install button (Chrome / Edge / Android) ───────────────────────────
  var deferredPrompt = null;
  var installBtn = document.createElement('button');
  installBtn.id = 'fixaInstallBtn';
  installBtn.type = 'button';
  installBtn.textContent = '⬇ Install App';
  installBtn.style.cssText =
    'position:fixed;left:50%;transform:translateX(-50%);' +
    'bottom:calc(90px + env(safe-area-inset-bottom,0px));' +
    'background:#ffd700;color:#001;border:none;padding:10px 18px;border-radius:999px;' +
    'font-weight:800;font-size:13px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.35);' +
    'z-index:5000;display:none';
  onBodyReady(function () { document.body.appendChild(installBtn); });

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.style.display = 'block';
  });

  installBtn.addEventListener('click', async function () {
    if (!deferredPrompt) return;
    installBtn.style.display = 'none';
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  });

  window.addEventListener('appinstalled', function () {
    installBtn.style.display = 'none';
    deferredPrompt = null;
  });
})();
