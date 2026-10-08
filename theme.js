(function () {
  const KEY = 'fixaTheme';
  const saved = localStorage.getItem(KEY) || 'dark';
  document.documentElement.setAttribute('data-theme', saved);

  window.FixaTheme = {
    get() { return document.documentElement.getAttribute('data-theme') || 'dark'; },
    set(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem(KEY, theme);
    },
    toggle() {
      const next = this.get() === 'dark' ? 'light' : 'dark';
      this.set(next);
      return next;
    }
  };
})();