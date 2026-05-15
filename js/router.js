// © 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.
// ProxForm — hash router for the SPA shell.
//
// One HTML document (app.html) hosts every clinician view (Build / Forms /
// Inbox / Import / Submission). Each route fetches the corresponding legacy
// HTML page once, extracts its <main> content, injects it into #view-host,
// then calls the view module's mount(host, params).
//
// Sessions and IndexedDB live at module-global scope (ProxSessions / ProxStore)
// so they survive every route transition — a patient session opened on the
// Inbox view keeps its WebRTC connection while the clinician edits a form on
// the Build view.

(function () {
  'use strict';

  const ROUTES = {
    received:   { src: '/received.html', view: () => window.ProxReceivedView },
    build:      { src: '/builder.html',  view: () => window.ProxBuilderView  },
    forms:      { src: '/forms.html',    view: () => window.ProxFormsView    },
    import:     { src: '/import.html',   view: () => window.ProxImportView   },
    submission: { src: '/builder.html',  view: () => window.ProxSubmissionView }
  };

  const DEFAULT_ROUTE = 'received';
  const fragmentCache = Object.create(null);
  let current = { name: null, host: null };
  let routingNow = false;

  function host() { return document.getElementById('view-host'); }

  function parseHash() {
    // #/received → { name: 'received', params: [] }
    // #/build/abc-123 → { name: 'build', params: ['abc-123'] }
    // #/submission/sub_xyz → { name: 'submission', params: ['sub_xyz'] }
    const h = (location.hash || '').replace(/^#\/?/, '');
    if (!h) return { name: DEFAULT_ROUTE, params: [] };
    const parts = h.split('/').filter(Boolean);
    const name = parts.shift();
    return { name: ROUTES[name] ? name : DEFAULT_ROUTE, params: parts };
  }

  async function loadFragment(routeName) {
    if (fragmentCache[routeName]) return fragmentCache[routeName];
    const route = ROUTES[routeName];
    if (!route) return null;
    let html = '';
    try {
      const res = await fetch(route.src, { credentials: 'omit' });
      html = await res.text();
    } catch (_) { return null; }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const main = doc.querySelector('main');
    fragmentCache[routeName] = main ? main.innerHTML : '';
    return fragmentCache[routeName];
  }

  function updateActiveNav(routeName) {
    document.querySelectorAll('.topnav a[data-route]').forEach(a => {
      a.classList.toggle('active', a.dataset.route === routeName);
    });
    document.body.dataset.page = routeName;
  }

  async function navigate() {
    if (routingNow) return;
    routingNow = true;
    const { name, params } = parseHash();
    const h = host();
    if (!h) { routingNow = false; return; }

    // Unmount previous view. Mount/unmount are best-effort — missing exports
    // are tolerated so a view module that doesn't need lifecycle (yet) still
    // works.
    if (current.name && ROUTES[current.name]) {
      const prev = ROUTES[current.name].view();
      try { prev && prev.unmount && prev.unmount(h); } catch (_) {}
    }

    const fragment = await loadFragment(name);
    h.innerHTML = fragment != null
      ? fragment
      : '<p class="muted" style="padding:1.5rem">Could not load view.</p>';

    updateActiveNav(name);
    current = { name, host: h };

    const next = ROUTES[name].view();
    try { next && next.mount && next.mount(h, params); } catch (e) {
      console.warn('mount failed for', name, e);
    }

    // Restore scroll to top on every nav. Per-view scroll memory can come
    // later if anyone asks.
    window.scrollTo(0, 0);
    routingNow = false;
  }

  async function initShell() {
    // The shell chrome (topbar net-status, toast) is mounted in every view —
    // initialize it once at boot. The per-view mount functions only wire
    // their own DOM.
    try { window.ProxNet && ProxNet.checkAndDisplay('net-status'); } catch (_) {}
    try {
      if (window.ProxStore) {
        await ProxStore.checkStorage();
        try { await ProxStore.migrateLegacyDraftIfNeeded(); } catch (_) {}
      }
    } catch (_) {}
  }

  async function start() {
    // Normalize legacy query-string entries (e.g. someone bookmarked
    // /app.html?form=xyz from before the shell existed) into hash routes.
    const url = new URL(location.href);
    const qForm = url.searchParams.get('form');
    const qSub  = url.searchParams.get('submission');
    if (qForm)      { location.replace('/app.html#/build/' + encodeURIComponent(qForm)); return; }
    if (qSub)       { location.replace('/app.html#/submission/' + encodeURIComponent(qSub)); return; }
    if (!location.hash) { history.replaceState(null, '', '#/' + DEFAULT_ROUTE); }
    await initShell();
    navigate();
  }

  window.addEventListener('hashchange', navigate);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Tiny public surface — other modules call this after they finish an
  // action that should land on a different view (e.g. "Generate invite"
  // from the builder routes the user to /received).
  window.ProxRouter = {
    go(routeName, ...params) {
      const path = '#/' + [routeName, ...params.map(encodeURIComponent)].join('/');
      if (location.hash === path) navigate();
      else location.hash = path;
    },
    current() { return current.name; },
    invalidate(routeName) { delete fragmentCache[routeName]; }
  };
})();
