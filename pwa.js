// ── Service worker registration + auto-update ──
let hadController = false;
if ('serviceWorker' in navigator) {
  hadController = !!navigator.serviceWorker.controller;
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(console.warn));

  // When a new worker takes over, reload once (not on first install, not while chatting)
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    if (document.body.classList.contains('chat-open')) return;
    reloaded = true;
    location.reload();
  });

  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    try { (await navigator.serviceWorker.getRegistration())?.update(); } catch {}
  });
}

async function hardRefresh() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await Promise.race([reg?.update(), new Promise((r) => setTimeout(r, 1500))]);
  } catch {}
  location.reload();
}
window.FixaPWA = { refresh: hardRefresh };

// ── Pull-to-refresh ──
(function () {
  if (!('ontouchstart' in window)) return;
  const THRESHOLD = 75, MAX = 120;

  const ind = document.createElement('div');
  ind.style.cssText =
    'position:fixed;top:calc(env(safe-area-inset-top,0px) + 8px);left:50%;z-index:99998;width:40px;height:40px;' +
    'margin-left:-20px;border-radius:50%;background:#051e30;border:1px solid rgba(255,215,0,.5);display:flex;' +
    'align-items:center;justify-content:center;color:#ffd700;font-size:18px;box-shadow:0 4px 16px rgba(0,0,0,.4);' +
    'transform:translateY(-70px);opacity:0;pointer-events:none';
  const icon = document.createElement('span');
  icon.textContent = '↓';
  ind.appendChild(icon);
  document.body.appendChild(ind);

  let startY = 0, startX = 0, dist = 0, spin = null, busy = false, scroller = null;

  const insideFixed = (el) => {
    for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (getComputedStyle(n).position === 'fixed') return true;
    }
    return false;
  };
  const scrollParent = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n;
    }
    return document.scrollingElement || document.documentElement;
  };
  const place = (d) => {
    ind.style.opacity = Math.min(1, d / 40);
    ind.style.transform = `translateY(${d - 60}px)`;
    icon.style.transform = `rotate(${d >= THRESHOLD ? 180 : 0}deg)`;
    icon.style.transition = 'transform .15s';
  };
  const reset = () => {
    ind.style.transition = 'transform .2s, opacity .2s';
    ind.style.transform = 'translateY(-70px)';
    ind.style.opacity = '0';
    setTimeout(() => (ind.style.transition = ''), 220);
    dist = 0;
  };

  function onMove(e) {
    const t = e.touches[0];
    const dy = t.clientY - startY, dx = t.clientX - startX;
    if (dy <= 0 || Math.abs(dx) > dy || scroller.scrollTop > 0) { end(true); return; }
    if (e.cancelable) e.preventDefault();
    dist = Math.min(MAX, dy * 0.55);
    place(dist);
  }
  function end(cancel) {
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);
    document.removeEventListener('touchcancel', onEnd);
    if (!cancel && dist >= THRESHOLD) {
      busy = true;
      ind.style.transform = 'translateY(16px)';
      icon.textContent = '↻';
      spin = icon.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], { duration: 700, iterations: Infinity });
      hardRefresh();
    } else reset();
  }
  const onEnd = () => end(false);

  document.addEventListener('touchstart', (e) => {
    if (busy || e.touches.length !== 1) return;
    if (document.body.classList.contains('chat-open')) return;
    const t = e.target;
    if (t.closest('input,textarea,select,button,.bottom-nav') || insideFixed(t)) return;
    scroller = scrollParent(t);
    if (scroller.scrollTop > 0) return;
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    dist = 0;
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
  }, { passive: true });
})();

// ── Install bar (unchanged) ──
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

window.addEventListener('beforeinstallprompt', (e) => {
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

if (isIOS && !isStandalone && !dismissedRecently()) {
  window.addEventListener('load', () => setTimeout(() =>
    makeInstallBar('To install: tap <b>Share</b> then <b>Add to Home Screen</b>', null), 2500));
}