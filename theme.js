(function () {
  const KEY = 'fixa-theme';
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const pref = () => localStorage.getItem(KEY) || 'system';
  const resolve = (p) => (p === 'system' ? (mq.matches ? 'dark' : 'light') : p);

  function apply() {
    const t = resolve(pref());
    document.documentElement.setAttribute('data-theme', t);
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', t === 'dark' ? '#041b2b' : '#f4f7fb');
    document.querySelectorAll('[data-theme-choice]').forEach(b =>
      b.classList.toggle('active', b.dataset.themeChoice === pref()));
  }

  window.FixaTheme = { set(p) { localStorage.setItem(KEY, p); apply(); }, get: pref };
  mq.addEventListener?.('change', apply);
  apply();
  document.addEventListener('DOMContentLoaded', apply);
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme-choice]');
    if (b) FixaTheme.set(b.dataset.themeChoice);
  });
})();