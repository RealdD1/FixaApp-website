// Fixa theme toggle — persists choice, respects system preference on first visit,
// injects a floating sun/moon button on every page that includes this file.
(function () {
  const KEY = 'fixa-theme';

  function getInitialTheme() {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(KEY, theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#ffffff' : '#00172b');
    const btn = document.getElementById('fixaThemeToggle');
    if (btn) btn.textContent = theme === 'light' ? '🌙' : '☀️';
  }

  // Apply immediately (before paint) to avoid a flash of the wrong theme.
  applyTheme(getInitialTheme());

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.createElement('button');
    btn.id = 'fixaThemeToggle';
    btn.type = 'button';
    btn.title = 'Toggle light / dark mode';
    btn.style.cssText = `
      position:fixed; top:calc(12px + env(safe-area-inset-top,0px)); right:14px;
      width:38px; height:38px; border-radius:50%; border:1px solid rgba(255,215,0,.35);
      background:rgba(255,215,0,.12); color:#ffd700; font-size:17px; cursor:pointer;
      display:flex; align-items:center; justify-content:center; z-index:5000;
    `;
    btn.textContent = document.documentElement.getAttribute('data-theme') === 'light' ? '🌙' : '☀️';
    btn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      applyTheme(next);
    });
    document.body.appendChild(btn);
  });
})();
