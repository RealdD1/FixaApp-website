// Fixa PWA bootstrap — registers the service worker and offers an "Install app" prompt.
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) =>
        console.warn('[PWA] Service worker registration failed:', err)
      );
    });
  }

  let deferredPrompt = null;
  const btn = document.createElement('button');
  btn.id = 'fixaInstallBtn';
  btn.type = 'button';
  btn.textContent = '⬇ Install App';
  btn.style.cssText = `
    position:fixed; left:50%; transform:translateX(-50%);
    bottom:calc(90px + env(safe-area-inset-bottom,0px));
    background:#ffd700; color:#001; border:none; padding:10px 18px;
    border-radius:999px; font-weight:800; font-size:13px; cursor:pointer;
    box-shadow:0 8px 24px rgba(0,0,0,.35); z-index:5000; display:none;
  `;
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(btn));

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    btn.style.display = 'block';
  });

  btn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    btn.style.display = 'none';
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  });

  window.addEventListener('appinstalled', () => {
    btn.style.display = 'none';
    deferredPrompt = null;
  });
})();
