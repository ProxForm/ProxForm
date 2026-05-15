// © 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.
// ProxForm — privacy shield.
//
// Masks the answers in a submission view (or any container) after the user
// has been idle for a configurable timeout. Default 2 minutes, configurable
// per device. Pattern is "Netflix still-watching":
//
//   T -  0s   → user lands on submission view, idle timer arms
//   T -  90s  → still idle, no shield yet
//   T - 120s  → idle timer hit. Show countdown banner "Will shield in 30s".
//   T - 150s  → no response, shield engages (CSS blur on every answer cell).
//                The clinician taps "Reveal" or the overlay to unshield.
//
// Any mousemove/keydown/scroll/touch in the shielded container resets the
// idle timer. The user-configurable preference lives in localStorage so it
// persists across reloads but never leaves the device.

(function () {
  'use strict';

  const PREF_KEY = 'proxform_shield_timeout_ms';
  const DEFAULTS = {
    // Total time from "last activity" → "shield engaged". The user's picker
    // value sets this directly. The "Still viewing?" countdown is carved
    // OUT of this window, not added on top.
    timeoutMs:   2 * 60 * 1000,
    // Preferred countdown length; clipped down to half the chosen interval
    // so 30-second mode still gets a meaningful (if brief) heads-up.
    warnMs:          30 * 1000,
    activityEvents: ['mousemove', 'keydown', 'scroll', 'touchstart', 'click']
  };

  // Options the picker offers. The shield can never be turned off entirely
  // (GDPR-proof posture) and never go above 5 minutes — anything longer
  // defeats the point of "data at rest stays hidden".
  const PRESETS = [
    { value: 30 * 1000,        label: '30 seconds' },
    { value: 60 * 1000,        label: '1 minute' },
    { value: 2 * 60 * 1000,    label: '2 minutes' },
    { value: 5 * 60 * 1000,    label: '5 minutes' }
  ];
  const MIN_TIMEOUT_MS = 30 * 1000;
  const MAX_TIMEOUT_MS = 5 * 60 * 1000;

  function readPref() {
    try {
      const raw = localStorage.getItem(PREF_KEY);
      if (raw == null) return DEFAULTS.timeoutMs;
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n < MIN_TIMEOUT_MS || n > MAX_TIMEOUT_MS) return DEFAULTS.timeoutMs;
      return n;
    } catch (_) { return DEFAULTS.timeoutMs; }
  }
  function writePref(ms) {
    // Clamp both ways — a hand-edited localStorage value can't dodge the
    // shield either by being too long or too short.
    const parsed = parseInt(ms, 10);
    const safe = !Number.isFinite(parsed) ? DEFAULTS.timeoutMs : parsed;
    const clamped = Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, safe));
    try { localStorage.setItem(PREF_KEY, String(clamped)); } catch (_) {}
  }

  // Attach the shield to a container. Returns a controller with stop() so
  // the caller can tear it down on navigation. Subsequent calls on the same
  // container reuse the controller.
  function attach(container) {
    if (!container) return null;
    if (container._proxShield) return container._proxShield;

    let idleTimer = null;
    let warnTimer = null;
    let banner = null;
    let countdownInt = null;
    let shielded = false;

    function clearTimers() {
      if (idleTimer)    { clearTimeout(idleTimer);  idleTimer = null; }
      if (warnTimer)    { clearTimeout(warnTimer);  warnTimer = null; }
      if (countdownInt) { clearInterval(countdownInt); countdownInt = null; }
      if (banner)       { banner.remove(); banner = null; }
    }

    // Mask answer text with '***'. Each masked element stashes its original
    // innerHTML on a JS property (not a data-* attribute — those can't hold
    // arbitrary HTML safely) so reveal restores it byte-for-byte. The
    // overlay handles the click-to-reveal interaction.
    //
    // Two passes:
    //   1. Every .intake-answer inside the container (the form values).
    //   2. Every .prox-shield-extra on the page (e.g. the "From: <name>"
    //      header on the submission detail view, which sits OUTSIDE the
    //      container but should mask in lockstep).
    function maskedEls() {
      const out = [];
      container.querySelectorAll('.intake-answer').forEach(el => out.push(el));
      document.querySelectorAll('.prox-shield-extra').forEach(el => out.push(el));
      return out;
    }
    function maskAnswers() {
      for (const el of maskedEls()) {
        if (el._proxOriginal != null) continue; // already masked
        el._proxOriginal = el.innerHTML;
        el.innerHTML = '<span class="prox-mask">***</span>';
      }
    }
    function restoreAnswers() {
      for (const el of maskedEls()) {
        if (el._proxOriginal == null) continue;
        el.innerHTML = el._proxOriginal;
        el._proxOriginal = null;
      }
    }

    function reveal() {
      if (!shielded) return;
      shielded = false;
      container.classList.remove('prox-shielded');
      restoreAnswers();
      const cover = container.querySelector('.prox-shield-overlay');
      if (cover) cover.remove();
      armIdle();
    }

    function shield() {
      clearTimers();
      shielded = true;
      container.classList.add('prox-shielded');
      maskAnswers();
      const cover = document.createElement('div');
      cover.className = 'prox-shield-overlay';
      cover.innerHTML = `
        <div class="prox-shield-card">
          <div class="prox-shield-icon" aria-hidden="true">🔒</div>
          <h2>Privacy shield is on</h2>
          <p>This submission has been idle. Tap anywhere to reveal.</p>
        </div>
      `;
      cover.addEventListener('click', reveal);
      container.appendChild(cover);
    }

    function showWarning(warnMs) {
      clearTimers();
      const total = warnMs;
      const startedAt = Date.now();
      banner = document.createElement('div');
      banner.className = 'prox-shield-warn';
      banner.innerHTML = `
        <div class="prox-shield-warn-inner">
          <strong>Still viewing?</strong>
          <span>Privacy shield in <span class="prox-shield-count">${Math.ceil(total / 1000)}</span>s</span>
          <button type="button" class="primary" data-act="continue">Yes, I'm here</button>
        </div>
      `;
      document.body.appendChild(banner);
      banner.querySelector('[data-act="continue"]').addEventListener('click', () => {
        clearTimers();
        armIdle();
      });
      const tick = () => {
        const remaining = total - (Date.now() - startedAt);
        const span = banner && banner.querySelector('.prox-shield-count');
        if (span) span.textContent = Math.max(0, Math.ceil(remaining / 1000));
        if (remaining <= 0) shield();
      };
      countdownInt = setInterval(tick, 250);
      warnTimer = setTimeout(shield, total);
    }

    function armIdle() {
      clearTimers();
      const totalMs = readPref();
      // Countdown is at most DEFAULTS.warnMs and at most half the total
      // window — so 30-second mode warns for 15s, 1-minute mode warns for
      // 30s, and longer modes always get the full 30s warning.
      const warnMs = Math.min(DEFAULTS.warnMs, Math.floor(totalMs / 2));
      const idleDelay = Math.max(0, totalMs - warnMs);
      idleTimer = setTimeout(() => showWarning(warnMs), idleDelay);
    }

    function onActivity() {
      if (shielded) return; // taps on the cover handle reveal directly
      armIdle();
    }

    DEFAULTS.activityEvents.forEach(ev => container.addEventListener(ev, onActivity, { passive: true }));
    armIdle();

    const controller = {
      stop() {
        clearTimers();
        DEFAULTS.activityEvents.forEach(ev => container.removeEventListener(ev, onActivity));
        if (shielded) reveal();
        container._proxShield = null;
      },
      reveal,
      shield,
      refreshPref() { armIdle(); }
    };
    container._proxShield = controller;
    return controller;
  }

  // Render a <select> the clinician can change to pick their idle window.
  // Wires it up so changes update localStorage and re-arm any active shield.
  function buildPicker(targetEl) {
    if (!targetEl) return;
    const current = readPref();
    const opts = PRESETS.map(p =>
      `<option value="${p.value}"${p.value === current ? ' selected' : ''}>${p.label}</option>`
    ).join('');
    targetEl.innerHTML =
      '<label class="prox-shield-picker">' +
        '<span>Auto-shield after</span>' +
        '<select>' + opts + '</select>' +
      '</label>';
    targetEl.querySelector('select').addEventListener('change', (e) => {
      const ms = parseInt(e.target.value, 10) || 0;
      writePref(ms);
      // Re-arm whatever shielded containers are currently mounted.
      document.querySelectorAll('[data-shield-host]').forEach(el => {
        if (el._proxShield) el._proxShield.refreshPref();
      });
    });
  }

  window.ProxShield = { attach, buildPicker, readPref, writePref, PRESETS };
})();
