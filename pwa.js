if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(console.warn));
}

let deferredPrompt = null;
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

function makeInstallBar(text, actionLabel, onAction) {
  if (document.getElementById('installBar')) return;
  const bar = document.createElement('div');
  bar.id = 'installBar';
  bar.style.cssText = 'position:fixed;left:12px;right:12px;bottom:96px;z-index:9000;background:#051e30;border:1px solid rgba(255,215,0,.35);border-radius:14px;padding:12px 14px;display:flex;align-items:center;gap:10px;color:#fff;font:13px Plus Jakarta Sans,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.4)';
  bar.innerHTML = `<span style="flex:1">${text}</span>` +
    (actionLabel ? `<button id="installGo" style="background:#ffd700;color:#000;border:none;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer">${actionLabel}</button>` : '') +
    `<button id="installX" style="background:none;border:none;color:#9aa6b2;font-size:20px;cursor:pointer">×</button>`;
  document.body.appendChild(bar);
  bar.querySelector('#installX').onclick = () => { bar.remove(); localStorage.setItem('installDismissed', Date.now()); };
  bar.querySelector('#installGo')?.addEventListener('click', onAction);
}

const dismissedRecently = () => Date.now() - Number(localStorage.getItem('installDismissed') || 0) < 7 * 864e5;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  if (isStandalone || dismissedRecently()) return;
  makeInstallBar('Install Fixa for faster access', 'Install', async () => {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    document.getElementById('installBar')?.remove();
  });
});

window.addEventListener('appinstalled', () => document.getElementById('installBar')?.remove());

// iOS Safari has no install prompt; show instructions instead
if (isIOS && !isStandalone && !dismissedRecently()) {
  window.addEventListener('load', () => setTimeout(() =>
    makeInstallBar('To install: tap <b>Share</b> then <b>Add to Home Screen</b>', null), 2500));
}