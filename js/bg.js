// © 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.
// ProxForm — home-page background parallax. Writes --bg-shift on the root
// from scrollY so the CSS grid drifts at a fraction of the scroll speed.

// The scroll listener is global so the parallax works on the standalone
// /index.html + /gdpr.html pages AND on the SPA shell's /#home + /#gdpr
// routes, where body.home-page is toggled by js/router.js after this script
// has already loaded. The CSS variable only matters when ::before is visible
// (which is gated on body.home-page), so it's safe to write it every scroll.

(function () {
  const FACTOR = 0.35;
  let raf = null;

  function update() {
    raf = null;
    const y = window.scrollY || window.pageYOffset || 0;
    document.documentElement.style.setProperty('--bg-shift', (y * FACTOR) + 'px');
  }

  window.addEventListener('scroll', () => {
    if (raf == null) raf = requestAnimationFrame(update);
  }, { passive: true });

  update();
})();
