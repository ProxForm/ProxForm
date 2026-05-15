// © 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.
// ProxForm — home-page background parallax. Writes --bg-shift on the root
// from scrollY so the CSS grid drifts at a fraction of the scroll speed.

(function () {
  if (!document.body.classList.contains('home-page')) return;

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
