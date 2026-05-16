// © 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.
// ProxForm — Google Analytics (GA4), consent-gated, landing-page only.
//
// HARD RULES (do not loosen without re-reading /gdpr.html + /hipaa.html):
//   1. GA only ever runs on the public landing page (/ or /index.html).
//      Never on the SPA shell (app.html) or the patient page (fill.html) —
//      those are the PHI path and must stay analytics-free.
//   2. GA does not load until the visitor explicitly clicks "Accept".
//      No cookies, no Google network call, before consent. Decline = never.
//   3. This file is linked from every page, but it is a no-op everywhere
//      except the landing page post-consent. The scoping is enforced here,
//      not by which pages include the tag.

(function () {
  'use strict';

  var GA_ID = 'G-WTGX62S0G9';            // GA4 Measurement ID (ProxForm)
  var CONSENT_KEY = 'proxform_ga_consent';

  // Only the public landing page. gdpr.html / hipaa.html also use
  // body.home-page but their pathname isn't the index, so they're excluded
  // — GA is the home page and nowhere else.
  function isLandingHome() {
    var p = location.pathname.replace(/\/index\.html$/, '/');
    return p === '/' &&
      document.body && document.body.classList.contains('home-page');
  }

  function readConsent() {
    try { return localStorage.getItem(CONSENT_KEY); } catch (_) { return null; }
  }
  function writeConsent(v) {
    try { localStorage.setItem(CONSENT_KEY, v); } catch (_) {}
  }

  function loadGA() {
    if (!GA_ID || GA_ID === 'G-XXXXXXXXXX') return;   // not configured yet
    if (window.__proxGAloaded) return;
    window.__proxGAloaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    // anonymize_ip + no ad signals — minimum-footprint config.
    gtag('config', GA_ID, { anonymize_ip: true, allow_google_signals: false, allow_ad_personalization_signals: false });
  }

  function dismiss(banner, choice) {
    writeConsent(choice);
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    if (choice === 'granted') loadGA();
  }

  function showBanner() {
    var b = document.createElement('div');
    b.className = 'ga-consent';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-label', 'Analytics consent');
    b.innerHTML =
      '<p class="ga-consent-text">' +
        'This landing page uses <strong>Google Analytics</strong> only to count visits. ' +
        'The ProxForm app and the patient form pages collect <strong>nothing</strong> — ' +
        'no cookies, no analytics, no third parties. ' +
        '<a href="/gdpr.html">Details</a>.' +
      '</p>' +
      '<div class="ga-consent-actions">' +
        '<button type="button" class="ga-decline">Decline</button>' +
        '<button type="button" class="ga-accept">Accept</button>' +
      '</div>';
    document.body.appendChild(b);
    b.querySelector('.ga-accept').addEventListener('click', function () { dismiss(b, 'granted'); });
    b.querySelector('.ga-decline').addEventListener('click', function () { dismiss(b, 'denied'); });
  }

  function start() {
    if (!isLandingHome()) return;          // app / fill / gdpr / hipaa → no-op
    var c = readConsent();
    if (c === 'granted') { loadGA(); return; }
    if (c === 'denied')  { return; }
    showBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
