// © 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.
// ProxForm — footer behaviors. Contact email is built at click time so it
// never appears in page source for naive scrapers.

(function () {
  function openContact() {
    // Two-part base64 — recombined in JS only.
    const u = atob('YXJ0aXZpY29sYWI=');     // user
    const d = atob('Z21haWwuY29t');         // domain
    const subject = encodeURIComponent('ProxForm');
    location.href = `mailto:${u}@${d}?subject=${subject}`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Footer button (#contact-btn) plus any inline "contact us" trigger
    // marked .contact-link — all use the same build-at-click-time mailto so
    // the address never appears in page source.
    document.querySelectorAll('#contact-btn, .contact-link')
      .forEach(el => el.addEventListener('click', openContact));
  });
})();
