// © 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.
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

  // Mobile nav toggle. The topnav is hidden under 640px (CSS) — without a
  // hamburger there'd be no way to navigate on a phone. Injected here
  // because theme.js loads on every page that has a topbar, so every page
  // gets the toggle without per-file HTML edits.
  function wireMobileNav() {
    const bar = document.querySelector('.topbar');
    const nav = bar && bar.querySelector('.topnav');
    if (!bar || !nav || bar.querySelector('.nav-toggle')) return;

    const btn = document.createElement('button');
    btn.className = 'nav-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Toggle menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = '☰';

    function setOpen(open) {
      bar.classList.toggle('nav-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.textContent = open ? '✕' : '☰';
    }
    btn.addEventListener('click', () => setOpen(!bar.classList.contains('nav-open')));
    // Tapping a link (hash route or page link) closes the menu.
    nav.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });

    const actions = bar.querySelector('.topbar-actions');
    bar.insertBefore(btn, actions || null);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireMobileNav);
  } else {
    wireMobileNav();
  }
})();
