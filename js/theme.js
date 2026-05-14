(function () {
  const KEY = 'proxform_theme';
  const root = document.documentElement;
  const saved = localStorage.getItem(KEY);
  if (saved === 'dark' || saved === 'light') {
    root.setAttribute('data-theme', saved);
  } else if (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) {
    root.setAttribute('data-theme', 'dark');
  }

  window.toggleTheme = function () {
    const current = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem(KEY, next);
  };
})();
